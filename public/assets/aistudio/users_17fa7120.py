from fastapi import APIRouter, Depends, HTTPException

from lib.auth import IN_ENV, RANK, ROLES, current_member, effective_role, require_role
from lib.db import db
from models.core import Me, RoleIn, UserRow, UsersList

router = APIRouter()


@router.get("/me", response_model=Me)
async def me(member: dict = Depends(current_member)):
    return Me(user_id=member["user_id"], email=member.get("email", ""), name=member.get("name", ""), role=member["role"])


@router.get("/users", response_model=UsersList)
async def list_users(admin: dict = Depends(require_role("admin"))):
    people = await db.users.find(IN_ENV, {"_id": 0}).to_list(1000)
    return UsersList(
        roles=[r for r in ROLES if RANK[r] <= RANK[admin["role"]]],
        users=[UserRow(user_id=p["user_id"], email=p.get("email", ""), name=p.get("name", ""), role=effective_role(p.get("role"))) for p in people],
    )


@router.patch("/users/{user_id}/role", response_model=UserRow)
async def set_role(user_id: str, body: RoleIn, admin: dict = Depends(require_role("admin"))):
    if body.role not in ROLES or RANK[body.role] > RANK[admin["role"]]:
        raise HTTPException(status_code=403, detail="Not allowed")
    target = await db.users.find_one({"user_id": user_id, **IN_ENV}, {"_id": 0})
    if target is None:
        raise HTTPException(status_code=404, detail="Not found")
    if (effective_role(target.get("role")) == "admin" and body.role != "admin"
            and await db.users.count_documents({"role": "admin", **IN_ENV}) <= 1):
        raise HTTPException(status_code=409, detail="Debe quedar al menos un administrador")
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": body.role}})
    return UserRow(user_id=user_id, email=target.get("email", ""), name=target.get("name", ""), role=body.role)
