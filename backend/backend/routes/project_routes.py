from fastapi import APIRouter, HTTPException, Request, status

from schemas.epic_schema import EpicCreate, SprintEpicIncludeRequest
from schemas.project_schema import ProjectCreate, ProjectInviteRequest, WorkflowConfigInput
from schemas.sprint_schema import SprintCreate, SprintStartInput
from schemas.issue_schema import IssueCreate
from services.authz_service import ensure_capability, resolve_project_role
from services.auth_service import get_current_user
from services.exceptions import ConflictError, NotFoundError, StorageUnavailableError, ValidationError
from services.invite_service import create_project_invite
from services.issue_service import create_issue, get_backlog, get_board, list_issues
from services.project_service import (
    archive_project,
    create_project,
    delete_project_permanently,
    get_project_workflow,
    list_project_audit,
    list_projects,
    require_project,
    update_project_workflow,
)
from services.sprint_hierarchy_service import create_epic, get_project_sprint_hierarchy, include_epic_in_sprint
from services.sprint_service import complete_sprint, create_sprint, list_sprints, start_sprint

router = APIRouter(prefix="/api/projects", tags=["Projects"])


def _handle_service_error(error: Exception) -> None:
    if isinstance(error, NotFoundError):
        raise HTTPException(status_code=404, detail=str(error))
    if isinstance(error, ConflictError):
        raise HTTPException(status_code=409, detail=str(error))
    if isinstance(error, ValidationError):
        raise HTTPException(status_code=400, detail=str(error))
    if isinstance(error, StorageUnavailableError):
        raise HTTPException(status_code=503, detail="Database unavailable")
    raise error


@router.get("")
async def get_projects(request: Request):
    try:
        auth_token = request.headers.get("x-auth-token")
        if not auth_token:
            raise ValidationError("Missing auth token")

        projects = await list_projects()
        user = await get_current_user(auth_token)
        email = str(user.get("email") or "").strip().lower()
        visible_projects = []
        for project in projects:
            lead_email = str(project.get("lead") or "").strip().lower()
            member_emails = {str(member).strip().lower() for member in project.get("members", [])}
            role_emails = {
                str(item.get("email") or "").strip().lower()
                for item in project.get("member_roles", [])
                if isinstance(item, dict)
            }
            if email and (email == lead_email or email in member_emails or email in role_emails):
                visible_projects.append(project)
        return visible_projects
    except Exception as error:
        _handle_service_error(error)


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_project(payload: ProjectCreate, request: Request):
    try:
        project_payload = payload.model_dump()
        if not project_payload.get("lead"):
            auth_token = request.headers.get("x-auth-token")
            if auth_token:
                user = await get_current_user(auth_token)
                email = str(user.get("email") or "").strip().lower()
                if email:
                    project_payload["lead"] = email
        return await create_project(project_payload)
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}")
async def get_project_by_id(project_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        return await require_project(project_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/archive")
async def post_archive_project(project_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "workflow:edit")
        return await archive_project(project_id)
    except Exception as error:
        _handle_service_error(error)


@router.delete("/{project_id}")
async def delete_project(project_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "workflow:edit")
        return await delete_project_permanently(project_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/issues", status_code=status.HTTP_201_CREATED)
async def post_issue(project_id: str, payload: IssueCreate, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:create")
        project = await require_project(project_id)
        return await create_issue(project, payload.model_dump())
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}/issues")
async def get_project_issues(
    project_id: str,
    request: Request,
    status: str | None = None,
    sprint_id: str | None = None,
    assignee: str | None = None,
    priority: str | None = None,
    issue_type: str | None = None,
    labels: str | None = None,
    q: str | None = None,
    include_archived: bool = False,
    limit: int | None = None,
):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        await require_project(project_id)
        label_list = [label.strip() for label in labels.split(",") if label.strip()] if labels else None
        return await list_issues(
            project_id,
            status=status,
            sprint_id=sprint_id,
            assignee=assignee,
            priority=priority,
            issue_type=issue_type,
            labels=label_list,
            q=q,
            include_archived=include_archived,
            limit=limit,
        )
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}/backlog")
async def get_project_backlog(project_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        await require_project(project_id)
        return await get_backlog(project_id)
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}/board")
async def get_project_board(project_id: str, request: Request, sprint_id: str | None = None):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        await require_project(project_id)
        return await get_board(project_id, sprint_id=sprint_id)
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}/workflow")
async def get_workflow(project_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        return await get_project_workflow(project_id)
    except Exception as error:
        _handle_service_error(error)


@router.put("/{project_id}/workflow")
async def put_workflow(project_id: str, payload: WorkflowConfigInput, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "workflow:edit")
        await require_project(project_id)
        return await update_project_workflow(project_id, payload.model_dump())
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}/audit")
async def get_project_audit(project_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "workflow:edit")
        await require_project(project_id)
        return await list_project_audit(project_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/invite")
async def post_project_invite(project_id: str, payload: ProjectInviteRequest, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "member:invite")
        project = await require_project(project_id)
        invited_by = project.get("lead")
        return await create_project_invite(project_id, payload.email, invited_by=invited_by, role=payload.role)
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}/sprints")
async def get_project_sprints(project_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        await require_project(project_id)
        return await list_sprints(project_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/sprints", status_code=status.HTTP_201_CREATED)
async def post_sprint(project_id: str, payload: SprintCreate, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "sprint:manage")
        await require_project(project_id)
        return await create_sprint(project_id, payload.model_dump())
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/sprints/{sprint_id}/start")
async def post_start_sprint(project_id: str, sprint_id: str, payload: SprintStartInput, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "sprint:manage")
        await require_project(project_id)
        return await start_sprint(project_id, sprint_id, payload.model_dump(exclude_unset=True))
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/sprints/{sprint_id}/complete")
async def post_complete_sprint(project_id: str, sprint_id: str, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "sprint:manage")
        await require_project(project_id)
        return await complete_sprint(project_id, sprint_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/epics", status_code=status.HTTP_201_CREATED)
async def post_create_epic(project_id: str, payload: EpicCreate, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "sprint:manage")
        await require_project(project_id)
        return await create_epic(project_id, payload.model_dump())
    except Exception as error:
        _handle_service_error(error)


@router.get("/{project_id}/sprint-hierarchy")
async def get_sprint_hierarchy(project_id: str, request: Request, sprint_id: str | None = None):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "issue:read")
        await require_project(project_id)
        return await get_project_sprint_hierarchy(project_id, sprint_id)
    except Exception as error:
        _handle_service_error(error)


@router.post("/{project_id}/sprints/{sprint_id}/epics/{epic_id}/include")
async def post_include_epic_in_sprint(project_id: str, sprint_id: str, epic_id: str, payload: SprintEpicIncludeRequest, request: Request):
    try:
        role = await resolve_project_role(
            project_id,
            request.headers.get("x-auth-token"),
            request.headers.get("x-project-role"),
        )
        ensure_capability(role, "sprint:manage")
        await require_project(project_id)
        return await include_epic_in_sprint(
            project_id,
            sprint_id,
            epic_id,
            payload.include_mode,
            payload.task_ids,
            payload.subtask_ids,
        )
    except Exception as error:
        _handle_service_error(error)
