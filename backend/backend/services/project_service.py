from datetime import datetime
import re

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pymongo.errors import PyMongoError

from database import get_collection
from services.exceptions import ConflictError, NotFoundError, StorageUnavailableError, ValidationError
from services.workflow_service import get_default_workflow, validate_workflow_config

project_collection = get_collection("projects")
counter_collection = get_collection("counters")
audit_collection = get_collection("audit_logs")
issue_collection = get_collection("issues")
sprint_collection = get_collection("sprints")
issue_history_collection = get_collection("issue_history")
comment_collection = get_collection("comments")
invite_collection = get_collection("project_invites")


def _build_base_project_key(name: str) -> str:
    words = [segment for segment in re.split(r"\s+", (name or "").strip()) if segment]
    initials = "".join(segment[0] for segment in words)
    cleaned_initials = re.sub(r"[^A-Za-z0-9]", "", initials.upper())
    if len(cleaned_initials) >= 2:
        return cleaned_initials[:10]

    cleaned = re.sub(r"[^A-Za-z0-9]", "", (name or "").upper())
    if len(cleaned) >= 2:
        return cleaned[:10]
    return "PR"


async def _generate_unique_project_key(name: str) -> str:
    base_key = _build_base_project_key(name)

    for index in range(0, 500):
        suffix = "" if index == 0 else str(index + 1)
        max_base_length = max(2, 10 - len(suffix))
        candidate = f"{base_key[:max_base_length]}{suffix}"
        exists = await project_collection.find_one({"key": candidate}, {"_id": 1})
        if not exists:
            return candidate

    raise ValidationError("Unable to generate unique project key")


def _serialize_project(document: dict) -> dict:
    workflow = document.get("workflow") or get_default_workflow()
    return {
        "id": str(document["_id"]),
        "name": document["name"],
        "key": document["key"],
        "description": document.get("description", ""),
        "lead": document.get("lead"),
        "project_type": document.get("project_type", "software"),
        "members": document.get("members", []),
        "member_roles": document.get("member_roles", []),
        "workflow": workflow,
        "created_at": document["created_at"],
        "updated_at": document["updated_at"],
    }


def _serialize_audit(document: dict) -> dict:
    return {
        "id": str(document["_id"]),
        "project_id": str(document["project_id"]),
        "event_type": document["event_type"],
        "payload": document.get("payload", {}),
        "created_at": document["created_at"],
    }


async def _insert_audit(project_id: ObjectId, event_type: str, payload: dict) -> None:
    await audit_collection.insert_one(
        {
            "project_id": project_id,
            "event_type": event_type,
            "payload": payload,
            "created_at": datetime.utcnow(),
        }
    )


async def list_projects() -> list[dict]:
    try:
        projects = []
        cursor = project_collection.find({"archived_at": None}).sort("created_at", -1)
        async for document in cursor:
            projects.append(_serialize_project(document))
        return projects
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def get_project(project_id: str) -> dict | None:
    if not ObjectId.is_valid(project_id):
        raise ValidationError("Invalid project id")
    try:
        document = await project_collection.find_one({"_id": ObjectId(project_id), "archived_at": None})
        if not document:
            return None
        return _serialize_project(document)
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def create_project(data: dict) -> dict:
    try:
        now = datetime.utcnow()
        raw_key = (data.get("key") or "").upper().strip()
        project_key = raw_key or await _generate_unique_project_key(data.get("name", ""))
        if not project_key.isalnum():
            raise ValidationError("Project key must be alphanumeric")

        payload = {
            "name": data["name"],
            "key": project_key,
            "description": data.get("description", ""),
            "lead": data.get("lead"),
            "project_type": data.get("project_type", "software"),
            "members": [data.get("lead").lower().strip()] if data.get("lead") else [],
            "member_roles": [{"email": data.get("lead").lower().strip(), "role": "lead"}] if data.get("lead") else [],
            "workflow": validate_workflow_config(data.get("workflow") or get_default_workflow()),
            "archived_at": None,
            "created_at": now,
            "updated_at": now,
        }
        result = await project_collection.insert_one(payload)

        await counter_collection.insert_one(
            {
                "project_id": result.inserted_id,
                "next_issue_number": 1,
                "created_at": now,
                "updated_at": now,
            }
        )

        await _insert_audit(result.inserted_id, "project_created", {"key": project_key, "name": data["name"]})

        payload["_id"] = result.inserted_id
        return _serialize_project(payload)
    except DuplicateKeyError as error:
        raise ConflictError("Project key already exists") from error
    except ValidationError:
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def require_project(project_id: str) -> dict:
    project = await get_project(project_id)
    if not project:
        raise NotFoundError("Project not found")
    return project


