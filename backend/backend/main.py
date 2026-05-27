import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import initialize_indexes, ping_database
from routes.auth_routes import router as auth_router
from routes.event_routes import router as event_router
from routes.issue_routes import router as issue_router
from routes.project_routes import router as project_router

load_dotenv()

app = FastAPI(title="PMS API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    db_ok, db_message = await ping_database()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": {
            "ok": db_ok,
            "message": db_message,
        },
    }


@app.on_event("startup")
async def startup_event() -> None:
    db_ok, _ = await ping_database()
    if db_ok:
        await initialize_indexes()


app.include_router(project_router)
app.include_router(issue_router)
app.include_router(event_router)
app.include_router(auth_router)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
