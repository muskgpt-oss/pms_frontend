from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

SprintState = Literal["planned", "active", "completed"]


class SprintCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    goal: Optional[str] = ""
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class SprintStartInput(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = ""
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class Sprint(SprintCreate):
    id: str
    project_id: str
    state: SprintState
    created_at: datetime
    updated_at: datetime