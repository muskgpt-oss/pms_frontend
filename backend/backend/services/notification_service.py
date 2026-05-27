from datetime import datetime

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

from database import get_collection
from services.exceptions import StorageUnavailableError, ValidationError

notification_collection = get_collection("notifications")


def _serialize_notification(document: dict) -> dict:
    return {
        "id": str(document["_id"]),
        "user_id": document["user_id"],
        "actor_id": document.get("actor_id"),
        "type": document["type"],
        "entity_type": document.get("entity_type"),
        "entity_id": document.get("entity_id"),
        "payload": document.get("payload", {}),
        "read_at": document.get("read_at"),
        "created_at": document["created_at"],
    }


async def create_notification(
    user_id: str,
    notification_type: str,
    payload: dict,
    actor_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> dict:
    try:
        now = datetime.utcnow()
        document = {
            "user_id": user_id,
            "actor_id": actor_id,
            "type": notification_type,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": payload,
            "read_at": None,
            "created_at": now,
        }
        result = await notification_collection.insert_one(document)
        document["_id"] = result.inserted_id
        return _serialize_notification(document)
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def list_notifications(user_id: str, unread_only: bool = False) -> list[dict]:
    try:
        query: dict = {"user_id": user_id}
        if unread_only:
            query["read_at"] = None

        notifications = []
        cursor = notification_collection.find(query).sort("created_at", -1).limit(200)
        async for document in cursor:
            notifications.append(_serialize_notification(document))
        return notifications
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def mark_notification_read(notification_id: str, user_id: str) -> dict | None:
    if not ObjectId.is_valid(notification_id):
        raise ValidationError("Invalid notification id")

    try:
        now = datetime.utcnow()
        result = await notification_collection.find_one_and_update(
            {"_id": ObjectId(notification_id), "user_id": user_id},
            {"$set": {"read_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        return _serialize_notification(result) if result else None
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error