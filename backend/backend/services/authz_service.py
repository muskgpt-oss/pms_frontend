from bson import ObjectId
from pymongo.errors import PyMongoError

from database import get_collection
from services.exceptions import NotFoundError, StorageUnavailableError, ValidationError

project_collection = get_collection("projects")
issue_collection = get_collection("issues")
session_collection = get_collection("auth_sessions")
user_collection = get_collection("users")

ROLE_CAPABILITIES = {
    "viewer": {"issue:read", "comment:create", "notification:read"},
    "restricted": {
        "issue:read",
        "issue:transition",
        "workflow:edit",
        "comment:create",
        "notification:read",
    },
    "developer": {
        "issue:read",
        "issue:create",
        "issue:update",
        "issue:transition",
        "issue:archive",
        "issue:bulk_update",
        "workflow:edit",
        "comment:create",
        "notification:read",
    },
    "lead": {
        "issue:read",
        "issue:create",
        "issue:update",
        "issue:transition",
        "issue:archive",
        "issue:bulk_update",
        "workflow:edit",
        "sprint:manage",
        "member:invite",
        "comment:create",
        "notification:read",
    },
}


def ensure_capability(project_role: str | None, capability: str) -> None:
    role = (project_role or "developer").strip().lower()
    capabilities = ROLE_CAPABILITIES.get(role)
    if not capabilities or capability not in capabilities:
        raise ValidationError(f"Capability denied: {capability}")


def _to_object_id(value: str, name: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise ValidationError(f"Invalid {name}")
    return ObjectId(value)


def _normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def _extract_role_from_project(project: dict, email: str) -> str:
    lead_email = _normalize_email(project.get("lead"))
    member_roles = project.get("member_roles") or []
    members = {_normalize_email(member) for member in project.get("members", [])}

    # Legacy projects may have no role metadata at all. Treat as owner-accessible
    # so existing workspaces continue to function.
    if not lead_email and not member_roles and not members:
        return "lead"

    for item in member_roles:
        if _normalize_email(item.get("email")) == email:
            role = str(item.get("role") or "").strip().lower()
            if role in ROLE_CAPABILITIES:
                return role

    if lead_email == email:
        return "lead"

    if email in members:
        return "developer"

    raise ValidationError("User is not a member of this project")


async def resolve_project_role(project_id: str, auth_token: str | None, fallback_role: str | None = None) -> str:
    if not auth_token:
        raise ValidationError("Missing auth token")

    project_object_id = _to_object_id(project_id, "project id")
    try:
        session = await session_collection.find_one({"token": str(auth_token).strip()})
        if not session:
            raise ValidationError("Invalid auth token")

        user = await user_collection.find_one({"_id": session["user_id"]})
        if not user:
            raise NotFoundError("User not found")

        project = await project_collection.find_one({"_id": project_object_id})
        if not project:
            raise NotFoundError("Project not found")

        return _extract_role_from_project(project, _normalize_email(user.get("email")))
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def resolve_project_role_for_issue(issue_id: str, auth_token: str | None, fallback_role: str | None = None) -> str:
    issue_object_id = _to_object_id(issue_id, "issue id")
    try:
        issue = await issue_collection.find_one({"_id": issue_object_id}, {"project_id": 1})
        if not issue:
            raise NotFoundError("Issue not found")
        return await resolve_project_role(str(issue["project_id"]), auth_token, fallback_role)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error