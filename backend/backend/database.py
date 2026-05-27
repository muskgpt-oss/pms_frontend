import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, TEXT
from pymongo.errors import PyMongoError

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "pms_db")

client = AsyncIOMotorClient(
    MONGODB_URI,
    serverSelectionTimeoutMS=3000,
)
database = client[MONGODB_DB]


def get_collection(name: str):
    return database[name]


async def ping_database() -> tuple[bool, str]:
    try:
        await client.admin.command("ping")
        return True, "ok"
    except PyMongoError as error:
        return False, str(error)


async def initialize_indexes() -> None:
    projects = get_collection("projects")
    issues = get_collection("issues")
    sprints = get_collection("sprints")
    issue_history = get_collection("issue_history")
    comments = get_collection("comments")
    notifications = get_collection("notifications")
    audit_logs = get_collection("audit_logs")
    users = get_collection("users")
    auth_sessions = get_collection("auth_sessions")
    project_invites = get_collection("project_invites")
    signup_verifications = get_collection("signup_verifications")
    sprint_epic_links = get_collection("sprint_epic_links")

    await projects.create_index([("key", ASCENDING)], unique=True)
    await projects.create_index([("created_at", DESCENDING)])

    await issues.create_index([("issue_key", ASCENDING)], unique=True)
    await issues.create_index([("project_id", ASCENDING), ("created_at", DESCENDING)])
    await issues.create_index([("project_id", ASCENDING), ("status", ASCENDING)])
    await issues.create_index([("project_id", ASCENDING), ("sprint_id", ASCENDING)])
    await issues.create_index([("project_id", ASCENDING), ("epic_issue_id", ASCENDING)])
    await issues.create_index([("project_id", ASCENDING), ("parent_issue_id", ASCENDING)])
    await issues.create_index([("project_id", ASCENDING), ("issue_number", ASCENDING)], unique=True)
    await issues.create_index([("title", TEXT), ("issue_key", TEXT), ("description", TEXT)])

    await sprints.create_index([("project_id", ASCENDING), ("state", ASCENDING)])
    await sprints.create_index([("project_id", ASCENDING), ("created_at", DESCENDING)])

    await issue_history.create_index([("issue_id", ASCENDING), ("created_at", DESCENDING)])
    await comments.create_index([("issue_id", ASCENDING), ("created_at", DESCENDING)])
    await notifications.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await notifications.create_index([("user_id", ASCENDING), ("read_at", ASCENDING)])
    await audit_logs.create_index([("project_id", ASCENDING), ("created_at", DESCENDING)])
    await users.create_index([("email", ASCENDING)], unique=True)
    await auth_sessions.create_index([("token", ASCENDING)], unique=True)
    await auth_sessions.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await project_invites.create_index([("token", ASCENDING)], unique=True)
    await project_invites.create_index([("project_id", ASCENDING), ("email", ASCENDING), ("accepted_at", ASCENDING)])
    await signup_verifications.create_index([("email", ASCENDING)], unique=True)
    await signup_verifications.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    await sprint_epic_links.create_index([("project_id", ASCENDING), ("sprint_id", ASCENDING), ("epic_id", ASCENDING)], unique=True)