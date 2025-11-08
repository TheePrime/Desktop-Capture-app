from __future__ import annotations

import os
import sys
import time
import platform
from dataclasses import dataclass
from threading import Event, Thread
from typing import Optional

import mss
import pyautogui
from PIL import Image, ImageDraw

from logger import day_folder, utc_iso_millis, logger

# On Windows, try to make the process DPI-aware so pyautogui returns
# physical pixel coordinates that match mss captures. This is best-effort
# and won't raise if the APIs are not available.
if platform.system() == "Windows":
    try:
        import ctypes

        # Try per-monitor DPI awareness where available (Windows 8.1+)
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
            logger.info("Set process DPI awareness to per-monitor.")
        except Exception:
            # Fallback to older API
            try:
                ctypes.windll.user32.SetProcessDPIAware()
                logger.info("Set process DPI awareness (legacy API).")
            except Exception:
                logger.debug("Could not set process DPI awareness; continuing.")
    except Exception:
        # If ctypes fails to import or call, continue silently
        pass


def _get_monitor_index_for_point(monitors: list[dict], x: int, y: int) -> int:
    # monitors[0] is the virtual screen; real monitors start at 1
    for idx in range(1, len(monitors)):
        mon = monitors[idx]
        if mon["left"] <= x < mon["left"] + mon["width"] and mon["top"] <= y < mon["top"] + mon["height"]:
            return idx
    # Fallback to primary monitor (1)
    return 1


def _draw_cursor(
    image: Image.Image,
    cursor_pos: tuple[int, int],
    monitor: dict,
    radius: int = 8,
    color: tuple[int, int, int] = (255, 0, 0),
    outline_width: int = 3,
) -> None:
    draw = ImageDraw.Draw(image)
    cx, cy = cursor_pos
    # Transform to monitor-local coordinates
    mx = cx - monitor["left"]
    my = cy - monitor["top"]
    r = radius
    draw.ellipse((mx - r, my - r, mx + r, my + r), outline=color, width=outline_width)


@dataclass
class CaptureConfig:
    hz: float = 1.0
    output_base: str = "data"


class ScreenCapture:
    def __init__(self, config: CaptureConfig) -> None:
        self.config = config
        os.makedirs(self.config.output_base, exist_ok=True)
        self._thread: Optional[Thread] = None
        self._stop_event = Event()
        # cursor overlay settings (adjustable)
        self._cursor_radius = 8
        self._cursor_color = (255, 0, 0)
        self._cursor_outline_width = 3
        # Optional callback: called after a screenshot is saved.
        # Signature: on_capture(path: str, cursor_x: int, cursor_y: int, monitor_index: int)
        self.on_capture = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2.0)

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run_loop(self) -> None:
        interval = max(0.05, 1.0 / max(0.1, self.config.hz))
        with mss.mss() as sct:
            while not self._stop_event.is_set():
                try:
                    cursor_x, cursor_y = pyautogui.position()
                    monitors = sct.monitors
                    mon_idx = _get_monitor_index_for_point(monitors, cursor_x, cursor_y)
                    mon = monitors[mon_idx]
                    # Attempt the grab with a retry for transient failures
                    raw = None
                    for attempt in range(2):
                        try:
                            raw = sct.grab(mon)
                            break
                        except Exception as e:
                            logger.warning(f"mss.grab failed (attempt {attempt+1}): {e}")
                            time.sleep(0.02)
                    if raw is None:
                        raise RuntimeError("mss.grab failed after retries")
                    img = Image.frombytes("RGB", raw.size, raw.rgb)
                    _draw_cursor(
                        img,
                        (cursor_x, cursor_y),
                        mon,
                        radius=self._cursor_radius,
                        color=self._cursor_color,
                        outline_width=self._cursor_outline_width,
                    )

                    folder = day_folder(self.config.output_base)
                    filename = utc_iso_millis() + ".png"
                    path = os.path.join(folder, filename)
                    # Attempt to save with a small retry in case of transient IO errors
                    saved = False
                    last_exc = None
                    for attempt in range(2):
                        try:
                            img.save(path)
                            saved = True
                            logger.info(f"Saved screenshot: {path}")
                            # Notify callback if present (don't block or raise)
                            try:
                                cb = getattr(self, "on_capture", None)
                                if callable(cb):
                                    try:
                                        cb(path, cursor_x, cursor_y, mon_idx)
                                    except Exception:
                                        logger.exception("on_capture callback raised")
                            except Exception:
                                pass
                            break
                        except Exception as e:
                            last_exc = e
                            logger.warning(f"Failed to save screenshot (attempt {attempt+1}): {e}")
                            time.sleep(0.05)
                    if not saved:
                        logger.error(f"Could not save screenshot after retries: {path} -- {last_exc}")
                except Exception as e:
                    # Best-effort capture loop; avoid crashing but log the error so we can diagnose
                    try:
                        logger.exception(f"Error during screen capture: {e}")
                    except Exception:
                        # Last-resort: print the traceback
                        import traceback

                        traceback.print_exc()
                time.sleep(interval)

    def capture_once(self) -> Optional[str]:
        """Capture a single screenshot immediately and return the path or None on failure."""
        try:
            with mss.mss() as sct:
                cursor_x, cursor_y = pyautogui.position()
                monitors = sct.monitors
                mon_idx = _get_monitor_index_for_point(monitors, cursor_x, cursor_y)
                mon = monitors[mon_idx]
                # attempt grab with a retry
                raw = None
                for attempt in range(2):
                    try:
                        raw = sct.grab(mon)
                        break
                    except Exception as e:
                        logger.warning(f"capture_once: mss.grab failed (attempt {attempt+1}): {e}")
                        time.sleep(0.02)
                if raw is None:
                    raise RuntimeError("capture_once: mss.grab failed after retries")
                img = Image.frombytes("RGB", raw.size, raw.rgb)
                _draw_cursor(
                    img,
                    (cursor_x, cursor_y),
                    mon,
                    radius=self._cursor_radius,
                    color=self._cursor_color,
                    outline_width=self._cursor_outline_width,
                )
                folder = day_folder(self.config.output_base)
                filename = utc_iso_millis() + ".png"
                path = os.path.join(folder, filename)
                img.save(path)
                logger.info(f"capture_once: saved {path}")
                try:
                    cb = getattr(self, "on_capture", None)
                    if callable(cb):
                        try:
                            cb(path, cursor_x, cursor_y, mon_idx)
                        except Exception:
                            logger.exception("on_capture callback raised in capture_once")
                except Exception:
                    pass
                return path
        except Exception as e:
            try:
                logger.exception(f"capture_once failed: {e}")
            except Exception:
                pass
        return None


