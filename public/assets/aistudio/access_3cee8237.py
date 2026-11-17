"""Project-scoped access checks shared by every router."""

from fastapi import HTTPException

from lib.db import db


def project_scope(member: dict) -> dict:
    if member["role"] == "admin":
        return {}
    uid = member["user_id"]
    return {"$or": [{"owner_id": uid}, {"member_ids": uid}, {"demo": True}]}


def can_edit(project: dict, member: dict) -> bool:
    if member["role"] == "admin":
        return True
    if project.get("demo") or member["role"] != "investigador":
        return False
    uid = member["user_id"]
    return project["owner_id"] == uid or uid in project.get("member_ids", [])


async def get_project(project_id: str, member: dict, write: bool = False) -> dict:
    p = await db.projects.find_one({"id": project_id, **project_scope(member)}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    if write and not can_edit(p, member):
        raise HTTPException(status_code=403, detail="No puedes editar este proyecto")
    return p


async def get_dataset(dataset_id: str, member: dict, write: bool = False) -> tuple[dict, dict]:
    d = await db.datasets.find_one({"id": dataset_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Base de datos no encontrada")
    p = await get_project(d["project_id"], member, write)
    return d, p


async def get_form(form_id: str, member: dict, write: bool = False) -> tuple[dict, dict]:
    f = await db.forms.find_one({"id": form_id}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    p = await get_project(f["project_id"], member, write)
    return f, p
