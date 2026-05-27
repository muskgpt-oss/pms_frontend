from datetime import datetime

from pydantic import BaseModel, Field

EmailField = str


class SignUpRequest(BaseModel):
    email: EmailField
    password: str
    username: str
    otp: str | None = None
    invite_token: str | None = None


class SignInRequest(BaseModel):
    email: EmailField
    password: str
    invite_token: str | None = None


class VerifySignupOtpRequest(BaseModel):
    email: EmailField
    otp: str = Field(..., min_length=4, max_length=8)


class ForgotPasswordRequest(BaseModel):
    email: EmailField
    new_password: str = Field(..., min_length=8, max_length=256)


class OnboardingRequest(BaseModel):
    domain: str = Field(..., min_length=2, max_length=80)
    team_use_cases: list[str] = Field(default_factory=list)
    space_name: str = Field(..., min_length=2, max_length=120)
    board_columns: list[str] = Field(default_factory=lambda: ["To Do", "In Progress", "In Review", "Done"])
    invite_emails: list[EmailField] = Field(default_factory=list)


class AuthUserResponse(BaseModel):
    id: str
    email: EmailField
    username: str
    email_verified: bool = True
    onboarding_completed: bool
    domain: str | None = None
    team_use_cases: list[str] = Field(default_factory=list)
    space_name: str | None = None
    board_columns: list[str] = Field(default_factory=list)
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: AuthUserResponse