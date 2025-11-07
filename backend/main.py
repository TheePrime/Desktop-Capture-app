from __future__ import annotations

import logging
import os
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from capture import ScreenCapture, CaptureConfig
from listener import GlobalClickListener, ListenerConfig
from logger import ClickLogger

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Suppress pynput's internal error logging for known Windows compatibility issues
# These errors occur when pynput encounters unsupported mouse events but don't affect functionality
logging.getLogger('pynput').setLevel(logging.CRITICAL)
logging.getLogger('pynput.mouse.Listener').setLevel(logging.CRITICAL)


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
        logging.info(f"Received click event: source={record.get('source')}, x={record.get('x')}, y={record.get('y')}")
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


@app.options("/ext_event")
def ext_event_options() -> Response:
    """Handle CORS preflight requests"""
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    )

@app.post("/ext_event")
def ext_event(payload: dict = Body(...)) -> dict:
    # Payload expected from extension: {text, url, tabId?, profile?, x?, y?}
    try:
        logging.info(f"=== Received extension event ===")
        logging.info(f"Payload: {payload}")
        logging.info(f"Text length: {len(payload.get('text', '') or '')}")
        logging.info(f"URL: {payload.get('url')}")
        
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
        logging.info(f"Logging click record: source={record.get('source')}, x={record.get('x')}, y={record.get('y')}")
        state.logger.log_click(record)
        logging.info(f"Successfully logged click event")
        return {"ok": True, "message": "Event logged successfully"}
    except Exception as e:
        logging.error(f"Error processing extension event: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@app.post("/test_log")
def test_log() -> dict:
    """Test endpoint to verify logger is working"""
    test_record = {
        "source": "test",
        "text": "Test click from API",
        "url_or_path": "http://test.example.com",
        "x": 100,
        "y": 200,
        "app_name": "test",
        "process_id": None,
        "window_title": "Test Window",
        "display_id": 0,
    }
    state.logger.log_click(test_record)
    return {
        "ok": True,
        "message": "Test click logged",
        "csv_path": state.logger.csv_path,
        "ndjson_path": state.logger.ndjson_path,
    }


def create_app() -> FastAPI:
    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)


