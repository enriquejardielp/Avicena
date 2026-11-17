"""Variable-type inference and row loading/cleaning."""

import math
from typing import Any

import numpy as np
import pandas as pd

from lib.db import db


def _clean(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return int(f) if f.is_integer() else f
    if isinstance(v, (pd.Timestamp,)):
        return v.date().isoformat() if v.time() == pd.Timestamp(0).time() else v.isoformat()
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


def infer_variables(df: pd.DataFrame) -> list[dict]:
    out = []
    for col in df.columns:
        s = df[col]
        nonnull = s.dropna()
        numeric = pd.to_numeric(nonnull, errors="coerce")
        vtype = "text"
        if len(nonnull) == 0:
            vtype = "text"
        elif numeric.notna().mean() > 0.95:
            uniq = set(numeric.dropna().unique())
            vtype = "binary" if uniq <= {0, 1} else ("categorical" if len(uniq) <= 6 and all(float(u).is_integer() for u in uniq) and len(nonnull) > 30 else "numeric")
        else:
            nun = nonnull.astype(str).nunique()
            if nun == 2:
                vtype = "binary"
            elif nun <= max(12, int(0.05 * len(nonnull))):
                vtype = "categorical"
            else:
                dates = pd.to_datetime(nonnull.astype(str), errors="coerce", format="mixed")
                vtype = "date" if dates.notna().mean() > 0.9 else "text"
        levels = []
        if vtype in ("categorical", "binary"):
            levels = sorted({str(_clean(v)) for v in nonnull})[:50]
        out.append({"name": str(col), "label": "", "type": vtype, "levels": levels})
    return out


def frame_to_rows(df: pd.DataFrame) -> list[dict]:
    df.columns = [str(c).strip() for c in df.columns]
    return [{k: _clean(v) for k, v in rec.items()} for rec in df.to_dict(orient="records")]


async def load_rows(dataset_id: str) -> list[dict]:
    docs = await db.rows.find({"dataset_id": dataset_id}, {"_id": 0, "data": 1}).sort("seq", 1).to_list(200000)
    return [d["data"] for d in docs]


def recompute_levels(variables: list[dict], rows: list[dict]) -> list[dict]:
    for v in variables:
        if v["type"] in ("categorical", "binary"):
            v["levels"] = sorted({str(r.get(v["name"])) for r in rows if r.get(v["name"]) is not None})[:50]
        else:
            v["levels"] = []
    return variables
