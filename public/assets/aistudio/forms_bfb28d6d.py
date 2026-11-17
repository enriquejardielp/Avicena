import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.access import get_form, get_project
from lib.auth import current_member
from lib.dataset_utils import load_rows, recompute_levels
from lib.db import db
from models.core import Dataset, Form, FormField, FormIn, RecordIn, RecordOut

router = APIRouter()

TYPE_MAP = {"number": "numeric", "yesno": "binary", "select": "categorical", "radio": "categorical",
            "date": "date", "text": "text", "textarea": "text", "checkbox": "text"}


def _variables(fields: list[FormField]) -> list[dict]:
    return [{"name": f.name, "label": f.label, "type": TYPE_MAP[f.type], "levels": []} for f in fields]


def _check_fields(fields: list[FormField]):
    names = [f.name for f in fields]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=422, detail="Los nombres de variable deben ser únicos")
    for f in fields:
        if f.type in ("select", "radio", "checkbox") and not [c for c in f.choices if c.strip()]:
            raise HTTPException(status_code=422, detail=f"El campo '{f.label}' necesita opciones")


async def _with_count(f: dict) -> Form:
    return Form(**{**f, "record_count": await db.rows.count_documents({"dataset_id": f["dataset_id"]})})


@router.get("/projects/{project_id}/forms", response_model=list[Form])
async def list_forms(project_id: str, member: dict = Depends(current_member)):
    await get_project(project_id, member)
    docs = await db.forms.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _with_count(f) for f in docs]


@router.post("/projects/{project_id}/forms", response_model=Form, status_code=201)
async def create_form(project_id: str, body: FormIn, member: dict = Depends(current_member)):
    await get_project(project_id, member, write=True)
    _check_fields(body.fields)
    ds = Dataset(project_id=project_id, name=f"Formulario · {body.name}", source="form", variables=_variables(body.fields))
    form = Form(project_id=project_id, dataset_id=ds.id, **body.model_dump())
    ds.form_id = form.id
    await db.datasets.insert_one(ds.model_dump())
    await db.forms.insert_one(form.model_dump(exclude={"record_count"}))
    return form


@router.get("/forms/{form_id}", response_model=Form)
async def get_one(form_id: str, member: dict = Depends(current_member)):
    f, _ = await get_form(form_id, member)
    return await _with_count(f)


@router.put("/forms/{form_id}", response_model=Form)
async def update_form(form_id: str, body: FormIn, member: dict = Depends(current_member)):
    f, _ = await get_form(form_id, member, write=True)
    _check_fields(body.fields)
    data = body.model_dump()
    await db.forms.update_one({"id": form_id}, {"$set": data})
    variables = recompute_levels(_variables(body.fields), await load_rows(f["dataset_id"]))
    await db.datasets.update_one({"id": f["dataset_id"]}, {"$set": {"variables": variables, "name": f"Formulario · {body.name}"}})
    return await _with_count({**f, **data})


@router.delete("/forms/{form_id}", status_code=204)
async def delete_form(form_id: str, member: dict = Depends(current_member)):
    f, _ = await get_form(form_id, member, write=True)
    await db.rows.delete_many({"dataset_id": f["dataset_id"]})
    await db.chat_messages.delete_many({"dataset_id": f["dataset_id"]})
    await db.datasets.delete_one({"id": f["dataset_id"]})
    await db.forms.delete_one({"id": form_id})


def _validate(fields: list[dict], data: dict) -> dict:
    out, errors = {}, []
    for fd in fields:
        f = FormField(**fd)
        v = data.get(f.name)
        empty = v is None or v == "" or v == []
        if empty:
            if f.required:
                errors.append(f"'{f.label}' es obligatorio")
            out[f.name] = None
            continue
        if f.type == "number":
            try:
                n = float(v)
            except (TypeError, ValueError):
                errors.append(f"'{f.label}' debe ser numérico")
                continue
            if f.min is not None and n < f.min or f.max is not None and n > f.max:
                errors.append(f"'{f.label}' fuera de rango ({f.min if f.min is not None else '−∞'} – {f.max if f.max is not None else '∞'})")
            out[f.name] = int(n) if n.is_integer() else n
        elif f.type == "yesno":
            out[f.name] = 1 if v in (1, True, "1", "si", "sí", "Sí", "yes") else 0
        elif f.type in ("select", "radio"):
            if str(v) not in f.choices:
                errors.append(f"'{f.label}': opción no válida")
            out[f.name] = str(v)
        elif f.type == "checkbox":
            vals = v if isinstance(v, list) else [v]
            if any(str(x) not in f.choices for x in vals):
                errors.append(f"'{f.label}': opción no válida")
            out[f.name] = "; ".join(str(x) for x in vals)
        else:
            out[f.name] = str(v).strip()
    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors))
    return out


@router.post("/forms/{form_id}/records", response_model=RecordOut, status_code=201)
async def submit_record(form_id: str, body: RecordIn, member: dict = Depends(current_member)):
    f, p = await get_form(form_id, member)
    if p.get("demo") and member["role"] != "admin":
        raise HTTPException(status_code=403, detail="Los proyectos demo son de solo lectura")
    data = _validate(f["fields"], body.data)
    seq = await db.rows.count_documents({"dataset_id": f["dataset_id"]})
    rec = {"id": str(uuid.uuid4()), "dataset_id": f["dataset_id"], "seq": seq, "data": data,
           "created_by": member["user_id"], "created_at": datetime.now(timezone.utc)}
    await db.rows.insert_one(rec)
    ds = await db.datasets.find_one({"id": f["dataset_id"]}, {"_id": 0, "variables": 1})
    if ds:
        variables = recompute_levels(ds["variables"], await load_rows(f["dataset_id"]))
        await db.datasets.update_one({"id": f["dataset_id"]}, {"$set": {"variables": variables}})
    return RecordOut(**rec)


@router.get("/forms/{form_id}/records", response_model=list[RecordOut])
async def list_records(form_id: str, member: dict = Depends(current_member)):
    f, _ = await get_form(form_id, member)
    scope = {} if member["role"] != "capturador" else {"created_by": member["user_id"]}
    docs = await db.rows.find({"dataset_id": f["dataset_id"], **scope}, {"_id": 0}).sort("seq", -1).to_list(1000)
    return [RecordOut(**{**d, "created_at": d.get("created_at") or datetime.now(timezone.utc)}) for d in docs]
