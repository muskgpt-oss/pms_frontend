import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta

from bson import ObjectId
from pymongo.errors import DuplicateKeyError, PyMongoError

from database import get_collection
from services.email_service import send_email_verification_otp
from services.exceptions import ConflictError, NotFoundError, StorageUnavailableError, ValidationError
from services.invite_service import accept_invite_for_email

user_collection = get_collection("users")
session_collection = get_collection("auth_sessions")
signup_verification_collection = get_collection("signup_verifications")

EMAIL_REGEX = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
DEFAULT_OTP_EXPIRY_MINUTES = 10
MAX_OTP_ATTEMPTS = 5


def _hash_password(password: str, salt: bytes | None = None) -> str:
    resolved_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), resolved_salt, 120_000)
    return f"{resolved_salt.hex()}:{digest.hex()}"


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        salt_hex, digest_hex = password_hash.split(":", 1)
        check_hash = _hash_password(password, bytes.fromhex(salt_hex))
        return hmac.compare_digest(check_hash.split(":", 1)[1], digest_hex)
    except ValueError:
        return False


def _hash_otp(email: str, otp: str) -> str:
    secret = os.getenv("OTP_SECRET", "dev-otp-secret").strip()
    payload = f"{email.lower().strip()}:{otp}:{secret}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_email(email: str) -> str:
    normalized = email.lower().strip()
    if not EMAIL_REGEX.match(normalized):
        raise ValidationError("Invalid email address")
    return normalized


def _serialize_user(document: dict) -> dict:
    return {
        "id": str(document["_id"]),
        "email": document["email"],
        "username": document["username"],
        "email_verified": document.get("email_verified", True),
        "onboarding_completed": document.get("onboarding_completed", False),
        "domain": document.get("domain"),
        "team_use_cases": document.get("team_use_cases", []),
        "space_name": document.get("space_name"),
        "board_columns": document.get("board_columns", []),
        "created_at": document["created_at"],
    }


async def _create_session(user_id: ObjectId) -> str:
    token = secrets.token_urlsafe(32)
    await session_collection.insert_one(
        {
            "token": token,
            "user_id": user_id,
            "created_at": datetime.utcnow(),
        }
    )
    return token


def _get_otp_expiry_minutes() -> int:
    value = os.getenv("OTP_EXPIRY_MINUTES", str(DEFAULT_OTP_EXPIRY_MINUTES)).strip()
    try:
        parsed = int(value)
        return parsed if parsed > 0 else DEFAULT_OTP_EXPIRY_MINUTES
    except ValueError:
        return DEFAULT_OTP_EXPIRY_MINUTES


def _generate_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000}"


