from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


ProjectType = Literal["software", "business"]
ProjectInviteRole = Literal["restricted", "viewer", "developer", "lead"]


class WorkflowStateInput(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=100)
    category: Literal["todo", "in_progress", "done"]
    color: str = Field(default="#6B7280", min_length=4, max_length=10)
    position: int = Field(default=0, ge=0)
    is_initial: bool = False


class WorkflowTransitionInput(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=100)
    from_state_ids: list[str] = Field(..., min_length=1)
    to_state_id: str = Field(..., min_length=1, max_length=100)
    conditions: list[dict] = Field(default_factory=list)
    post_functions: list[dict] = Field(default_factory=list)
    position: int = Field(default=0, ge=0)


class WorkflowConfigInput(BaseModel):
    states: list[WorkflowStateInput] = Field(..., min_length=1)
    transitions: list[WorkflowTransitionInput] = Field(default_factory=list)


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    key: Optional[str] = Field(default=None, min_length=2, max_length=10)
    description: Optional[str] = ""
    lead: Optional[str] = None
    project_type: ProjectType = "software"
    workflow: Optional[WorkflowConfigInput] = None


class Project(ProjectCreate):
    id: str
    created_at: datetime
    updated_at: datetime


class ProjectInviteRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)
    role: ProjectInviteRole = "restricted"
