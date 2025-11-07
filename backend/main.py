from __future__ import annotations

import os
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware

from capture import ScreenCapture, CaptureConfig
from listener import GlobalClickListener, ListenerConfig
from logger import ClickLogger


OUTPUT_BASE = os.path.join(os.path.dirname(__file__), "..", "data")


class AppState:
    def __init__(self) -> None:
        self.config = CaptureConfig(hz=1.0, output_base=os.path.abspath(OUTPUT_BASE))
        self.capture = ScreenCapture(self.config)
        self.logger = ClickLogger(self.config.output_base)
        self.listener = GlobalClickListener(ListenerConfig(on_click=self._on_click))

    def _on_click(self, record: dict) -> None:
        # Attach latest screenshot path if exists (same second best-effort)
        record.setdefault("screenshot_path", None)
        self.logger.log_click(record)


state = AppState()

app = FastAPI(title="Desktop Capture Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/status")
def status() -> dict:
    return {
        "capture_running": state.capture.is_running(),
        "listener_running": state.listener.is_running(),
        "hz": state.config.hz,
        "output_base": state.config.output_base,
    }


@app.post("/start")
def start() -> dict:
    state.capture.start()
    state.listener.start()
    return {"started": True}


@app.post("/stop")
def stop() -> dict:
    state.capture.stop()
    state.listener.stop()
    return {"stopped": True}


@app.post("/config")
def set_config(hz: Optional[float] = Body(None, embed=True)) -> dict:
    if hz is not None and hz > 0:
        state.config.hz = hz
    return {"hz": state.config.hz}


@app.post("/ext_event")
def ext_event(payload: dict = Body(...)) -> dict:
    # Payload expected from extension: {text, url, tabId?, profile?, x?, y?}
    record = {
        "source": "ext",
        "text": payload.get("text"),
        "url_or_path": payload.get("url"),
        "x": payload.get("x"),
        "y": payload.get("y"),
        "app_name": "chrome",
        "process_id": None,
        "window_title": payload.get("title"),
        "display_id": payload.get("display_id"),
    }
    state.logger.log_click(record)
    return {"ok": True}


def create_app() -> FastAPI:
    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)


