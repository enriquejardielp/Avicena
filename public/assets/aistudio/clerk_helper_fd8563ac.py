"""Test-only helper: creates Clerk dev users + session tokens / sign-in tickets. Never print the secret key.
Usage: python /app/backend/tests/clerk_helper.py  -> writes /tmp/clerk_test.json"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
SK = os.environ["CLERK_SECRET_KEY"]


def bapi(path, body=None, method="POST"):
    req = urllib.request.Request("https://api.clerk.com/v1" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + SK, "Content-Type": "application/json", "User-Agent": "emergent-test"})
    return json.load(urllib.request.urlopen(req))


USERS = {
    "admin": ("admin+clerk_test@estadimed.dev", "Ana", "Admin"),
    "investigador": ("investigador+clerk_test@estadimed.dev", "Iván", "Investigador"),
    "capturador": ("capturador+clerk_test@estadimed.dev", "Carla", "Capturadora"),
}

out = {}
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
for role, (email, first, last) in USERS.items():
    try:
        u = bapi("/users", {"email_address": [email], "password": "Test-pass-12345!", "skip_password_checks": True, "first_name": first, "last_name": last})
    except urllib.error.HTTPError:
        req = urllib.request.Request("https://api.clerk.com/v1/users?email_address=" + urllib.parse.quote(email),
                                     headers={"Authorization": "Bearer " + SK, "User-Agent": "emergent-test"})
        u = json.load(urllib.request.urlopen(req))[0]
    s = bapi("/sessions", {"user_id": u["id"]})
    tok = bapi(f"/sessions/{s['id']}/tokens", {"expires_in_seconds": 3000})["jwt"]
    ticket = bapi("/sign_in_tokens", {"user_id": u["id"], "expires_in_seconds": 3000})["token"]
    db.users.update_one({"user_id": u["id"]}, {"$set": {"role": role, "env": "preview", "email": email, "name": f"{first} {last}"}}, upsert=True)
    out[role] = {"user_id": u["id"], "email": email, "token": tok, "ticket": ticket}
json.dump(out, open("/tmp/clerk_test.json", "w"))
print({k: v["user_id"] for k, v in out.items()})
