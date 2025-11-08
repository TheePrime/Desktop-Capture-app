from __future__ import annotations

import os
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware

from capture import ScreenCapture, CaptureConfig
from listener import GlobalClickListener, ListenerConfig
from listener import find_pid_for_window_title
from logger import ClickLogger
import threading
import time
import uuid
from typing import Dict
import mss
import logging
LOG_PATH = os.path.join(os.path.dirname(__file__), 'backend_ext.log')
logging.basicConfig(filename=LOG_PATH, level=logging.INFO, format='%(asctime)s [backend] %(levelname)s: %(message)s')
logger = logging.getLogger('backend_main')


OUTPUT_BASE = os.path.join(os.path.dirname(__file__), "..", "data")


class AppState:
    def __init__(self) -> None:
        self.config = CaptureConfig(hz=1.0, output_base=os.path.abspath(OUTPUT_BASE))
        self.capture = ScreenCapture(self.config)
        self.logger = ClickLogger(self.config.output_base)
        self.listener = GlobalClickListener(ListenerConfig(on_click=self._on_click))

        # Pending clicks waiting for extension payloads.
        # Map: click_id -> {record, timer, created_at}
        self._pending: Dict[str, dict] = {}
        self._pending_lock = threading.Lock()
        # Matching parameters
        self._merge_timeout = 0.250  # seconds
        self._merge_distance_px = 80  # pixels tolerance when matching ext payload to click

    def _on_click(self, record: dict) -> None:
        # When an OS click occurs, we hold writing for up to ~250ms to allow
        # a Chrome extension payload to arrive and augment the record.
        record.setdefault("screenshot_path", None)
        record.setdefault("source", "os")
        record_id = str(uuid.uuid4())
        record.setdefault("_id", record_id)

        def _flush():
            with self._pending_lock:
                entry = self._pending.pop(record_id, None)
            if not entry:
                return
            try:
                self.logger.log_click(entry["record"])
            except Exception:
                # Avoid crashing the listener thread
                pass

        t = threading.Timer(self._merge_timeout, _flush)
        with self._pending_lock:
            self._pending[record_id] = {"record": record, "timer": t, "created_at": time.time()}
        t.daemon = True
        t.start()


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
    now = time.time()
    px = payload.get("x")
    py = payload.get("y")

    # Try to find a pending OS click to merge with (within distance and time window)
    matched_id = None
    matched_entry = None
    if px is not None and py is not None:
        with state._pending_lock:
            best = None
            best_dist = None
            for cid, entry in list(state._pending.items()):
                rec = entry.get("record", {})
                rx = rec.get("x")
                ry = rec.get("y")
                if rx is None or ry is None:
                    continue
                # Time filter: only consider recent pending entries
                if now - entry.get("created_at", 0) > state._merge_timeout:
                    continue
                dist = ((px - rx) ** 2 + (py - ry) ** 2) ** 0.5
                if dist <= state._merge_distance_px and (best is None or dist < best_dist):
                    best = cid
                    best_dist = dist
            if best:
                matched_id = best
                matched_entry = state._pending.pop(best, None)
    if matched_entry:
        try:
            # Cancel the flush timer since we're handling it now
            try:
                matched_entry["timer"].cancel()
            except Exception:
                pass
            rec = matched_entry.get("record", {})
            # Merge extension payload fields
            rec["text"] = payload.get("text") or rec.get("text")
            # Handle file:// URLs specially (PDFs)
            url_val = payload.get("url")
            if isinstance(url_val, str) and url_val.startswith("file://"):
                try:
                    from urllib.parse import urlparse, unquote
                    parsed = urlparse(url_val)
                    path = unquote(parsed.path or "")
                    if os.name == "nt" and path.startswith("/") and len(path) > 2 and path[2] == ":":
                        path = path.lstrip("/")
                    rec["doc_path"] = path
                    rec["url_or_path"] = path
                except Exception:
                    rec["url_or_path"] = url_val or rec.get("url_or_path")
            else:
                rec["url_or_path"] = url_val or rec.get("url_or_path")
            rec["window_title"] = payload.get("title") or rec.get("window_title")
            rec["display_id"] = payload.get("display_id") or rec.get("display_id")
            rec["source"] = "ext"
            state.logger.log_click(rec)
            return {"ok": True, "merged": True}
        except Exception:
            return {"ok": False, "error": "merge_failed"}

    # No matching OS click — write ext-only record. If extension provided global coords,
    # use them to compute display_id and store global x/y. Also handle file:// URLs
    # (Chrome PDF viewer) by extracting a local doc_path.
    url_val = payload.get("url")
    record = {
        "source": "ext",
        "text": payload.get("text"),
        "url_or_path": url_val,
        "x": payload.get("x"),
        "y": payload.get("y"),
        "app_name": "chrome",
        "process_id": None,
        "window_title": payload.get("title"),
        "display_id": payload.get("display_id"),
    }

    # Treat file:// URLs as document paths (PDFs). Normalize and store as doc_path
    try:
        if isinstance(url_val, str) and url_val.startswith("file://"):
            from urllib.parse import urlparse, unquote
            parsed = urlparse(url_val)
            path = unquote(parsed.path or "")
            if os.name == "nt" and path.startswith("/") and len(path) > 2 and path[2] == ":":
                path = path.lstrip("/")
            record["doc_path"] = path
            record["url_or_path"] = path
            # keep app_name as chrome (embedded PDF viewer) for now
    except Exception:
        pass

    gx = payload.get("global_x")
    gy = payload.get("global_y")
    dpr = payload.get("devicePixelRatio") or payload.get("dpr") or 1
    try:
        if gx is not None and gy is not None:
            try:
                with mss.mss() as sct:
                    monitors = sct.monitors
                    try:
                        logger.info(f"ext_event mapping gx={gx}, gy={gy}, dpr={dpr}")
                        logger.info(f"Monitors: {[{k:mon[k] for k in ('left','top','width','height')} for mon in monitors]}")
                    except Exception:
                        pass

                    def try_map(px, py):
                        for idx in range(1, len(monitors)):
                            mon = monitors[idx]
                            if mon["left"] <= px < mon["left"] + mon["width"] and mon["top"] <= py < mon["top"] + mon["height"]:
                                return idx
                        return None

                    mapped = None
                    used_coords = (gx, gy)

                    # raw
                    mapped = try_map(gx, gy)

                    # scaled up (assume extension sent CSS pixels)
                    if mapped is None and dpr and dpr != 1:
                        try:
                            sgx = int(round(float(gx) * float(dpr)))
                            sgy = int(round(float(gy) * float(dpr)))
                            mapped = try_map(sgx, sgy)
                            if mapped is not None:
                                used_coords = (sgx, sgy)
                        except Exception:
                            pass

                    # scaled down
                    if mapped is None and dpr and dpr != 1:
                        try:
                            dgx = int(round(float(gx) / float(dpr)))
                            dgy = int(round(float(gy) / float(dpr)))
                            mapped = try_map(dgx, dgy)
                            if mapped is not None:
                                used_coords = (dgx, dgy)
                        except Exception:
                            pass

                    if mapped is not None:
                        record["display_id"] = mapped
                        try:
                            record["x"] = int(used_coords[0])
                            record["y"] = int(used_coords[1])
                        except Exception:
                            pass
                        try:
                            logger.info(f"Mapped display_id={mapped} using coords={used_coords}")
                        except Exception:
                            pass
                    else:
                        try:
                            logger.info("No monitor matched incoming global coords (raw or scaled)")
                        except Exception:
                            pass
            except Exception:
                logger.exception("mss mapping failed in backend ext_event")
    except Exception:
        logger.exception("Error while attempting to map global coords in backend ext_event")

    # Attempt to resolve process_id/app_name for ext-only events by scanning
    # window titles / processes if possible (best-effort).
    try:
        if not record.get("process_id"):
            title = payload.get("title") or payload.get("url")
            if title:
                try:
                    app_name_guess, pid_guess = find_pid_for_window_title(title)
                    if pid_guess:
                        record["process_id"] = pid_guess
                        record["app_name"] = app_name_guess or record.get("app_name")
                except Exception:
                    pass
    except Exception:
        pass

    state.logger.log_click(record)
    return {"ok": True, "merged": False}


def create_app() -> FastAPI:
    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)