async def request_signup_verification(email: str, password: str, username: str, invite_token: str | None = None) -> dict:
    normalized_email = _normalize_email(email)
    trimmed_username = username.strip()
    if len(trimmed_username) < 2:
        raise ValidationError("Username should be at least 2 characters")
    if len(password.strip()) < 8:
        raise ValidationError("Password should be at least 8 characters")

    try:
        existing_user = await user_collection.find_one({"email": normalized_email}, {"_id": 1})
        if existing_user:
            raise ConflictError("Email already registered. Please sign in.")

        expiry_minutes = _get_otp_expiry_minutes()
        otp = _generate_otp()
        now = datetime.utcnow()
        expires_at = now + timedelta(minutes=expiry_minutes)

        await signup_verification_collection.update_one(
            {"email": normalized_email},
            {
                "$set": {
                    "email": normalized_email,
                    "username": trimmed_username,
                    "password_hash": _hash_password(password),
                    "invite_token": invite_token,
                    "otp_hash": _hash_otp(normalized_email, otp),
                    "attempts": 0,
                    "expires_at": expires_at,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

        delivery_mode = os.getenv("OTP_DELIVERY_MODE", "smtp").strip().lower()
        if delivery_mode == "smtp":
            send_email_verification_otp(to_email=normalized_email, otp=otp, expiry_minutes=expiry_minutes)
        elif delivery_mode != "dev-inline":
            raise ValidationError("Invalid OTP_DELIVERY_MODE. Use 'smtp' or 'dev-inline'.")

        response = {
            "verification_required": True,
            "message": "Valid email detected. We are creating your account on PMS. Verification OTP sent to your email.",
            "email": normalized_email,
            "expires_in_minutes": expiry_minutes,
        }
        if delivery_mode == "dev-inline":
            response["message"] = "Development mode: use the OTP shown below"
            response["dev_otp"] = otp

        return response
    except (ValidationError, ConflictError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def verify_signup_otp(email: str, otp: str) -> dict:
    normalized_email = _normalize_email(email)
    now = datetime.utcnow()

    try:
        verification = await signup_verification_collection.find_one({"email": normalized_email})
        if not verification:
            raise ValidationError("Verification not initiated for this email")

        expires_at = verification.get("expires_at")
        if not expires_at or expires_at < now:
            await signup_verification_collection.delete_one({"_id": verification["_id"]})
            raise ValidationError("OTP expired. Please request a new OTP")

        if verification.get("attempts", 0) >= MAX_OTP_ATTEMPTS:
            raise ValidationError("Too many invalid OTP attempts. Please request a new OTP")

        expected_hash = verification.get("otp_hash", "")
        provided_hash = _hash_otp(normalized_email, otp.strip())
        if not hmac.compare_digest(expected_hash, provided_hash):
            await signup_verification_collection.update_one(
                {"_id": verification["_id"]},
                {"$inc": {"attempts": 1}, "$set": {"updated_at": now}},
            )
            raise ValidationError("Invalid OTP")

        payload = {
            "email": normalized_email,
            "username": verification["username"],
            "password_hash": verification["password_hash"],
            "email_verified": True,
            "email_verified_at": now,
            "onboarding_completed": bool(verification.get("invite_token")),
            "domain": "software development" if verification.get("invite_token") else None,
            "team_use_cases": [],
            "space_name": None,
            "board_columns": ["To Do", "In Progress", "In Review", "Done"],
            "created_at": now,
            "updated_at": now,
        }

        result = await user_collection.insert_one(payload)
        payload["_id"] = result.inserted_id

        await signup_verification_collection.delete_one({"_id": verification["_id"]})

        token = await _create_session(result.inserted_id)
        response = {"token": token, "user": _serialize_user(payload)}

        invite_token = verification.get("invite_token")
        if invite_token:
            invite_result = await accept_invite_for_email(invite_token, normalized_email)
            response["invited_project_id"] = invite_result["project_id"]

        return response
    except DuplicateKeyError as error:
        raise ConflictError("Email already registered") from error
    except (ValidationError, ConflictError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def sign_up(email: str, password: str, username: str, invite_token: str | None = None, otp: str | None = None) -> dict:
    if otp and otp.strip():
        return await verify_signup_otp(email, otp)
    return await request_signup_verification(email, password, username, invite_token)


async def sign_in(email: str, password: str, invite_token: str | None = None) -> dict:
    try:
        document = await user_collection.find_one({"email": _normalize_email(email)})
        if not document:
            raise ValidationError("Invalid email or password")
        if document.get("email_verified", True) is not True:
            raise ValidationError("Email not verified. Complete verification before login")
        if not _verify_password(password, document["password_hash"]):
            raise ValidationError("Invalid email or password")

        invited_project_id = None
        if invite_token:
            invite_result = await accept_invite_for_email(invite_token, document["email"])
            invited_project_id = invite_result["project_id"]
            if not document.get("onboarding_completed"):
                await user_collection.update_one(
                    {"_id": document["_id"]},
                    {
                        "$set": {
                            "onboarding_completed": True,
                            "domain": "software development",
                            "updated_at": datetime.utcnow(),
                        }
                    },
                )
                document["onboarding_completed"] = True
                document["domain"] = "software development"

        token = await _create_session(document["_id"])
        response = {"token": token, "user": _serialize_user(document)}
        if invited_project_id:
            response["invited_project_id"] = invited_project_id
        return response
    except ValidationError:
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def reset_password(email: str, new_password: str) -> dict:
    normalized_email = _normalize_email(email)
    if len(new_password.strip()) < 8:
        raise ValidationError("Password should be at least 8 characters")

    try:
        document = await user_collection.find_one({"email": normalized_email}, {"_id": 1})
        if not document:
            raise NotFoundError("Account not found for this email")

        await user_collection.update_one(
            {"_id": document["_id"]},
            {
                "$set": {
                    "password_hash": _hash_password(new_password),
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        return {"message": "Password updated successfully"}
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def get_current_user(token: str) -> dict:
    if not token:
        raise ValidationError("Missing auth token")
    try:
        session = await session_collection.find_one({"token": token})
        if not session:
            raise ValidationError("Invalid auth token")
        document = await user_collection.find_one({"_id": session["user_id"]})
        if not document:
            raise NotFoundError("User not found")
        return _serialize_user(document)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error


async def complete_onboarding(token: str, payload: dict) -> dict:
    if not token:
        raise ValidationError("Missing auth token")

    domain = payload["domain"].strip().lower()
    if domain != "software development":
        raise ValidationError("Only software development is available right now")

    try:
        session = await session_collection.find_one({"token": token})
        if not session:
            raise ValidationError("Invalid auth token")

        board_columns = [column.strip() for column in payload.get("board_columns", []) if column.strip()]
        if len(board_columns) < 4:
            raise ValidationError("Board should have at least 4 columns")

        await user_collection.update_one(
            {"_id": session["user_id"]},
            {
                "$set": {
                    "domain": "software development",
                    "team_use_cases": payload.get("team_use_cases", []),
                    "space_name": payload["space_name"].strip(),
                    "board_columns": board_columns,
                    "invite_emails": [str(email).lower() for email in payload.get("invite_emails", [])],
                    "onboarding_completed": True,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

        document = await user_collection.find_one({"_id": session["user_id"]})
        if not document:
            raise NotFoundError("User not found")
        return _serialize_user(document)
    except (ValidationError, NotFoundError):
        raise
    except PyMongoError as error:
        raise StorageUnavailableError("Storage is unavailable") from error