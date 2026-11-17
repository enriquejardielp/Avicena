import io

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from lib.access import get_dataset, get_project
from lib.auth import analyst
from lib.dataset_utils import frame_to_rows, infer_variables, load_rows, recompute_levels
from lib.db import db
from models.core import Dataset, DatasetPage, VariableTypeIn

router = APIRouter()

MAX_BYTES = 15 * 1024 * 1024


@router.get("/projects/{project_id}/datasets", response_model=list[Dataset])
async def list_datasets(project_id: str, member: dict = Depends(analyst)):
    await get_project(project_id, member)
    docs = await db.datasets.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        d["n_rows"] = await db.rows.count_documents({"dataset_id": d["id"]})
    return [Dataset(**d) for d in docs]


@router.post("/projects/{project_id}/datasets/upload", response_model=Dataset, status_code=201)
async def upload_dataset(project_id: str, file: UploadFile = File(...), name: str = Form(""), member: dict = Depends(analyst)):
    await get_project(project_id, member, write=True)
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande (máx. 15 MB)")
    fname = (file.filename or "").lower()
    try:
        if fname.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(raw))
        elif fname.endswith(".csv") or fname.endswith(".txt"):
            df = pd.read_csv(io.BytesIO(raw), sep=None, engine="python", encoding_errors="replace")
        else:
            raise HTTPException(status_code=400, detail="Formato no soportado. Usa CSV o Excel (.xlsx)")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {e}")
    if df.empty or len(df.columns) == 0:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    rows = frame_to_rows(df)
    ds = Dataset(project_id=project_id, name=name.strip() or (file.filename or "Datos").rsplit(".", 1)[0],
                 source="upload", variables=infer_variables(pd.DataFrame(rows)), n_rows=len(rows))
    await db.datasets.insert_one(ds.model_dump())
    if rows:
        await db.rows.insert_many([{"id": f"{ds.id}-{i}", "dataset_id": ds.id, "seq": i, "data": r, "created_by": member["user_id"]}
                                   for i, r in enumerate(rows)])
    return ds


@router.get("/datasets/{dataset_id}", response_model=DatasetPage)
async def get_rows(dataset_id: str, offset: int = 0, limit: int = 100, member: dict = Depends(analyst)):
    d, _ = await get_dataset(dataset_id, member)
    limit = max(1, min(limit, 500))
    total = await db.rows.count_documents({"dataset_id": dataset_id})
    docs = await db.rows.find({"dataset_id": dataset_id}, {"_id": 0, "data": 1}).sort("seq", 1).skip(max(0, offset)).limit(limit).to_list(limit)
    d["n_rows"] = total
    return DatasetPage(dataset=Dataset(**d), rows=[x["data"] for x in docs], total=total)


@router.patch("/datasets/{dataset_id}/variables/{name}", response_model=Dataset)
async def set_variable_type(dataset_id: str, name: str, body: VariableTypeIn, member: dict = Depends(analyst)):
    d, _ = await get_dataset(dataset_id, member, write=True)
    if not any(v["name"] == name for v in d["variables"]):
        raise HTTPException(status_code=404, detail="Variable no encontrada")
    for v in d["variables"]:
        if v["name"] == name:
            v["type"] = body.type
    d["variables"] = recompute_levels(d["variables"], await load_rows(dataset_id))
    await db.datasets.update_one({"id": dataset_id}, {"$set": {"variables": d["variables"]}})
    return Dataset(**d)


@router.get("/datasets/{dataset_id}/export")
async def export_csv(dataset_id: str, member: dict = Depends(analyst)):
    d, _ = await get_dataset(dataset_id, member)
    df = pd.DataFrame(await load_rows(dataset_id), columns=[v["name"] for v in d["variables"]])
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{d["name"]}.csv"'})


@router.delete("/datasets/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: str, member: dict = Depends(analyst)):
    d, _ = await get_dataset(dataset_id, member, write=True)
    if d.get("source") == "form":
        raise HTTPException(status_code=400, detail="Elimina el formulario para borrar su base de datos")
    await db.rows.delete_many({"dataset_id": dataset_id})
    await db.chat_messages.delete_many({"dataset_id": dataset_id})
    await db.datasets.delete_one({"id": dataset_id})
