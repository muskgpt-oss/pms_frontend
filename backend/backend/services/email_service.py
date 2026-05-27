import os
import smtplib
from email.message import EmailMessage

from services.exceptions import StorageUnavailableError, ValidationError


def _smtp_settings() -> dict:
    raw_password = os.getenv("SMTP_PASSWORD", "").strip()
    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "username": os.getenv("SMTP_USERNAME", "").strip(),
        "password": raw_password.replace(" ", ""),
        "from_email": os.getenv("SMTP_FROM_EMAIL", "").strip(),
        "frontend_base_url": os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").strip(),
        "backend_base_url": os.getenv("BACKEND_BASE_URL", "http://localhost:8000").strip(),
    }


def send_project_invite_email(*, to_email: str, project_name: str, invite_token: str, role: str = "restricted") -> str:
    settings = _smtp_settings()
    required = [settings["host"], settings["from_email"], settings["username"], settings["password"]]
    if not all(required):
        raise ValidationError("SMTP is not configured. Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL.")

    invite_landing = settings["backend_base_url"].rstrip("/")
    join_link = f"{invite_landing}/api/auth/invites/{invite_token}/open?action=accept"
    reject_link = f"{invite_landing}/api/auth/invites/{invite_token}/open?action=reject"

    message = EmailMessage()
    message["Subject"] = f"Invitation to join project: {project_name}"
    message["From"] = settings["from_email"]
    message["To"] = to_email
    message.set_content(
        "\n".join(
            [
                f"You have been invited to join the project '{project_name}'.",
                f"Assigned project role: {role}.",
                "",
                "Use the secure link below to join:",
                join_link,
                "",
                "If you do not want to join, reject the invitation:",
                reject_link,
                "",
                "If you already have an account, sign in to join directly.",
                "If you are new, sign up first and you will be added automatically.",
            ]
        )
    )

    try:
        with smtplib.SMTP(settings["host"], settings["port"], timeout=20) as server:
            server.starttls()
            server.login(settings["username"], settings["password"])
            server.send_message(message)
    except Exception as error:  # noqa: BLE001
        raise StorageUnavailableError(f"Failed to send invite email: {error}") from error

    return join_link


def send_email_verification_otp(*, to_email: str, otp: str, expiry_minutes: int) -> None:
    settings = _smtp_settings()
    required = [settings["host"], settings["from_email"], settings["username"], settings["password"]]
    if not all(required):
        raise ValidationError("SMTP is not configured. Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL.")

    message = EmailMessage()
    message["Subject"] = "Verify your email address"
    message["From"] = settings["from_email"]
    message["To"] = to_email
    message.set_content(
        "\n".join(
            [
                "Welcome to PMS!",
                "",
                "You are creating an account on PMS with this email address.",
                "",
                "Use this one-time verification code to complete your signup:",
                otp,
                "",
                f"This code expires in {expiry_minutes} minutes.",
                "If you did not request this, you can ignore this email.",
            ]
        )
    )

    try:
        with smtplib.SMTP(settings["host"], settings["port"], timeout=20) as server:
            server.starttls()
            server.login(settings["username"], settings["password"])
            server.send_message(message)
    except smtplib.SMTPRecipientsRefused as error:
        raise ValidationError("This user ID does not exist or this email does not exist") from error
    except smtplib.SMTPResponseException as error:
        if error.smtp_code in {550, 551, 553}:
            raise ValidationError("This user ID does not exist or this email does not exist") from error
        raise StorageUnavailableError(f"Failed to send verification email: {error}") from error
    except Exception as error:  # noqa: BLE001
        raise StorageUnavailableError(f"Failed to send verification email: {error}") from error