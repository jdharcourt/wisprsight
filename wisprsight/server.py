import asyncio
import logging
import os
import secrets
import shutil
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, suppress
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from wisprsight import engine


@asynccontextmanager
async def lifespan(app):
    async def cleanup():
        while True:
            await asyncio.sleep(10)
            engine.expire_corrections()
            run_pending_learning()

    task = asyncio.create_task(cleanup())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
sessions = {}
limits = defaultdict(deque)
executor = ThreadPoolExecutor(max_workers=1)
jobs = {}
last_activity = time.monotonic()
job_lock = threading.Lock()
PORT = int(os.environ.get("WISPRSIGHT_PORT", "8765"))
FRONTEND_ORIGIN = os.environ.get(
    "WISPRSIGHT_FRONTEND_ORIGIN", f"https://localhost:{PORT}"
)


class ProfileInput(BaseModel):
    name: str = Field(min_length=1, max_length=60, pattern=r".*\S.*")


class CorrectionInput(BaseModel):
    token: UUID
    text: str = Field(min_length=1, max_length=300, pattern=r"^[\x20-\x7e]+$")


@app.middleware("http")
async def protect(request, call_next):
    global last_activity
    origin = FRONTEND_ORIGIN
    if request.headers.get("host") not in {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}:
        response = JSONResponse({"detail": "Invalid host."}, status_code=400)
    elif request.headers.get("origin") not in {None, origin}:
        response = JSONResponse({"detail": "Invalid origin."}, status_code=403)
    elif request.method not in {"GET", "HEAD"} and (
        not sessions.get(request.cookies.get("session"))
        or not secrets.compare_digest(
            request.headers.get("x-csrf-token", ""),
            sessions[request.cookies["session"]],
        )
    ):
        response = JSONResponse(
            {"detail": "Reload the page to start a secure local session."},
            status_code=403,
        )
    else:
        now = time.monotonic()
        key = (
            request.client.host if request.client else "local",
            request.method == "GET",
        )
        window = limits[key]
        while window and window[0] < now - 60:
            window.popleft()
        if len(window) >= (180 if request.method == "GET" else 30):
            response = JSONResponse(
                {"detail": "Too many requests. Wait a minute and try again."},
                status_code=429,
            )
        else:
            window.append(now)
            if request.method not in {"GET", "HEAD"}:
                last_activity = now
            response = await call_next(request)
    response.headers.update(
        {
            "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' 'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            "Strict-Transport-Security": "max-age=31536000",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
            "Cache-Control": "no-store",
        }
    )
    return response


@app.get("/api/session")
def session(request: Request):
    sid = request.cookies.get("session")
    if sid not in sessions:
        if len(sessions) > 100:
            sessions.clear()
        sid = secrets.token_urlsafe(32)
        sessions[sid] = secrets.token_urlsafe(32)
    response = JSONResponse(
        {
            "csrf": sessions[sid],
            "models_ready": engine.model_ready(),
            "profiles": engine.profiles(),
            "auto_job": next(
                (
                    {key: value for key, value in job.items() if key != "cancel"}
                    for job in jobs.values()
                    if job.get("automatic") and job["status"] == "running"
                ),
                None,
            ),
        }
    )
    response.set_cookie("session", sid, secure=True, httponly=True, samesite="strict")
    return response


@app.post("/api/profiles")
def create_profile(body: ProfileInput):
    if len(engine.profiles()) >= 10:
        raise HTTPException(400, "This prototype supports up to ten profiles.")
    return engine.create_profile(body.name)


@app.delete("/api/profiles/{profile_id}")
def delete_profile(profile_id: UUID):
    with job_lock:
        if any(job["status"] == "running" for job in jobs.values()):
            raise HTTPException(
                409, "Wait for the current task to finish before deleting a profile."
            )
        path = engine.profile_path(profile_id)
        if not path.exists():
            raise HTTPException(404, "Profile not found.")
        shutil.rmtree(path)
    return {"deleted": True}


@app.patch("/api/profiles/{profile_id}")
def rename_profile(profile_id: UUID, body: ProfileInput):
    with job_lock:
        if any(job["status"] == "running" for job in jobs.values()):
            raise HTTPException(
                409, "Wait for the current task before renaming a profile."
            )
        try:
            profile = engine.read_profile(profile_id)
        except ValueError as error:
            raise HTTPException(404, "Profile not found.") from error
        profile["name"] = body.name.strip()
        engine.write_json(engine.profile_path(profile_id) / "profile.json", profile)
    return profile


async def media_body(request):
    if request.headers.get("content-type", "").split(";")[0] not in {
        "video/webm",
        "video/mp4",
        "audio/webm",
        "audio/mp4",
    }:
        raise HTTPException(415, "Use a browser-recorded WebM or MP4 clip.")
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > 20 * 1024 * 1024:
            raise HTTPException(413, "Keep recordings under twenty megabytes.")
    if not (payload[:4] == b"\x1aE\xdf\xa3" or payload[4:8] == b"ftyp"):
        raise HTTPException(415, "The recording is not a valid WebM or MP4 file.")
    return bytes(payload)


