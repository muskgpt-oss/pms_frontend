from typing import Literal, Optional

from pydantic import BaseModel, Field


class EpicCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = ""
    status: str = Field(default="backlog", min_length=1, max_length=100)
    priority: Literal["low", "medium", "high"] = "medium"
    assignee: Optional[str] = None
    reporter: Optional[str] = None


class SprintEpicIncludeRequest(BaseModel):
    include_mode: Literal["full", "selected"] = "full"
    task_ids: list[str] = Field(default_factory=list)
    subtask_ids: list[str] = Field(default_factory=list)
