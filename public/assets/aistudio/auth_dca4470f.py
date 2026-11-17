"""Roles (code) + per-user role (data in db.users). Server decides on every request."""

import os

import requests
from fastapi import Depends, HTTPException
from pymongo import ReturnDocument
from starlette.concurrency import run_in_threadpool

from clerk_auth import require_user
from lib.db import db

# Highest first; keep `admin`.
ROLES = ["admin", "investigador", "capturador"]
DEFAULT_ROLE = "investigador"
RETIRED_ROLES: dict[str, str] = {}
RANK = {r: len(ROLES) - i for i, r in enumerate(ROLES)}

ENV = "live" if os.environ.get("CLERK_PUBLISHABLE_KEY", "").startswith("pk_live_") else "preview"
IN_ENV = {"env": {"$in": [ENV, None]}}


def effective_role(role) -> str:
    role = RETIRED_ROLES.get(role, role)
    return role if role in ROLES else DEFAULT_ROLE


async def move_retired_roles() -> None:
    for old, new in RETIRED_ROLES.items():
        await db.users.update_many({"role": old}, {"$set": {"role": new}})


def _clerk_profile(user_id: str) -> dict:
    """One Clerk lookup on first sign-in, never per request."""
    admins = {e.strip().lower() for e in os.environ.get("ADMIN_EMAIL", "").split(",") if e.strip()}
    r = requests.get(
        f"https://api.clerk.com/v1/users/{user_id}", timeout=10,
        headers={"Authorization": f"Bearer {os.environ['CLERK_SECRET_KEY']}", "User-Agent": "emergent-app"},
    )
    r.raise_for_status()
    u = r.json()
    emails = u.get("email_addresses") or []
    primary = next((e for e in emails if e.get("id") == u.get("primary_email_address_id")), emails[0] if emails else None)
    is_admin = any(
        e["email_address"].lower() in admins and (e.get("verification") or {}).get("status") == "verified"
        for e in emails
    )
    name = " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x) or ""
    return {
        "email": (primary or {}).get("email_address", "").lower(),
        "name": name,
        "is_admin": is_admin,
    }


async def current_member(user: dict = Depends(require_user)) -> dict:
    uid = user["user_id"]
    member = await db.users.find_one({"user_id": uid}, {"_id": 0})
    if member is None or not member.get("role") or not member.get("email"):
        prof = await run_in_threadpool(_clerk_profile, uid)
        role = "admin" if prof["is_admin"] else DEFAULT_ROLE
        await db.users.update_one({"user_id": uid, "role": {"$in": [None, ""]}}, {"$set": {"role": role}})
        member = await db.users.find_one_and_update(
            {"user_id": uid},
            {"$setOnInsert": {"user_id": uid, "role": role},
             "$set": {"email": prof["email"], "name": prof["name"]}},
            upsert=True, projection={"_id": 0}, return_document=ReturnDocument.AFTER,
        )
    if member.get("env") != ENV:
        await db.users.update_one({"user_id": uid}, {"$set": {"env": ENV}})
    return {**member, "env": ENV, "role": effective_role(member["role"])}


def require_role(*roles: str):
    async def check(member: dict = Depends(current_member)) -> dict:
        if member["role"] not in roles:
            raise HTTPException(status_code=403, detail="No tienes permiso para esta acción")
        return member
    return check


analyst = require_role("admin", "investigador")
