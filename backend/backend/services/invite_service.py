import secrets
from datetime import datetime, timedelta

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

from database import get_collection
from services.email_service import send_project_invite_email
from services.exceptions import NotFoundError, StorageUnavailableError, ValidationError

project_collection = get_collection("projects")
invite_collection = get_collection("project_invites")

ALLOWED_INVITE_ROLES = {"restricted", "viewer", "developer", "lead"}


def _to_object_id(value: str, name: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise ValidationError(f"Invalid {name}")
    return ObjectId(value)


def _normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def _normalize_role(value: str | None) -> str:
    normalized = str(value or "restricted").strip().lower()
    if normalized not in ALLOWED_INVITE_ROLES:
        raise ValidationError("Invalid project role")
    return normalized


async def add_member_to_project(project_id: str, email: str, role: str = "developer") -> None:
    project_object_id = _to_object_id(project_id, "project id")
    normalized_email = _normalize_email(email)
    normalized_role = _normalize_role(role)
    if not normalized_email:
        raise ValidationError("Member email is required")

    try:
        now = datetime.utcnow()
        result = await project_collection.update_one(
            {"_id": project_object_id},
            {
                "$addToSet": {"members": normalized_email},
                "$pull": {"member_roles": {"email": normalized_email}},
                "$set": {"updated_at": now},
            },
        )
        if result.matched_count == 0:
            raise NotFoundError("Project not found")

        await project_collection.update_one(
            {"_id": project_object_id},
            {
                "$push": {"member_roles": {"email": normalized_email, "role": normalized_role}},
                "$set": {"updated_at": now},
            },
        )
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def create_project_invite(
    project_id: str,
    email: str,
    invited_by: str | None = None,
    role: str | None = None,
) -> dict:
    project_object_id = _to_object_id(project_id, "project id")
    normalized_email = _normalize_email(email)
    normalized_role = _normalize_role(role)
    if not normalized_email:
        raise ValidationError("Invite email is required")

    try:
        project = await project_collection.find_one({"_id": project_object_id})
        if not project:
            raise NotFoundError("Project not found")

        existing_members = {member.lower() for member in project.get("members", [])}
        if normalized_email in existing_members:
            return {
                "project_id": project_id,
                "email": normalized_email,
                "already_member": True,
            }

        token = secrets.token_urlsafe(36)
        now = datetime.utcnow()
        expires_at = now + timedelta(days=7)

        await invite_collection.find_one_and_update(
            {"project_id": project_object_id, "email": normalized_email, "accepted_at": None},
            {
                "$set": {
                    "token": token,
                    "invited_by": invited_by,
                    "role": normalized_role,
                    "rejected_at": None,
                    "created_at": now,
                    "expires_at": expires_at,
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "project_id": project_object_id,
                    "email": normalized_email,
                    "accepted_at": None,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )

        join_link = send_project_invite_email(
            to_email=normalized_email,
            project_name=project.get("name", "Project"),
            invite_token=token,
            role=normalized_role,
        )

        return {
            "project_id": project_id,
            "email": normalized_email,
            "already_member": False,
            "role": normalized_role,
            "invite_link": join_link,
        }
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def get_invite_by_token(token: str) -> dict:
    token = str(token or "").strip()
    if not token:
        raise ValidationError("Invalid invite token")

    try:
        invite = await invite_collection.find_one({"token": token})
        if not invite:
            raise NotFoundError("Invite not found")

        project = await project_collection.find_one({"_id": invite["project_id"]})
        if not project:
            raise NotFoundError("Project not found")

        return {
            "token": token,
            "email": invite["email"],
            "role": invite.get("role", "restricted"),
            "project_id": str(project["_id"]),
            "project_name": project.get("name", "Project"),
            "accepted": bool(invite.get("accepted_at")),
            "rejected": bool(invite.get("rejected_at")),
            "expired": datetime.utcnow() > invite.get("expires_at", datetime.utcnow()),
        }
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def accept_invite_for_email(token: str, email: str) -> dict:
    normalized_email = _normalize_email(email)
    details = await get_invite_by_token(token)

    if details["expired"]:
        raise ValidationError("Invite link expired")
    if details.get("rejected"):
        raise ValidationError("Invite was rejected")
    if details["accepted"]:
        return {
            "project_id": details["project_id"],
            "project_name": details["project_name"],
            "already_member": True,
        }

    if normalized_email != _normalize_email(details["email"]):
        raise ValidationError("Invite email does not match signed in user")

    await add_member_to_project(details["project_id"], normalized_email, details.get("role", "restricted"))

    try:
        await invite_collection.update_one(
            {"token": token},
            {"$set": {"accepted_at": datetime.utcnow(), "updated_at": datetime.utcnow()}},
        )
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error

    return {
        "project_id": details["project_id"],
        "project_name": details["project_name"],
        "already_member": False,
    }


async def reject_invite_by_token(token: str) -> dict:
    token = str(token or "").strip()
    if not token:
        raise ValidationError("Invalid invite token")

    details = await get_invite_by_token(token)
    if details["accepted"]:
        raise ValidationError("Invite already accepted")
    if details.get("rejected"):
        return {
            "project_id": details["project_id"],
            "project_name": details["project_name"],
            "already_rejected": True,
        }

    try:
        await invite_collection.update_one(
            {"token": token},
            {"$set": {"rejected_at": datetime.utcnow(), "updated_at": datetime.utcnow()}},
        )
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error

    return {
        "project_id": details["project_id"],
        "project_name": details["project_name"],
        "already_rejected": False,
    }