def start_job(kind, operation, *args, automatic=False):
    with job_lock:
        if automatic and time.monotonic() - last_activity < 30:
            raise HTTPException(409, "Waiting for an idle moment to learn.")
        if any(job["status"] == "running" for job in jobs.values()):
            raise HTTPException(
                409, "Another local task is running. Wait or cancel it first."
            )
        jobs.clear()
        job_id = str(uuid4())
        cancelled = threading.Event()
        job = {
            "id": job_id,
            "kind": kind,
            "status": "running",
            "message": "Processing locally…",
            "progress": 0,
            "cancel": cancelled,
            "automatic": automatic,
        }
        jobs[job_id] = job

    def run():
        try:
            result = (
                operation(*args, job, cancelled)
                if kind == "train"
                else operation(*args)
            )
            outcome = {
                "result": result,
                "status": "cancelled" if cancelled.is_set() else "done",
            }
        except ValueError as error:
            outcome = {"status": "error", "message": str(error)}
        except Exception:
            logging.error("Local %s task failed", kind)
            outcome = {
                "status": "error",
                "message": "Local processing failed. Check model installation and try a shorter, well-lit recording.",
            }

        finally:
            if kind == "train" and automatic:
                try:
                    profile = engine.read_profile(args[0])
                    profile["learning_pending"] = False
                    engine.write_json(
                        engine.profile_path(args[0]) / "profile.json", profile
                    )
                except (ValueError, OSError):
                    logging.error("Could not update automatic learning state")
            job.update(outcome)

    executor.submit(run)
    return {"id": job_id}


def run_pending_learning():
    if time.monotonic() - last_activity < 30:
        return
    with job_lock:
        if any(job["status"] == "running" for job in jobs.values()):
            return
    for profile in engine.profiles():
        if not profile.get("learning_pending"):
            continue
        if (
            len(
                {
                    " ".join(engine.normalize(sample["text"]))
                    for sample in profile["samples"]
                }
            )
            < 18
        ):
            continue
        try:
            start_job("train", engine.train_profile, profile["id"], automatic=True)
        except HTTPException as error:
            if error.status_code != 409:
                raise
        return


@app.post("/api/activity")
def activity():
    with job_lock:
        if any(job["status"] == "running" for job in jobs.values()):
            raise HTTPException(
                409, "Wait for the current local task or cancel it before recording."
            )
    return {"recording": True}


@app.post("/api/transcribe/{profile_id}")
async def transcribe(profile_id: UUID, request: Request):
    if not engine.model_ready():
        raise HTTPException(503, "Download the local models first.")
    return start_job(
        "transcribe", engine.transcribe, await media_body(request), str(profile_id)
    )


@app.post("/api/label")
async def label(request: Request):
    return start_job("label", engine.label_audio, await media_body(request))


@app.post("/api/samples/{profile_id}")
async def sample(profile_id: UUID, request: Request):
    text = request.headers.get("x-reference", "")
    if not 1 <= len(text) <= 300 or not text.isascii():
        raise HTTPException(
            400, "Use an English reference sentence of at most 300 characters."
        )
    return start_job(
        "sample", engine.save_sample, await media_body(request), str(profile_id), text
    )


@app.post("/api/train/{profile_id}")
def train(profile_id: UUID):
    return start_job("train", engine.train_profile, str(profile_id))


@app.post("/api/corrections/{profile_id}")
def correct(profile_id: UUID, body: CorrectionInput):
    return start_job(
        "correction",
        engine.save_correction,
        str(profile_id),
        str(body.token),
        body.text,
    )


@app.get("/api/jobs/{job_id}")
def job_status(job_id: UUID):
    job = jobs.get(str(job_id))
    if not job:
        raise HTTPException(404, "Task not found. Reload the page.")
    return {key: value for key, value in job.items() if key != "cancel"}


@app.post("/api/jobs/{job_id}/cancel")
def cancel(job_id: UUID):
    job = jobs.get(str(job_id))
    if not job:
        raise HTTPException(404, "Task not found.")
    job["cancel"].set()
    return {"requested": True}


if (engine.ROOT / "frontend/dist/assets").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=engine.ROOT / "frontend/dist/assets"),
        name="assets",
    )


if (engine.ROOT / "frontend/node_modules/@mediapipe/tasks-vision/wasm").exists():
    app.mount(
        "/vision",
        StaticFiles(
            directory=engine.ROOT / "frontend/node_modules/@mediapipe/tasks-vision/wasm"
        ),
        name="vision",
    )


@app.get("/api/face-model")
def face_model():
    path = engine.MODELS / "face_landmarker.task"
    if not path.exists():
        raise HTTPException(503, "Download the local models first.")
    return FileResponse(path)


@app.get("/")
def index():
    path = engine.ROOT / "frontend/dist/index.html"
    if not path.exists():
        raise HTTPException(
            503, "Build the dashboard first: npm --prefix frontend run build"
        )
    return FileResponse(path)
