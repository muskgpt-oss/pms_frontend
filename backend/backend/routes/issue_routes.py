from fastapi import APIRouter, HTTPException, Request

from schemas.issue_schema import CommentCreate, IssueBulkUpdate, IssueUpdate
from services.auth_service import get_current_user
from services.authz_service import ensure_capability, resolve_project_role_for_issue
from services.exceptions import ConflictError, NotFoundError, StorageUnavailableError, ValidationError
from services.issue_service import (
    assert_transition_allowed_for_role,
    archive_issue,
    assign_issue_to_sprint,
    bulk_update_issues,
    delete_issue_permanently,
    create_comment,
    get_issue,
    get_issue_history,
    list_comments,
    transition_issue,
    update_issue,
)
from services.notification_service import list_notifications, mark_notification_read

router = APIRouter(prefix="/api/issues", tags=["Issues"])


async def _require_authenticated_user(request: Request) -> dict:
    auth_token = request.headers.get("x-auth-token")
    if not auth_token:
        raise ValidationError("Missing auth token")
    return await get_current_user(auth_token)


def _handle_service_error(error: Exception) -> None:
    if isinstance(error, ValidationError):
        raise HTTPException(status_code=422, detail=str(error))
    if isinstance(error, ConflictError):
        raise HTTPException(status_code=409, detail=str(error))
    if isinstance(error, NotFoundError):
        raise HTTPException(status_code=404, detail=str(error))
    if isinstance(error, StorageUnavailableError):
        raise HTTPException(status_code=503, detail="Database unavailable")
    raise error


@router.patch("/{issue_id}")
async def patch_issue(issue_id: str, payload: IssueUpdate, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:update")
        issue = await update_issue(issue_id, payload.model_dump(exclude_unset=True))
    except Exception as error:
        _handle_service_error(error)

    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


@router.get("/{issue_id}")
async def get_issue_detail(issue_id: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        return await get_issue(issue_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{issue_id}/transition/{status}")
async def post_transition_issue(issue_id: str, status: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:transition")
        await assert_transition_allowed_for_role(issue_id, status, role)
        return await transition_issue(issue_id, status)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{issue_id}/assign-sprint/{sprint_id}")
async def post_assign_issue_sprint(issue_id: str, sprint_id: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:update")
        return await assign_issue_to_sprint(issue_id, sprint_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{issue_id}/remove-sprint")
async def post_remove_issue_sprint(issue_id: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:update")
        return await assign_issue_to_sprint(issue_id, None)
    except Exception as error:
        _handle_service_error(error)


@router.get("/{issue_id}/history")
async def get_issue_activity(issue_id: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        return await get_issue_history(issue_id)
    except Exception as error:
        _handle_service_error(error)


@router.get("/{issue_id}/comments")
async def get_issue_comments(issue_id: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        return await list_comments(issue_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{issue_id}/comments")
async def post_issue_comment(issue_id: str, payload: CommentCreate, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "comment:create")
        return await create_comment(issue_id, payload.body, payload.author_id)
    except Exception as error:
        _handle_service_error(error)


@router.delete("/{issue_id}")
async def delete_issue(issue_id: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:archive")
        return await archive_issue(issue_id)
    except Exception as error:
        _handle_service_error(error)


@router.delete("/{issue_id}/hard")
async def delete_issue_hard(issue_id: str, request: Request):
    try:
        role = await resolve_project_role_for_issue(
            issue_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:archive")
        return await delete_issue_permanently(issue_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/bulk")
async def post_bulk_issue_update(payload: IssueBulkUpdate, request: Request):
    try:
        await _require_authenticated_user(request)
        for issue_id in payload.issue_ids:
            role = await resolve_project_role_for_issue(
                issue_id,
                request.headers.get("x-auth-token"),
                request.headers.get("x-project-role"),
            )
            ensure_capability(role, "issue:bulk_update")
        return await bulk_update_issues(payload.issue_ids, payload.updates.model_dump())
    except Exception as error:
        _handle_service_error(error)


@router.get("/notifications/{user_id}")
async def get_user_notifications(user_id: str, request: Request, unread_only: bool = False):
    try:
        user = await _require_authenticated_user(request)
        if user.get("id") != user_id:
            raise ValidationError("Cannot access notifications for another user")
        return await list_notifications(user_id, unread_only=unread_only)
    except Exception as error:
        _handle_service_error(error)


@router.post("/notifications/{user_id}/{notification_id}/read")
async def post_mark_notification_read(user_id: str, notification_id: str, request: Request):
    try:
        user = await _require_authenticated_user(request)
        if user.get("id") != user_id:
            raise ValidationError("Cannot update notifications for another user")
        notification = await mark_notification_read(notification_id, user_id)
        if not notification:
            raise HTTPException(status_code=404, detail="Notification not found")
        return notification
    except Exception as error:
        _handle_service_error(error)
