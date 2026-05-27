import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from services.authz_service import ensure_capability, resolve_project_role
from services.exceptions import NotFoundError, StorageUnavailableError, ValidationError
from services.realtime_service import subscribe, unsubscribe

router = APIRouter(prefix="/api/events", tags=["Events"])


@router.get("/projects/{project_id}")
async def get_project_events(project_id: str, request: Request):
    try:
        auth_token = request.headers.get("x-auth-token")
        if not auth_token:
            raise ValidationError("Missing auth token")
        role = await resolve_project_role(project_id, auth_token, request.headers.get("x-project-role"))
        ensure_capability(role, "issue:read")
    except ValidationError as error:
        raise HTTPException(status_code=401, detail=str(error))
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except StorageUnavailableError:
        raise HTTPException(status_code=503, detail="Database unavailable")

    queue = subscribe(project_id)

    async def event_stream():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"event: {event.get('type', 'message')}\ndata: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": heartbeat\n\n"
                except asyncio.CancelledError:
                    break
        finally:
            unsubscribe(project_id, queue)

    return StreamingResponse(event_stream(), media_type="text/event-stream")