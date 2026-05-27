from datetime import datetime

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

from database import get_collection
from services.exceptions import NotFoundError, StorageUnavailableError, ValidationError

issue_collection = get_collection("issues")
sprint_collection = get_collection("sprints")
comment_collection = get_collection("comments")
sprint_epic_link_collection = get_collection("sprint_epic_links")


def _to_object_id(value: str, name: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise ValidationError(f"Invalid {name}")
    return ObjectId(value)


def _as_string_id(value) -> str | None:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, str) and ObjectId.is_valid(value):
        return str(ObjectId(value))
    return None


def _is_epic(document: dict) -> bool:
    return str(document.get("work_type", document.get("issue_type", ""))).lower() == "epic"


def _is_subtask(document: dict) -> bool:
    return str(document.get("work_type", document.get("issue_type", ""))).lower() == "subtask"


def _serialize_hierarchy_issue(document: dict, included_ids: set[str]) -> dict:
    issue_id = str(document["_id"])
    return {
        "id": issue_id,
        "title": document.get("title", ""),
        "status": document.get("status", "backlog"),
        "work_type": document.get("work_type", document.get("issue_type", "task")),
        "included_in_sprint": issue_id in included_ids,
    }


async def create_epic(project_id: str, payload: dict) -> dict:
    now = datetime.utcnow()
    project_object_id = _to_object_id(project_id, "project id")

    document = {
        "project_id": project_object_id,
        "issue_number": int(datetime.utcnow().timestamp()),
        "issue_key": f"EPIC-{int(datetime.utcnow().timestamp())}",
        "title": payload["title"],
        "description": payload.get("description", ""),
        "issue_type": "task",
        "work_type": "epic",
        "status": payload.get("status", "backlog"),
        "priority": payload.get("priority", "medium"),
        "assignee": payload.get("assignee"),
        "reporter": payload.get("reporter"),
        "watchers": [],
        "labels": ["epic"],
        "story_points": None,
        "sprint_id": None,
        "parent_issue_id": None,
        "epic_issue_id": None,
        "resolved_at": None,
        "archived_at": None,
        "created_at": now,
        "updated_at": now,
    }

    try:
        project_key_prefix = "PR"
        sample = await issue_collection.find_one({"project_id": project_object_id}, {"issue_key": 1})
        if sample and sample.get("issue_key") and "-" in sample["issue_key"]:
            project_key_prefix = str(sample["issue_key"]).split("-", 1)[0]

        count = await issue_collection.count_documents({"project_id": project_object_id})
        issue_number = count + 1
        document["issue_number"] = issue_number
        document["issue_key"] = f"{project_key_prefix}-{issue_number}"

        result = await issue_collection.insert_one(document)
        document["_id"] = result.inserted_id
        return {
            "id": str(document["_id"]),
            "project_id": project_id,
            "issue_key": document["issue_key"],
            "title": document["title"],
            "status": document["status"],
            "work_type": "epic",
            "created_at": document["created_at"],
            "updated_at": document["updated_at"],
        }
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def get_project_sprint_hierarchy(project_id: str, sprint_id: str | None = None) -> dict:
    project_object_id = _to_object_id(project_id, "project id")

    try:
        target_sprint = None
        if sprint_id:
            target_sprint = await sprint_collection.find_one({"_id": _to_object_id(sprint_id, "sprint id"), "project_id": project_object_id})
            if not target_sprint:
                raise NotFoundError("Sprint not found")

        cursor = issue_collection.find({"project_id": project_object_id, "archived_at": None})
        documents = []
        async for entry in cursor:
            documents.append(entry)

        document_map = {str(entry["_id"]): entry for entry in documents}
        epics = [entry for entry in documents if _is_epic(entry)]

        included_ids: set[str] = set()
        if target_sprint:
            sprint_key = str(target_sprint["_id"])
            links_cursor = sprint_epic_link_collection.find({"project_id": project_object_id, "sprint_id": target_sprint["_id"]})
            async for link in links_cursor:
                included_ids.add(str(link.get("epic_id")))
                included_ids.update([str(item) for item in link.get("included_task_ids", [])])
                included_ids.update([str(item) for item in link.get("included_subtask_ids", [])])

            async for entry in issue_collection.find({"project_id": project_object_id, "sprint_id": target_sprint["_id"], "archived_at": None}):
                included_ids.add(str(entry["_id"]))

        hierarchy_epics = []
        for epic in epics:
            epic_id = str(epic["_id"])

            task_candidates = []
            for entry in documents:
                if str(entry["_id"]) == epic_id:
                    continue
                if _is_subtask(entry):
                    continue
                parent_id = _as_string_id(entry.get("parent_issue_id"))
                epic_ref = _as_string_id(entry.get("epic_issue_id"))
                if parent_id == epic_id or epic_ref == epic_id:
                    task_candidates.append(entry)

            tasks = []
            for task in task_candidates:
                task_id = str(task["_id"])
                subtasks = []
                for entry in documents:
                    if not _is_subtask(entry):
                        continue
                    parent_id = _as_string_id(entry.get("parent_issue_id"))
                    epic_ref = _as_string_id(entry.get("epic_issue_id"))
                    if parent_id == task_id or (epic_ref == epic_id and parent_id == task_id):
                        subtasks.append(_serialize_hierarchy_issue(entry, included_ids))

                tasks.append({
                    **_serialize_hierarchy_issue(task, included_ids),
                    "subtasks": subtasks,
                })

            hierarchy_epics.append(
                {
                    **_serialize_hierarchy_issue(epic, included_ids),
                    "tasks": tasks,
                }
            )

        return {
            "project_id": project_id,
            "sprint_id": str(target_sprint["_id"]) if target_sprint else None,
            "epics": hierarchy_epics,
        }
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def include_epic_in_sprint(
    project_id: str,
    sprint_id: str,
    epic_id: str,
    include_mode: str,
    task_ids: list[str] | None = None,
    subtask_ids: list[str] | None = None,
) -> dict:
    project_object_id = _to_object_id(project_id, "project id")
    sprint_object_id = _to_object_id(sprint_id, "sprint id")
    epic_object_id = _to_object_id(epic_id, "epic id")

    safe_task_ids = task_ids or []
    safe_subtask_ids = subtask_ids or []

    try:
        sprint = await sprint_collection.find_one({"_id": sprint_object_id, "project_id": project_object_id})
        if not sprint:
            raise NotFoundError("Sprint not found")

        epic = await issue_collection.find_one({"_id": epic_object_id, "project_id": project_object_id, "archived_at": None})
        if not epic:
            raise NotFoundError("Epic not found")
        if not _is_epic(epic):
            raise ValidationError("Selected issue is not an epic")

        docs = []
        async for entry in issue_collection.find({"project_id": project_object_id, "archived_at": None}):
            docs.append(entry)

        epic_key = str(epic_object_id)
        all_tasks: list[str] = []
        for entry in docs:
            entry_id = str(entry["_id"])
            if entry_id == epic_key or _is_subtask(entry):
                continue
            parent_id = _as_string_id(entry.get("parent_issue_id"))
            epic_ref = _as_string_id(entry.get("epic_issue_id"))
            if parent_id == epic_key or epic_ref == epic_key:
                all_tasks.append(entry_id)

        all_subtasks: list[str] = []
        for entry in docs:
            if not _is_subtask(entry):
                continue
            entry_id = str(entry["_id"])
            parent_id = _as_string_id(entry.get("parent_issue_id"))
            epic_ref = _as_string_id(entry.get("epic_issue_id"))
            if epic_ref == epic_key or parent_id in all_tasks:
                all_subtasks.append(entry_id)

        allowed_task_set = set(all_tasks)
        allowed_subtask_set = set(all_subtasks)

        if include_mode == "full":
            selected_task_ids = all_tasks
            selected_subtask_ids = all_subtasks
        else:
            selected_task_ids = [item for item in safe_task_ids if ObjectId.is_valid(item) and item in allowed_task_set]
            selected_subtask_ids = [item for item in safe_subtask_ids if ObjectId.is_valid(item) and item in allowed_subtask_set]
            if not selected_task_ids and not selected_subtask_ids:
                raise ValidationError("Select at least one task or subtask for partial inclusion")

        include_ids = {epic_key, *selected_task_ids, *selected_subtask_ids}
        include_object_ids = [ObjectId(item) for item in include_ids]

        await issue_collection.update_many(
            {"project_id": project_object_id, "_id": {"$in": include_object_ids}},
            {"$set": {"sprint_id": sprint_object_id, "updated_at": datetime.utcnow()}},
        )

        descendants = {epic_key, *all_tasks, *all_subtasks}
        excluded_ids = [ObjectId(item) for item in descendants if item not in include_ids]
        if excluded_ids:
            await issue_collection.update_many(
                {
                    "project_id": project_object_id,
                    "_id": {"$in": excluded_ids},
                    "sprint_id": sprint_object_id,
                },
                {"$set": {"sprint_id": None, "updated_at": datetime.utcnow()}},
            )

        await sprint_epic_link_collection.find_one_and_update(
            {"project_id": project_object_id, "sprint_id": sprint_object_id, "epic_id": epic_object_id},
            {
                "$set": {
                    "include_mode": include_mode,
                    "included_task_ids": [ObjectId(item) for item in selected_task_ids],
                    "included_subtask_ids": [ObjectId(item) for item in selected_subtask_ids],
                    "updated_at": datetime.utcnow(),
                },
                "$setOnInsert": {
                    "project_id": project_object_id,
                    "sprint_id": sprint_object_id,
                    "epic_id": epic_object_id,
                    "created_at": datetime.utcnow(),
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )

        comment_message = (
            f"Epic {epic.get('title', '')} added to Sprint {sprint.get('name', '')}"
            if include_mode == "full"
            else f"Selected tasks/subtasks from Epic {epic.get('title', '')} added to Sprint"
        )
        await comment_collection.insert_one(
            {
                "issue_id": epic_object_id,
                "author_id": "system",
                "body": comment_message,
                "deleted_at": None,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }
        )

        return {
            "project_id": project_id,
            "sprint_id": sprint_id,
            "epic_id": epic_id,
            "include_mode": include_mode,
            "included_task_count": len(selected_task_ids),
            "included_subtask_count": len(selected_subtask_ids),
            "comment": comment_message,
        }
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error
