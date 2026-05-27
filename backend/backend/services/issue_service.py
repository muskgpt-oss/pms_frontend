import re
from datetime import datetime

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pymongo.errors import PyMongoError

from database import get_collection
from services.exceptions import ConflictError, NotFoundError, StorageUnavailableError, ValidationError
from services.notification_service import create_notification
from services.project_service import get_next_issue_number, get_project_workflow
from services.realtime_service import publish
from services.workflow_service import (
    find_transition_path,
    find_valid_transition,
    get_initial_state_id,
    get_state_by_id,
    resolve_workflow_state_id,
)

issue_collection = get_collection("issues")
sprint_collection = get_collection("sprints")
history_collection = get_collection("issue_history")
comment_collection = get_collection("comments")


def _to_object_id(value: str, name: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise ValidationError(f"Invalid {name}")
    return ObjectId(value)


def _serialize_issue(document: dict) -> dict:
    sprint_id = document.get("sprint_id")
    epic_issue_id = document.get("epic_issue_id")
    parent_issue_id = document.get("parent_issue_id")
    return {
        "id": str(document["_id"]),
        "project_id": str(document["project_id"]),
        "issue_number": document.get("issue_number"),
        "issue_key": document["issue_key"],
        "title": document["title"],
        "description": document.get("description", ""),
        "issue_type": document["issue_type"],
        "work_type": document.get("work_type", document.get("issue_type", "task")),
        "status": document["status"],
        "priority": document["priority"],
        "assignee": document.get("assignee"),
        "reporter": document.get("reporter"),
        "watchers": document.get("watchers", []),
        "labels": document.get("labels", []),
        "story_points": document.get("story_points"),
        "sprint_id": str(sprint_id) if sprint_id else None,
        "epic_issue_id": str(epic_issue_id) if epic_issue_id else None,
        "parent_issue_id": str(parent_issue_id) if parent_issue_id else None,
        "start_date": document.get("start_date"),
        "due_date": document.get("due_date"),
        "resolved_at": document.get("resolved_at"),
        "archived_at": document.get("archived_at"),
        "created_at": document["created_at"],
        "updated_at": document["updated_at"],
    }


def _normalize_history_value(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [_normalize_history_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_history_value(item) for key, item in value.items()}
    return value


def _serialize_history(document: dict) -> dict:
    return {
        "id": str(document["_id"]),
        "issue_id": str(document["issue_id"]),
        "user_id": document.get("user_id"),
        "event_type": document["event_type"],
        "payload": _normalize_history_value(document.get("payload", {})),
        "created_at": document["created_at"],
    }


def _serialize_comment(document: dict) -> dict:
    return {
        "id": str(document["_id"]),
        "issue_id": str(document["issue_id"]),
        "author_id": document["author_id"],
        "body": document["body"],
        "created_at": document["created_at"],
        "updated_at": document["updated_at"],
    }


async def _insert_issue_history(issue_object_id: ObjectId, event_type: str, payload: dict) -> None:
    await history_collection.insert_one(
        {
            "issue_id": issue_object_id,
            "event_type": event_type,
            "payload": _normalize_history_value(payload),
            "created_at": datetime.utcnow(),
        }
    )


def _extract_mentions(text: str) -> list[str]:
    return list({match.lower() for match in re.findall(r"@([a-zA-Z0-9._-]+)", text or "")})


def _build_issue_query(
    project_object_id: ObjectId,
    status: str | None,
    sprint_id: str | None,
    backlog_only: bool,
    assignee: str | None,
    priority: str | None,
    issue_type: str | None,
    labels: list[str] | None,
    q: str | None,
    include_archived: bool,
) -> dict:
    query: dict = {"project_id": project_object_id}
    if not include_archived:
        query["archived_at"] = None

    if status:
        query["status"] = status
    if sprint_id:
        query["sprint_id"] = _to_object_id(sprint_id, "sprint id")
    if backlog_only:
        query["$or"] = [{"sprint_id": None}, {"sprint_id": {"$exists": False}}]
    if assignee:
        query["assignee"] = assignee
    if priority:
        query["priority"] = priority
    if issue_type:
        query["issue_type"] = issue_type
    if labels:
        query["labels"] = {"$all": labels}
    if q:
        query["$text"] = {"$search": q}
    return query


def _evaluate_transition_conditions(conditions: list[dict], issue: dict) -> None:
    for condition in conditions:
        condition_type = condition.get("type")
        if condition_type == "field_required":
            field_name = condition.get("field")
            if not field_name:
                raise ValidationError("Transition condition field_required requires field")
            if not issue.get(field_name):
                raise ValidationError(f"Transition blocked: required field '{field_name}' is missing")
            continue
        if condition_type == "issue_type_in":
            allowed_values = condition.get("values", [])
            if issue.get("issue_type") not in allowed_values:
                raise ValidationError("Transition blocked: issue type condition failed")
            continue
        raise ValidationError(f"Unsupported transition condition: {condition_type}")


def _normalize_state_key(value: str) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def _is_review_like_state(state: dict | None) -> bool:
    if not state:
        return False
    state_id = _normalize_state_key(state.get("id", ""))
    state_name = _normalize_state_key(state.get("name", ""))
    return "review" in state_id or "review" in state_name


def _ensure_done_is_final(workflow: dict, current_status: str, target_status: str) -> None:
    current_state = get_state_by_id(workflow, current_status)
    if current_state and current_state.get("category") == "done" and current_status != target_status:
        raise ValidationError("Done is the final state and cannot transition to another column")


def _ensure_restricted_transition_allowed(workflow: dict, current_status: str, target_status: str) -> None:
    current_state = get_state_by_id(workflow, current_status)
    target_state = get_state_by_id(workflow, target_status)
    if not current_state or not target_state:
        raise ValidationError("Invalid workflow state")

    current_category = current_state.get("category")
    target_category = target_state.get("category")
    if target_category == "done":
        raise ValidationError("Restricted role cannot move tasks to Done")

    if current_category == "todo" and target_category == "in_progress":
        return

    if current_category == "in_progress" and not _is_review_like_state(current_state) and _is_review_like_state(target_state):
        return

    raise ValidationError("Restricted role can only move tasks from To Do -> In Progress -> Review")


async def _apply_post_functions(post_functions: list[dict], issue_document: dict) -> dict:
    updates = {}
    for post_function in post_functions:
        function_type = post_function.get("type")
        if function_type == "set_field":
            field_name = post_function.get("field")
            value = post_function.get("value")
            if field_name:
                updates[field_name] = datetime.utcnow() if value == "now" else value
        elif function_type == "notify_assignee" and issue_document.get("assignee"):
            await create_notification(
                user_id=issue_document["assignee"],
                notification_type="issue_transitioned",
                payload={"issue_key": issue_document["issue_key"]},
                entity_type="issue",
                entity_id=str(issue_document["_id"]),
            )
        elif function_type == "notify_reporter" and issue_document.get("reporter"):
            await create_notification(
                user_id=issue_document["reporter"],
                notification_type="issue_transitioned",
                payload={"issue_key": issue_document["issue_key"]},
                entity_type="issue",
                entity_id=str(issue_document["_id"]),
            )
        elif function_type == "notify_watchers":
            for watcher in issue_document.get("watchers", []):
                await create_notification(
                    user_id=watcher,
                    notification_type="issue_transitioned",
                    payload={"issue_key": issue_document["issue_key"]},
                    entity_type="issue",
                    entity_id=str(issue_document["_id"]),
                )
    return updates


def _publish_issue_event(project_id: ObjectId, issue_id: ObjectId, event_type: str, changes: list[str]) -> None:
    publish(
        str(project_id),
        {
            "type": event_type,
            "issue_id": str(issue_id),
            "project_id": str(project_id),
            "changes": changes,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    )


async def create_issue(project: dict, data: dict) -> dict:
    try:
        now = datetime.utcnow()
        project_object_id = _to_object_id(project["id"], "project id")
        workflow = await get_project_workflow(project["id"])
        initial_status = get_initial_state_id(workflow)
        next_sequence = await get_next_issue_number(project["id"])
        sprint_id = data.get("sprint_id")

        sprint_object_id = None
        if sprint_id:
            sprint_object_id = _to_object_id(sprint_id, "sprint id")

        epic_object_id = None
        if data.get("epic_issue_id"):
            epic_object_id = _to_object_id(data["epic_issue_id"], "epic issue id")

        parent_object_id = None
        if data.get("parent_issue_id"):
            parent_object_id = _to_object_id(data["parent_issue_id"], "parent issue id")

        requested_status = data.get("status") or initial_status
        status = resolve_workflow_state_id(workflow, requested_status)
        if not status:
            raise ValidationError(f"Unknown workflow state: {requested_status}")

        payload = {
            "project_id": project_object_id,
            "issue_number": next_sequence,
            "issue_key": f"{project['key']}-{next_sequence}",
            "title": data["title"],
            "description": data.get("description", ""),
            "issue_type": data.get("issue_type", "task"),
            "work_type": data.get("work_type", data.get("issue_type", "task")),
            "status": status,
            "priority": data.get("priority", "medium"),
            "assignee": data.get("assignee"),
            "reporter": data.get("reporter"),
            "watchers": data.get("watchers", []),
            "labels": data.get("labels", []),
            "story_points": data.get("story_points"),
            "sprint_id": sprint_object_id,
            "epic_issue_id": epic_object_id,
            "parent_issue_id": parent_object_id,
            "start_date": data.get("start_date"),
            "due_date": data.get("due_date"),
            "resolved_at": None,
            "archived_at": None,
            "created_at": now,
            "updated_at": now,
        }
        result = await issue_collection.insert_one(payload)
        payload["_id"] = result.inserted_id
        await _insert_issue_history(
            result.inserted_id,
            "issue_created",
            {
                "issue_key": payload["issue_key"],
                "status": payload["status"],
                "title": payload["title"],
            },
        )
        if payload.get("assignee"):
            await create_notification(
                user_id=payload["assignee"],
                notification_type="issue_assigned",
                payload={"issue_key": payload["issue_key"], "title": payload["title"]},
                entity_type="issue",
                entity_id=str(result.inserted_id),
            )
        _publish_issue_event(project_object_id, result.inserted_id, "issue.created", ["*"])
        return _serialize_issue(payload)
    except DuplicateKeyError as error:
        raise ConflictError("Issue key already exists") from error
    except ValidationError:
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def list_issues(
    project_id: str,
    status: str | None = None,
    sprint_id: str | None = None,
    backlog_only: bool = False,
    assignee: str | None = None,
    priority: str | None = None,
    issue_type: str | None = None,
    labels: list[str] | None = None,
    q: str | None = None,
    include_archived: bool = False,
    limit: int | None = None,
) -> list[dict]:
    try:
        project_object_id = _to_object_id(project_id, "project id")
        query = _build_issue_query(
            project_object_id,
            status,
            sprint_id,
            backlog_only,
            assignee,
            priority,
            issue_type,
            labels,
            q,
            include_archived,
        )

        issues = []
        cursor = issue_collection.find(query).sort("updated_at", -1)
        if limit:
            cursor = cursor.limit(max(1, min(limit, 200)))
        async for document in cursor:
            issues.append(_serialize_issue(document))
        return issues
    except ValidationError:
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def get_issue(issue_id: str) -> dict:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        document = await issue_collection.find_one({"_id": issue_object_id, "archived_at": None})
        if not document:
            raise NotFoundError("Issue not found")

        workflow = await get_project_workflow(str(document["project_id"]))
        available_transitions = [
            transition
            for transition in workflow["transitions"]
            if transition["to_state_id"] != document["status"]
            and (
                "*" in transition.get("from_state_ids", [])
                or document["status"] in transition.get("from_state_ids", [])
            )
        ]
        payload = _serialize_issue(document)
        payload["available_transitions"] = available_transitions
        return payload
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def update_issue(issue_id: str, updates: dict) -> dict | None:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        payload = dict(updates)
        expected_updated_at = payload.pop("expected_updated_at", None)

        current = await issue_collection.find_one({"_id": issue_object_id, "archived_at": None})
        if not current:
            return None

        workflow = await get_project_workflow(str(current["project_id"]))

        if expected_updated_at and current.get("updated_at") != expected_updated_at:
            raise ConflictError("Issue was updated by another user. Refresh and try again.")

        if "sprint_id" in payload:
            payload["sprint_id"] = _to_object_id(payload["sprint_id"], "sprint id") if payload["sprint_id"] else None
        if "epic_issue_id" in payload:
            payload["epic_issue_id"] = _to_object_id(payload["epic_issue_id"], "epic issue id") if payload["epic_issue_id"] else None
        if "parent_issue_id" in payload:
            payload["parent_issue_id"] = _to_object_id(payload["parent_issue_id"], "parent issue id") if payload["parent_issue_id"] else None

        if "status" in payload:
            current_status = current["status"]
            requested_status = payload["status"]
            target_status = resolve_workflow_state_id(workflow, requested_status)
            if not target_status:
                raise ValidationError(f"Unknown workflow state: {requested_status}")
            _ensure_done_is_final(workflow, current_status, target_status)
            payload["status"] = target_status
            transition = find_valid_transition(workflow, current_status, target_status)
            if not transition:
                raise ValidationError(f"Invalid transition {current_status} -> {target_status}")

        if not payload:
            return _serialize_issue(current)

        if "status" in payload:
            target_state = get_state_by_id(workflow, payload["status"])
            if target_state and target_state["category"] == "done":
                payload["resolved_at"] = datetime.utcnow()
            elif target_state and target_state["category"] != "done":
                payload["resolved_at"] = None

        history_changes = []
        for field, new_value in payload.items():
            old_value = current.get(field)
            if old_value != new_value:
                history_changes.append(
                    {
                        "field": field,
                        "from": _normalize_history_value(old_value),
                        "to": _normalize_history_value(new_value),
                    }
                )

        payload["updated_at"] = datetime.utcnow()

        await issue_collection.update_one({"_id": issue_object_id}, {"$set": payload})
        if history_changes:
            await _insert_issue_history(
                issue_object_id,
                "field_changed",
                {
                    "changes": history_changes,
                },
            )
        if "assignee" in payload and payload.get("assignee") and payload.get("assignee") != current.get("assignee"):
            await create_notification(
                user_id=payload["assignee"],
                notification_type="issue_assigned",
                payload={"issue_key": current["issue_key"]},
                entity_type="issue",
                entity_id=issue_id,
            )
        document = await issue_collection.find_one({"_id": issue_object_id})
        if not document:
            return None
        _publish_issue_event(document["project_id"], issue_object_id, "issue.updated", list(payload.keys()))
        return _serialize_issue(document)
    except (ValidationError, ConflictError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def transition_issue(issue_id: str, target_status: str) -> dict:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        current = await issue_collection.find_one({"_id": issue_object_id})
        if not current:
            raise NotFoundError("Issue not found")

        workflow = await get_project_workflow(str(current["project_id"]))
        requested_status = target_status
        target_status = resolve_workflow_state_id(workflow, requested_status)
        if not target_status:
            raise ValidationError(f"Unknown workflow state: {requested_status}")

        _ensure_done_is_final(workflow, current["status"], target_status)

        transition = find_valid_transition(workflow, current["status"], target_status)
        transition_path = [transition] if transition else find_transition_path(workflow, current["status"], target_status)
        if not transition_path:
            raise ValidationError(f"Invalid transition {current['status']} -> {target_status}")

        working_issue = dict(current)
        updates: dict = {}
        for step in transition_path:
            _evaluate_transition_conditions(step.get("conditions", []), working_issue)
            step_target_status = step["to_state_id"]
            step_target_state = get_state_by_id(workflow, step_target_status)
            updates["status"] = step_target_status
            updates["updated_at"] = datetime.utcnow()
            if step_target_state and step_target_state["category"] == "done":
                updates["resolved_at"] = datetime.utcnow()
            elif step_target_state and step_target_state["category"] != "done":
                updates["resolved_at"] = None

            post_function_updates = await _apply_post_functions(step.get("post_functions", []), working_issue)
            if post_function_updates:
                updates.update(post_function_updates)

            working_issue.update(updates)

        await issue_collection.update_one({"_id": issue_object_id}, {"$set": updates})
        await _insert_issue_history(
            issue_object_id,
            "transition",
            {
                "transition_id": transition_path[-1]["id"],
                "transition_name": transition_path[-1]["name"],
                "transition_ids": [step["id"] for step in transition_path],
                "transition_names": [step["name"] for step in transition_path],
                "from_status": current["status"],
                "to_status": target_status,
            },
        )

        document = await issue_collection.find_one({"_id": issue_object_id})
        if not document:
            raise NotFoundError("Issue not found")
        _publish_issue_event(document["project_id"], issue_object_id, "issue.updated", ["status"])
        return _serialize_issue(document)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def assert_transition_allowed_for_role(issue_id: str, target_status: str, project_role: str | None) -> None:
    issue_object_id = _to_object_id(issue_id, "issue id")
    try:
        current = await issue_collection.find_one({"_id": issue_object_id})
        if not current:
            raise NotFoundError("Issue not found")

        workflow = await get_project_workflow(str(current["project_id"]))
        resolved_target_status = resolve_workflow_state_id(workflow, target_status)
        if not resolved_target_status:
            raise ValidationError(f"Unknown workflow state: {target_status}")

        _ensure_done_is_final(workflow, current["status"], resolved_target_status)

        role = str(project_role or "developer").strip().lower()
        if role == "restricted":
            _ensure_restricted_transition_allowed(workflow, current["status"], resolved_target_status)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def assign_issue_to_sprint(issue_id: str, sprint_id: str | None) -> dict:
    updates: dict = {"sprint_id": sprint_id}
    issue = await update_issue(issue_id, updates)
    if not issue:
        raise NotFoundError("Issue not found")
    return issue


async def archive_issue(issue_id: str) -> dict:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        now = datetime.utcnow()
        document = await issue_collection.find_one_and_update(
            {"_id": issue_object_id, "archived_at": None},
            {"$set": {"archived_at": now, "updated_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        if not document:
            raise NotFoundError("Issue not found")

        await _insert_issue_history(issue_object_id, "issue_archived", {"archived_at": now})
        _publish_issue_event(document["project_id"], issue_object_id, "issue.archived", ["archived_at"])
        return _serialize_issue(document)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def delete_issue_permanently(issue_id: str) -> dict:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        existing = await issue_collection.find_one({"_id": issue_object_id})
        if not existing:
            raise NotFoundError("Issue not found")

        await issue_collection.delete_one({"_id": issue_object_id})
        await history_collection.delete_many({"issue_id": issue_object_id})
        await comment_collection.delete_many({"issue_id": issue_object_id})
        _publish_issue_event(existing["project_id"], issue_object_id, "issue.deleted", ["*"])
        return {"deleted": True, "issue_id": issue_id}
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def bulk_update_issues(issue_ids: list[str], updates: dict) -> list[dict]:
    results = []
    for issue_id in issue_ids:
        issue = await update_issue(issue_id, updates)
        if issue:
            results.append(issue)
    return results


async def get_board(project_id: str, sprint_id: str | None = None) -> dict:
    workflow = await get_project_workflow(project_id)
    ordered_states = sorted(workflow["states"], key=lambda state: state.get("position", 0))
    board_states = [state for state in ordered_states if state["id"] != "backlog"]
    board_state_ids = [state["id"] for state in board_states]
    columns = {state_id: [] for state_id in board_state_ids}

    if not sprint_id:
        active_sprint = await sprint_collection.find_one(
            {"project_id": _to_object_id(project_id, "project id"), "state": "active"}
        )
        if not active_sprint:
            return {"sprint": None, "states": board_states, "columns": columns}
        sprint_id = str(active_sprint["_id"])
        sprint_data = {
            "id": sprint_id,
            "name": active_sprint["name"],
            "goal": active_sprint.get("goal", ""),
            "state": active_sprint["state"],
        }
    else:
        sprint = await sprint_collection.find_one({"_id": _to_object_id(sprint_id, "sprint id")})
        if not sprint:
            raise NotFoundError("Sprint not found")
        sprint_data = {
            "id": str(sprint["_id"]),
            "name": sprint["name"],
            "goal": sprint.get("goal", ""),
            "state": sprint["state"],
        }

    issues = await list_issues(project_id, sprint_id=sprint_id, include_archived=False)
    for issue in issues:
        if issue["status"] in columns:
            columns[issue["status"]].append(issue)

    return {"sprint": sprint_data, "states": board_states, "columns": columns}


async def get_issue_history(issue_id: str) -> list[dict]:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        exists = await issue_collection.find_one({"_id": issue_object_id}, {"_id": 1})
        if not exists:
            raise NotFoundError("Issue not found")

        history = []
        cursor = history_collection.find({"issue_id": issue_object_id}).sort("created_at", -1)
        async for document in cursor:
            history.append(_serialize_history(document))
        return history
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def list_comments(issue_id: str) -> list[dict]:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        comments = []
        cursor = comment_collection.find({"issue_id": issue_object_id, "deleted_at": None}).sort("created_at", 1)
        async for document in cursor:
            comments.append(_serialize_comment(document))
        return comments
    except ValidationError:
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def create_comment(issue_id: str, body: str, author_id: str | None = None) -> dict:
    try:
        issue_object_id = _to_object_id(issue_id, "issue id")
        issue_document = await issue_collection.find_one({"_id": issue_object_id, "archived_at": None})
        if not issue_document:
            raise NotFoundError("Issue not found")

        now = datetime.utcnow()
        document = {
            "issue_id": issue_object_id,
            "author_id": author_id or "system",
            "body": body,
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
        }
        result = await comment_collection.insert_one(document)
        document["_id"] = result.inserted_id

        await _insert_issue_history(
            issue_object_id,
            "comment_added",
            {"comment_id": str(result.inserted_id), "author_id": document["author_id"]},
        )

        mentions = _extract_mentions(body)
        recipients = set()
        assignee = issue_document.get("assignee")
        reporter = issue_document.get("reporter")
        for mention in mentions:
            if assignee and mention == assignee.lower():
                recipients.add(assignee)
            if reporter and mention == reporter.lower():
                recipients.add(reporter)
            for watcher in issue_document.get("watchers", []):
                if mention == watcher.lower():
                    recipients.add(watcher)

        for recipient in recipients:
            await create_notification(
                user_id=recipient,
                notification_type="comment_added",
                payload={"issue_key": issue_document["issue_key"], "excerpt": body[:140]},
                actor_id=document["author_id"],
                entity_type="comment",
                entity_id=str(result.inserted_id),
            )

        _publish_issue_event(issue_document["project_id"], issue_object_id, "issue.updated", ["comments"])
        return _serialize_comment(document)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def get_backlog(project_id: str) -> dict:
    project_object_id = _to_object_id(project_id, "project id")
    workflow = await get_project_workflow(project_id)

    backlog_issues = await list_issues(project_id, backlog_only=True, include_archived=False)

    sprint_documents = []
    cursor = sprint_collection.find({"project_id": project_object_id}).sort("created_at", 1)
    async for sprint_doc in cursor:
        sprint_documents.append(sprint_doc)

    sprint_ids = [document["_id"] for document in sprint_documents]
    sprint_issues_map: dict[str, list[dict]] = {str(sprint_id): [] for sprint_id in sprint_ids}

    if sprint_ids:
        issue_cursor = issue_collection.find(
            {"project_id": project_object_id, "sprint_id": {"$in": sprint_ids}, "archived_at": None}
        ).sort("updated_at", -1)
        async for issue_doc in issue_cursor:
            sprint_key = str(issue_doc["sprint_id"])
            sprint_issues_map[sprint_key].append(_serialize_issue(issue_doc))

    sprints = []
    for document in sprint_documents:
        sprint_id = str(document["_id"])
        sprints.append(
            {
                "id": sprint_id,
                "name": document["name"],
                "goal": document.get("goal", ""),
                "state": document["state"],
                "start_date": document.get("start_date"),
                "end_date": document.get("end_date"),
                "issues": sprint_issues_map.get(sprint_id, []),
            }
        )

    return {
        "workflow_states": sorted(workflow["states"], key=lambda state: state.get("position", 0)),
        "backlog": backlog_issues,
        "sprints": sprints,
    }
