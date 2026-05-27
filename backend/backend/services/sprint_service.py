from datetime import datetime

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

from database import get_collection
from services.exceptions import NotFoundError, StorageUnavailableError, ValidationError

sprint_collection = get_collection("sprints")


def _to_object_id(value: str, name: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise ValidationError(f"Invalid {name}")
    return ObjectId(value)


def _serialize_sprint(document: dict) -> dict:
    return {
        "id": str(document["_id"]),
        "project_id": str(document["project_id"]),
        "name": document["name"],
        "goal": document.get("goal", ""),
        "start_date": document.get("start_date"),
        "end_date": document.get("end_date"),
        "state": document["state"],
        "created_at": document["created_at"],
        "updated_at": document["updated_at"],
    }


async def create_sprint(project_id: str, data: dict) -> dict:
    try:
        now = datetime.utcnow()
        payload = {
            "project_id": _to_object_id(project_id, "project id"),
            "name": data["name"],
            "goal": data.get("goal", ""),
            "start_date": data.get("start_date"),
            "end_date": data.get("end_date"),
            "state": "planned",
            "created_at": now,
            "updated_at": now,
        }
        result = await sprint_collection.insert_one(payload)
        payload["_id"] = result.inserted_id
        return _serialize_sprint(payload)
    except ValidationError:
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def list_sprints(project_id: str) -> list[dict]:
    try:
        project_object_id = _to_object_id(project_id, "project id")
        sprints = []
        cursor = sprint_collection.find({"project_id": project_object_id}).sort("created_at", 1)
        async for document in cursor:
            sprints.append(_serialize_sprint(document))
        return sprints
    except ValidationError:
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def start_sprint(project_id: str, sprint_id: str, update_data: dict | None = None) -> dict:
    try:
        project_object_id = _to_object_id(project_id, "project id")
        sprint_object_id = _to_object_id(sprint_id, "sprint id")

        await sprint_collection.update_many(
            {"project_id": project_object_id, "state": "active"},
            {"$set": {"state": "planned", "updated_at": datetime.utcnow()}},
        )

        update_fields = {"state": "active", "updated_at": datetime.utcnow()}
        if update_data:
            if "name" in update_data and update_data["name"]:
                update_fields["name"] = update_data["name"]
            if "goal" in update_data:
                update_fields["goal"] = update_data["goal"]
            if "start_date" in update_data:
                update_fields["start_date"] = update_data["start_date"]
            if "end_date" in update_data:
                update_fields["end_date"] = update_data["end_date"]

        result = await sprint_collection.find_one_and_update(
            {"_id": sprint_object_id, "project_id": project_object_id},
            {"$set": update_fields},
            return_document=ReturnDocument.AFTER,
        )
        if not result:
            raise NotFoundError("Sprint not found")
        return _serialize_sprint(result)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def complete_sprint(project_id: str, sprint_id: str) -> dict:
    try:
        project_object_id = _to_object_id(project_id, "project id")
        sprint_object_id = _to_object_id(sprint_id, "sprint id")
        result = await sprint_collection.find_one_and_update(
            {"_id": sprint_object_id, "project_id": project_object_id},
            {"$set": {"state": "completed", "updated_at": datetime.utcnow()}},
            return_document=ReturnDocument.AFTER,
        )
        if not result:
            raise NotFoundError("Sprint not found")
        return _serialize_sprint(result)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error