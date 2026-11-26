import json
import os
import re
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlsplit
from urllib.request import Request as HttpRequest, urlopen
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from records import entry, initialize, session

DATA = Path(os.getenv("DATA_DIR", "/data"))
DB = DATA / "production.sqlite3"
MEDIA = DATA / "media"
WEB = Path("dist")
ROLE = os.getenv("DESK_ROLE", "reviewer")
STATUSES = ("script_approval", "production_approval", "video_approval")
Status = Literal["Pending", "Approved", "Not Approved"]
UPLOAD_TYPES = {"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"}
MAX_UPLOAD = 250 * 1024 * 1024

@asynccontextmanager
async def lifespan(app):
    if ROLE not in {"reviewer", "publisher", "team"}:
        raise RuntimeError("DESK_ROLE must be reviewer, publisher or team")
    MEDIA.mkdir(parents=True, exist_ok=True)
    initialize(DB)
    yield

app = FastAPI(title="Production Desk", lifespan=lifespan)

@app.middleware("http")
async def local_write_requests(request: Request, call_next):
    if request.method in {"POST", "PUT", "DELETE"} and request.headers.get("X-Production-Desk") != "1":
        return JSONResponse({"detail": "Use the production desk to make changes."}, status_code=403)
    return await call_next(request)

class Production(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    proposer_name: str = Field(default="", max_length=200)
    topic: Literal["Security", "Economy", "Unity", "Identity", "Strength", "General"]
    idea: str = Field(min_length=1, max_length=20000)
    script: str = Field(default="", max_length=60000)
    production_notes: str = Field(default="", max_length=20000)
    idea_pending: bool = False
    script_pending: bool = False
    script_approval: Status = "Pending"
    production_approval: Status = "Pending"
    video_approval: Status = "Pending"
    distribution_published: bool = False
    video_url: str = Field(default="", max_length=4000)

    @field_validator("idea")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Enter a production idea")
        return value

    @field_validator("video_url")
    @classmethod
    def valid_video(cls, value):
        if not value or value == "/demo/motion-study.mp4":
            return value
        if re.fullmatch(r"/media/[a-f0-9]{32}\.(mp4|webm|mov)", value) and (MEDIA / value.rsplit("/", 1)[1]).is_file():
            return value
        parsed = urlsplit(value)
        if parsed.scheme in ("http", "https") and parsed.hostname:
            return value
        raise ValueError("Choose an uploaded video or an HTTP(S) link")

def permission_checked(item, old):
    data = item.model_dump(mode="json")
    if ROLE != "reviewer":
        if any(data[k] != old.get(k, "Pending") for k in STATUSES):
            raise HTTPException(403, "A reviewer must change approvals.")
        if old:
            for field in ("idea", "script"):
                data[field+"_pending"] = old.get(field+"_pending", False) or data[field] != old[field]
    if ROLE == "team" and data["distribution_published"] != old.get("distribution_published", False):
        raise HTTPException(403, "A publisher or reviewer must record distribution.")
    return json.dumps(data)

@app.get("/api/productions")
def list_records():
    with session(DB) as db:
        rows = [entry(row) for row in db.execute("SELECT * FROM productions ORDER BY number DESC")]
    return {"productions": rows, "role": ROLE, "translation_enabled": bool(os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_MODEL"))}

@app.post("/api/productions", status_code=201)
def create(item: Production):
    body = permission_checked(item, {})
    with session(DB) as db:
        number = db.execute("INSERT INTO productions(body) VALUES (?)", (body,)).lastrowid
    return {"id": str(number)}

def checked_row(db, number, revision):
    db.execute("BEGIN IMMEDIATE")
    row = db.execute("SELECT * FROM productions WHERE number=?", (number,)).fetchone()
    if row is None:
        raise HTTPException(404, "Production no longer exists.")
    if row["revision"] != revision:
        raise HTTPException(409, "This record changed. Close the editor and refresh before editing again.")
    return row

@app.put("/api/productions/{number}")
def update(number: int, item: Production, if_match: int = Header()):
    with session(DB) as db:
        row = checked_row(db, number, if_match)
        body = permission_checked(item, json.loads(row["body"]))
        db.execute("UPDATE productions SET body=?, revision=revision+1 WHERE number=?", (body, number))
    return {"id": str(number)}

@app.delete("/api/productions/{number}")
def remove(number: int, if_match: int = Header()):
    with session(DB) as db:
        checked_row(db, number, if_match)
        db.execute("DELETE FROM productions WHERE number=?", (number,))
    return {"deleted": True}

@app.post("/api/media", status_code=201)
async def upload(request: Request):
    ext = UPLOAD_TYPES.get(request.headers.get("content-type", "").split(";")[0])
    if not ext:
        raise HTTPException(415, "Choose an MP4, WebM or MOV video.")
    name = uuid4().hex
    temp = MEDIA / (name + ".part")
    final = MEDIA / (name + "." + ext)
    size = 0
    try:
        with temp.open("xb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "Video exceeds 250 MiB.")
                f.write(chunk)
        with temp.open("rb") as f:
            header = f.read(16)
        valid = header.startswith(bytes.fromhex("1a45dfa3")) if ext == "webm" else header[4:8] in (b"ftyp", b"moov", b"mdat", b"wide")
        if not valid:
            raise HTTPException(415, "The file header does not match the video format.")
        temp.replace(final)
    finally:
        temp.unlink(missing_ok=True)
    return {"url": "/media/" + final.name}

@app.get("/media/{name}")
def media(name: str):
    if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|webm|mov)", name) or not (MEDIA / name).is_file():
        raise HTTPException(404)
    return FileResponse(MEDIA / name, headers={"X-Content-Type-Options": "nosniff"})

class Translation(BaseModel):
    text: str = Field(min_length=1, max_length=60000)
    target: Literal["hebrew", "english"]

@app.post("/api/translate")
def translate(body: Translation):
    key, model = os.getenv("GEMINI_API_KEY"), os.getenv("GEMINI_MODEL")
    if not key or not model:
        raise HTTPException(503, "Optional translation is not configured.")
    payload = {"systemInstruction": {"parts": [{"text": f"Translate the supplied text to {body.target}. Return only the translation."}]},
               "contents": [{"parts": [{"text": body.text}]}]}
    request = HttpRequest("https://generativelanguage.googleapis.com/v1beta/models/" + quote(model, safe="") + ":generateContent",
                          data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key})
    try:
        with urlopen(request, timeout=45) as response:
            parts = json.load(response)["candidates"][0]["content"]["parts"]
        result = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
        if not result:
            raise ValueError
    except (OSError, ValueError, KeyError, IndexError):
        raise HTTPException(502, "The translation provider could not return a translation.")
    return {"translated_text": result}

app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")
app.mount("/demo", StaticFiles(directory=WEB / "demo"), name="demo")

@app.get("/")
@app.get("/production")
def homepage():
    return FileResponse(WEB / "index.html")
