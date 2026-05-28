# PMS (Jira-style PoC)

Initial full-stack PoC for a small Jira-like project management system.

## Team Member
- Muskaan Gupta 
- Muskan Kumari
- Muskan Kulria

## Stack
- Backend: FastAPI + MongoDB (Motor)
- Frontend: React + Axios + TanStack Query + Tailwind CSS
hh
## Structure

- `backend/`
  - `routes/`
  - `models/`
  - `schemas/`
  - `services/`
- `frontend/`
  - `src/pages/<page>/index.jsx` + local `components/`
  - `src/components/` (global components)
  - `src/styles/` (global styling)

## Features (PoC)

- Project setup with key, lead, and type
- Sprint lifecycle (`planned -> active -> completed`)
- Backlog + sprint assignment
- Project-level workflow configuration (`GET/PUT /api/projects/{project_id}/workflow`)
- Workflow-driven transitions via transition endpoint
- Active sprint board grouped by workflow columns
- Issue metadata: assignee, reporter, labels, story points
- Issue activity history (`GET /api/issues/{issue_id}/history`)
- Issue detail panel with inline edits, transitions, comments, and timeline
- SSE realtime invalidation (`/api/events/projects/{project_id}`)
- Soft-archive issues and optimistic locking (`expected_updated_at` in PATCH)
- Backlog quick-create, filtering, and bulk updates

## Backend setup

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Target backend Python version: `3.12.2` (see `backend/.python-version`).

Backend health check: `http://localhost:8000/health`

If MongoDB is not running or not reachable, data endpoints return:

- `503 {"detail":"Database unavailable"}`

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend URL (default): `http://localhost:5173`

## MongoDB

Run a local MongoDB instance on:

`mongodb://localhost:27017`

Or update `backend/.env` values for your MongoDB deployment.

## Local prerequisites

- Python 3.12.2
- Node.js + npm (required for frontend install/build)
- MongoDB server (`mongod`) for full CRUD runtime validation

## Core API routes

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `GET /api/projects/{project_id}/issues`
- `POST /api/projects/{project_id}/issues`
- `GET /api/projects/{project_id}/backlog`
- `GET /api/projects/{project_id}/board`
- `GET /api/projects/{project_id}/workflow`
- `PUT /api/projects/{project_id}/workflow`
- `GET /api/projects/{project_id}/audit`
- `GET /api/projects/{project_id}/sprints`
- `POST /api/projects/{project_id}/sprints`
- `POST /api/projects/{project_id}/sprints/{sprint_id}/start`
- `POST /api/projects/{project_id}/sprints/{sprint_id}/complete`
- `GET /api/issues/{issue_id}`
- `PATCH /api/issues/{issue_id}`
- `POST /api/issues/{issue_id}/transition/{status}`
- `GET /api/issues/{issue_id}/history`
- `GET /api/issues/{issue_id}/comments`
- `POST /api/issues/{issue_id}/comments`
- `DELETE /api/issues/{issue_id}`
- `POST /api/issues/bulk`
- `POST /api/issues/{issue_id}/assign-sprint/{sprint_id}`
- `POST /api/issues/{issue_id}/remove-sprint`
- `GET /api/issues/notifications/{user_id}`
- `POST /api/issues/notifications/{user_id}/{notification_id}/read`
- `GET /api/events/projects/{project_id}`

## Phase workflow

1. Create/select a project in the `Projects` tab.
2. Create sprints and issues in the `Backlog` tab.
3. Start a sprint from backlog.
4. Move issues across board columns in the `Board` tab.

## Screenshots
<img width="1470" height="797" alt="Screenshot 2026-05-28 at 2 11 49 AM" src="https://github.com/user-attachments/assets/703b7daa-04ef-47f2-8040-057542d6c5bf" />



