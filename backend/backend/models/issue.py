from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


IssueType = Literal["story", "task", "bug", "epic", "subtask", "feature", "issue"]
IssuePriority = Literal["low", "medium", "high"]


class IssueCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = ""
    issue_type: IssueType = "task"
    status: str = Field(default="backlog", min_length=1, max_length=100)
    priority: IssuePriority = "medium"
    assignee: Optional[str] = None


class IssueUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=3, max_length=200)
    description: Optional[str] = None
    issue_type: Optional[IssueType] = None
    status: Optional[str] = Field(default=None, min_length=1, max_length=100)
    priority: Optional[IssuePriority] = None
    assignee: Optional[str] = None


class Issue(IssueCreate):
    id: str
    project_id: str
    issue_key: str
    created_at: datetime
    updated_at: datetime