async def get_next_issue_number(project_id: str) -> int:
    try:
        project_object_id = ObjectId(project_id)
        document = await counter_collection.find_one_and_update(
            {"project_id": project_object_id},
            {"$inc": {"next_issue_number": 1}, "$set": {"updated_at": datetime.utcnow()}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if not document:
            raise StorageUnavailableError("Unable to generate issue key")
        return max(1, int(document["next_issue_number"]) - 1)
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def get_project_workflow(project_id: str) -> dict:
    if not ObjectId.is_valid(project_id):
        raise ValidationError("Invalid project id")
    try:
        document = await project_collection.find_one({"_id": ObjectId(project_id)})
        if not document:
            raise NotFoundError("Project not found")
        return validate_workflow_config(document.get("workflow") or get_default_workflow())
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def update_project_workflow(project_id: str, workflow: dict) -> dict:
    if not ObjectId.is_valid(project_id):
        raise ValidationError("Invalid project id")

    validated_workflow = validate_workflow_config(workflow)
    try:
        result = await project_collection.find_one_and_update(
            {"_id": ObjectId(project_id)},
            {
                "$set": {
                    "workflow": validated_workflow,
                    "updated_at": datetime.utcnow(),
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if not result:
            raise NotFoundError("Project not found")
        await _insert_audit(ObjectId(project_id), "workflow_updated", {"state_count": len(validated_workflow["states"])})
        return validated_workflow
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def list_project_audit(project_id: str) -> list[dict]:
    if not ObjectId.is_valid(project_id):
        raise ValidationError("Invalid project id")
    try:
        entries = []
        cursor = audit_collection.find({"project_id": ObjectId(project_id)}).sort("created_at", -1).limit(200)
        async for document in cursor:
            entries.append(_serialize_audit(document))
        return entries
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def archive_project(project_id: str) -> dict:
    if not ObjectId.is_valid(project_id):
        raise ValidationError("Invalid project id")
    project_object_id = ObjectId(project_id)

    try:
        now = datetime.utcnow()
        document = await project_collection.find_one_and_update(
            {"_id": project_object_id, "archived_at": None},
            {"$set": {"archived_at": now, "updated_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        if not document:
            raise NotFoundError("Project not found")

        await _insert_audit(project_object_id, "project_archived", {"project_id": project_id})
        return _serialize_project(document)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def delete_project_permanently(project_id: str) -> dict:
    if not ObjectId.is_valid(project_id):
        raise ValidationError("Invalid project id")
    project_object_id = ObjectId(project_id)

    try:
        project = await project_collection.find_one({"_id": project_object_id})
        if not project:
            raise NotFoundError("Project not found")

        issue_ids: list[ObjectId] = []
        issue_cursor = issue_collection.find({"project_id": project_object_id}, {"_id": 1})
        async for issue_doc in issue_cursor:
            issue_ids.append(issue_doc["_id"])

        await project_collection.delete_one({"_id": project_object_id})
        await counter_collection.delete_many({"project_id": project_object_id})
        await sprint_collection.delete_many({"project_id": project_object_id})
        await audit_collection.delete_many({"project_id": project_object_id})
        await invite_collection.delete_many({"project_id": project_object_id})
        await issue_collection.delete_many({"project_id": project_object_id})
        if issue_ids:
            await issue_history_collection.delete_many({"issue_id": {"$in": issue_ids}})
            await comment_collection.delete_many({"issue_id": {"$in": issue_ids}})

        return {"deleted": True, "project_id": project_id}
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error
