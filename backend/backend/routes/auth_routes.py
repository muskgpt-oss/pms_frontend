import os

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import HTMLResponse

from schemas.auth_schema import ForgotPasswordRequest, OnboardingRequest, SignInRequest, SignUpRequest, VerifySignupOtpRequest
from services.auth_service import complete_onboarding, get_current_user, reset_password, sign_in, sign_up, verify_signup_otp
from services.exceptions import ConflictError, NotFoundError, StorageUnavailableError, ValidationError
from services.invite_service import accept_invite_for_email, get_invite_by_token, reject_invite_by_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])


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


@router.post("/signup")
async def post_signup(payload: SignUpRequest):
    try:
        return await sign_up(payload.email, payload.password, payload.username, payload.invite_token, payload.otp)
    except Exception as error:
        _handle_service_error(error)


@router.post("/signup/verify")
async def post_signup_verify(payload: VerifySignupOtpRequest):
    try:
        return await verify_signup_otp(payload.email, payload.otp)
    except Exception as error:
        _handle_service_error(error)


@router.post("/signin")
async def post_signin(payload: SignInRequest):
    try:
        return await sign_in(payload.email, payload.password, payload.invite_token)
    except Exception as error:
        _handle_service_error(error)


@router.post("/forgot-password")
async def post_forgot_password(payload: ForgotPasswordRequest):
    try:
        return await reset_password(payload.email, payload.new_password)
    except Exception as error:
        _handle_service_error(error)


@router.get("/invites/{token}")
async def get_invite(token: str):
    try:
        return await get_invite_by_token(token)
    except Exception as error:
        _handle_service_error(error)


@router.post("/invites/{token}/accept")
async def post_accept_invite(
    token: str,
    x_auth_token: str = Header(default="", alias="X-Auth-Token"),
):
    try:
        user = await get_current_user(x_auth_token)
        return await accept_invite_for_email(token, user["email"])
    except Exception as error:
        _handle_service_error(error)


@router.post("/invites/{token}/reject")
async def post_reject_invite(token: str):
    try:
        return await reject_invite_by_token(token)
    except Exception as error:
        _handle_service_error(error)


@router.get("/invites/{token}/open", response_class=HTMLResponse)
async def open_invite_link(token: str, action: str = "accept"):
    try:
        details = await get_invite_by_token(token)
        frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").strip().rstrip("/")

        if action == "reject":
            await reject_invite_by_token(token)
            return HTMLResponse(
                content=(
                    "<html><body style='font-family:Arial,sans-serif;padding:24px;'>"
                    "<h2>Invitation Rejected</h2>"
                    f"<p>You have rejected the invitation for project <b>{details['project_name']}</b>.</p>"
                    "</body></html>"
                )
            )

        signin_link = f"{frontend_base_url}/?invite_token={token}&invite_action=accept&auth_mode=signin"
        signup_link = f"{frontend_base_url}/?invite_token={token}&invite_action=accept&auth_mode=signup"

        return HTMLResponse(
            content=(
                "<html><body style='font-family:Arial,sans-serif;padding:24px;max-width:760px;'>"
                "<h2>Project Invitation</h2>"
                f"<p>You were invited to join <b>{details['project_name']}</b> as <b>{details['email']}</b>.</p>"
                f"<p>Your assigned project role is <b>{details.get('role', 'restricted')}</b>.</p>"
                "<p>Choose one option below:</p>"
                f"<p><a href='{signin_link}' style='display:inline-block;padding:10px 14px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;'>I already have PMS account (Sign In)</a></p>"
                f"<p><a href='{signup_link}' style='display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;'>I am new to PMS (Sign Up)</a></p>"
                "<p style='color:#475569;font-size:13px;'>If localhost link is not reachable on this device, open PMS on the host machine or set FRONTEND_BASE_URL to a publicly reachable URL.</p>"
                "</body></html>"
            )
        )
    except Exception as error:
        _handle_service_error(error)


@router.get("/me")
async def get_me(x_auth_token: str = Header(default="", alias="X-Auth-Token")):
    try:
        return await get_current_user(x_auth_token)
    except Exception as error:
        _handle_service_error(error)


@router.post("/onboarding")
async def post_onboarding(
    payload: OnboardingRequest,
    x_auth_token: str = Header(default="", alias="X-Auth-Token"),
):
    try:
        return await complete_onboarding(x_auth_token, payload.model_dump())
    except Exception as error:
        _handle_service_error(error)