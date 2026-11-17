import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


VarType = Literal["numeric", "categorical", "binary", "date", "text"]
FieldType = Literal["text", "number", "date", "select", "radio", "checkbox", "yesno", "textarea"]
TestName = Literal[
    "descriptives", "frequencies", "ttest", "paired_ttest", "mannwhitney", "chi2",
    "anova", "correlation", "linreg", "logreg", "kaplan_meier", "table1",
]
ModelName = Literal["claude", "gpt", "gemini"]


# ---- users ----
class Me(BaseModel):
    user_id: str
    email: str = ""
    name: str = ""
    role: str


class UserRow(BaseModel):
    user_id: str
    email: str = ""
    name: str = ""
    role: str


class UsersList(BaseModel):
    roles: list[str]
    users: list[UserRow]


class RoleIn(BaseModel):
    role: str


# ---- projects ----
class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)


class Project(BaseModel):
    id: str = Field(default_factory=_id)
    name: str
    description: str = ""
    owner_id: str
    member_ids: list[str] = []
    demo: bool = False
    created_at: datetime = Field(default_factory=_now)
    dataset_count: int = 0
    form_count: int = 0
    record_count: int = 0
    can_edit: bool = False


class MemberIn(BaseModel):
    email: str = Field(min_length=3)


# ---- datasets ----
class Variable(BaseModel):
    name: str
    label: str = ""
    type: VarType
    levels: list[str] = []


class Dataset(BaseModel):
    id: str = Field(default_factory=_id)
    project_id: str
    name: str
    source: Literal["upload", "form", "demo"] = "upload"
    form_id: Optional[str] = None
    variables: list[Variable] = []
    n_rows: int = 0
    created_at: datetime = Field(default_factory=_now)


class DatasetPage(BaseModel):
    dataset: Dataset
    rows: list[dict[str, Any]]
    total: int


class VariableTypeIn(BaseModel):
    type: VarType


# ---- forms ----
class FormField(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")
    label: str = Field(min_length=1)
    type: FieldType
    required: bool = False
    choices: list[str] = []
    min: Optional[float] = None
    max: Optional[float] = None
    unit: str = ""
    help: str = ""


class FormIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    fields: list[FormField] = []


class Form(BaseModel):
    id: str = Field(default_factory=_id)
    project_id: str
    dataset_id: str
    name: str
    description: str = ""
    fields: list[FormField] = []
    created_at: datetime = Field(default_factory=_now)
    record_count: int = 0


class RecordIn(BaseModel):
    data: dict[str, Any]


class RecordOut(BaseModel):
    id: str
    dataset_id: str
    data: dict[str, Any]
    created_at: datetime
    created_by: str = ""


# ---- analysis ----
class AnalysisRequest(BaseModel):
    dataset_id: str
    test: TestName
    params: dict[str, Any] = {}


class ResultTable(BaseModel):
    title: str
    columns: list[str]
    rows: list[list[Any]]
    note: str = ""


class ResultChart(BaseModel):
    type: Literal["histogram", "bar", "box", "scatter", "survival", "groupedbar"]
    title: str
    data: list[dict[str, Any]]
    x: str = ""
    series: list[str] = []
    meta: dict[str, Any] = {}


class AnalysisResult(BaseModel):
    test: str
    title: str
    summary: str = ""
    tables: list[ResultTable] = []
    charts: list[ResultChart] = []


# ---- AI ----
class ChatIn(BaseModel):
    dataset_id: str
    message: str = Field(min_length=1, max_length=4000)
    model: ModelName = "claude"


class ChatMessage(BaseModel):
    id: str = Field(default_factory=_id)
    dataset_id: str
    user_id: str
    role: Literal["user", "assistant"]
    content: str
    analysis: Optional[AnalysisResult] = None
    created_at: datetime = Field(default_factory=_now)
