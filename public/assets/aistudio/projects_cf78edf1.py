from fastapi import APIRouter, Depends, HTTPException

from lib.access import can_edit, get_project, project_scope
from lib.auth import current_member, effective_role
from lib.db import db
from models.core import MemberIn, Me, Project, ProjectIn

router = APIRouter()


async def _with_counts(p: dict, member: dict) -> Project:
    ds_ids = [d["id"] async for d in db.datasets.find({"project_id": p["id"]}, {"id": 1})]
    return Project(
        **{k: v for k, v in p.items() if k not in ("dataset_count", "form_count", "record_count", "can_edit")},
        dataset_count=len(ds_ids),
        form_count=await db.forms.count_documents({"project_id": p["id"]}),
        record_count=await db.rows.count_documents({"dataset_id": {"$in": ds_ids}}) if ds_ids else 0,
        can_edit=can_edit(p, member),
    )


@router.get("/projects", response_model=list[Project])
async def list_projects(member: dict = Depends(current_member)):
    docs = await db.projects.find(project_scope(member), {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _with_counts(p, member) for p in docs]


@router.post("/projects", response_model=Project, status_code=201)
async def create_project(body: ProjectIn, member: dict = Depends(current_member)):
    if member["role"] not in ("admin", "investigador"):
        raise HTTPException(status_code=403, detail="Solo investigadores pueden crear proyectos")
    p = Project(name=body.name, description=body.description, owner_id=member["user_id"])
    await db.projects.insert_one(p.model_dump(exclude={"dataset_count", "form_count", "record_count", "can_edit"}))
    return await _with_counts(p.model_dump(), member)


@router.get("/projects/{project_id}", response_model=Project)
async def get_one(project_id: str, member: dict = Depends(current_member)):
    return await _with_counts(await get_project(project_id, member), member)


@router.put("/projects/{project_id}", response_model=Project)
async def update_project(project_id: str, body: ProjectIn, member: dict = Depends(current_member)):
    p = await get_project(project_id, member, write=True)
    await db.projects.update_one({"id": project_id}, {"$set": body.model_dump()})
    return await _with_counts({**p, **body.model_dump()}, member)


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str, member: dict = Depends(current_member)):
    p = await get_project(project_id, member, write=True)
    if member["role"] != "admin" and p["owner_id"] != member["user_id"]:
        raise HTTPException(status_code=403, detail="Solo el propietario puede eliminar el proyecto")
    ds_ids = [d["id"] async for d in db.datasets.find({"project_id": project_id}, {"id": 1})]
    await db.rows.delete_many({"dataset_id": {"$in": ds_ids}})
    await db.chat_messages.delete_many({"dataset_id": {"$in": ds_ids}})
    await db.datasets.delete_many({"project_id": project_id})
    await db.forms.delete_many({"project_id": project_id})
    await db.projects.delete_one({"id": project_id})


@router.get("/projects/{project_id}/members", response_model=list[Me])
async def list_members(project_id: str, member: dict = Depends(current_member)):
    p = await get_project(project_id, member)
    ids = [p["owner_id"], *p.get("member_ids", [])]
    users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(500)
    return [Me(user_id=u["user_id"], email=u.get("email", ""), name=u.get("name", ""), role=effective_role(u.get("role"))) for u in users]


@router.post("/projects/{project_id}/members", response_model=list[Me])
async def add_member(project_id: str, body: MemberIn, member: dict = Depends(current_member)):
    p = await get_project(project_id, member, write=True)
    if p.get("demo"):
        raise HTTPException(status_code=400, detail="Los proyectos demo son visibles para todos")
    u = await db.users.find_one({"email": body.email.strip().lower()}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Ese usuario aún no ha iniciado sesión en la app")
    await db.projects.update_one({"id": project_id}, {"$addToSet": {"member_ids": u["user_id"]}})
    return await list_members(project_id, member)


@router.delete("/projects/{project_id}/members/{user_id}", response_model=list[Me])
async def remove_member(project_id: str, user_id: str, member: dict = Depends(current_member)):
    await get_project(project_id, member, write=True)
    await db.projects.update_one({"id": project_id}, {"$pull": {"member_ids": user_id}})
    return await list_members(project_id, member)
