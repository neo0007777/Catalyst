from typing import Optional
from sqlmodel import Field, SQLModel
from datetime import datetime

class DecisionLog(SQLModel, table=True):
    """
    Logs every inference request and its decision out of the algorithmic models.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    decision_type: str
    input_hash: str
    decision: str
    confidence: float
    primary_factor: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AppealLog(SQLModel, table=True):
    """
    Logs contested inferences.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    decision_log_id: int = Field(foreign_key="decisionlog.id")
    appeal_text_length: int
    mitigation_found: bool
    verdict_changed: bool
    old_confidence: float
    new_confidence: float
    created_at: datetime = Field(default_factory=datetime.utcnow)

class BiasAlert(SQLModel, table=True):
    """
    Tracks and stores metrics regarding flagged fairness disparities.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    pattern_description: str
    affected_factor: str
    baseline_rate: float
    observed_rate: float
    severity: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
