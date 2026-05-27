from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


IssueType = Literal["story", "task", "bug", "epic", "subtask", "feature", "issue"]
IssuePriority = Literal["low", "medium", "high"]


class IssueCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = ""
    issue_type: IssueType = "task"
    work_type: Optional[str] = Field(default="task", min_length=1, max_length=100)
    status: str = Field(default="backlog", min_length=1, max_length=100)
    priority: IssuePriority = "medium"
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    watchers: list[str] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    story_points: Optional[int] = Field(default=None, ge=0, le=100)
    sprint_id: Optional[str] = None
    epic_issue_id: Optional[str] = None
    parent_issue_id: Optional[str] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None


class IssueUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=3, max_length=200)
    description: Optional[str] = None
    issue_type: Optional[IssueType] = None
    work_type: Optional[str] = Field(default=None, min_length=1, max_length=100)
    status: Optional[str] = Field(default=None, min_length=1, max_length=100)
    priority: Optional[IssuePriority] = None
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    watchers: Optional[list[str]] = None
    labels: Optional[list[str]] = None
    story_points: Optional[int] = Field(default=None, ge=0, le=100)
    sprint_id: Optional[str] = None
    epic_issue_id: Optional[str] = None
    parent_issue_id: Optional[str] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    expected_updated_at: Optional[datetime] = None


class IssueBulkUpdate(BaseModel):
    issue_ids: list[str] = Field(..., min_length=1)
    updates: IssueUpdate


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    author_id: Optional[str] = None


class Comment(BaseModel):
    id: str
    issue_id: str
    author_id: str
    body: str
    created_at: datetime
    updated_at: datetime


class Issue(IssueCreate):
    id: str
    project_id: str
    issue_key: str
    created_at: datetime
    updated_at: datetime
