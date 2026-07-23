"""Code2Cloud backend API (FastAPI)."""
import os
import platform
import socket
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Code2Cloud API", version="1.0.0")

# CORS is permissive by default so the app works whether the frontend calls
# the backend through the Ingress (same origin) or directly during local dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """Liveness/readiness probe endpoint."""
    return {"status": "ok"}


@app.get("/api/hello")
def hello():
    """Demo endpoint returning some pod/runtime info for the UI."""
    return {
        "message": "Hello from Code2Cloud backend!",
        "hostname": socket.gethostname(),
        "python_version": platform.python_version(),
        "environment": os.getenv("APP_ENV", "development"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
