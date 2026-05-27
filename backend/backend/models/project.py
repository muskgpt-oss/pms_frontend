from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    key: Optional[str] = Field(default=None, min_length=2, max_length=10)
    description: Optional[str] = ""


class Project(ProjectCreate):
    id: str
    created_at: datetime
    updated_at: datetime
