from __future__ import annotations

import os
import time
from dataclasses import dataclass
from threading import Event, Thread
from typing import Optional

import mss
import pyautogui
from PIL import Image, ImageDraw

from logger import day_folder, utc_iso_millis, logger


def _get_monitor_index_for_point(monitors: list[dict], x: int, y: int) -> int:
    # monitors[0] is the virtual screen; real monitors start at 1
    for idx in range(1, len(monitors)):
        mon = monitors[idx]
        if mon["left"] <= x < mon["left"] + mon["width"] and mon["top"] <= y < mon["top"] + mon["height"]:
            return idx
    # Fallback to primary monitor (1)
    return 1


def _draw_cursor(image: Image.Image, cursor_pos: tuple[int, int], monitor: dict) -> None:
    draw = ImageDraw.Draw(image)
    cx, cy = cursor_pos
    # Transform to monitor-local coordinates
    mx = cx - monitor["left"]
    my = cy - monitor["top"]
    r = 8
    draw.ellipse((mx - r, my - r, mx + r, my + r), outline=(255, 0, 0), width=3)


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
                    raw = sct.grab(mon)
                    img = Image.frombytes("RGB", raw.size, raw.rgb)
                    _draw_cursor(img, (cursor_x, cursor_y), mon)

                    folder = day_folder(self.config.output_base)
                    filename = utc_iso_millis() + ".png"
                    path = os.path.join(folder, filename)
                    img.save(path)
                except Exception as e:
                    # Best-effort capture loop; avoid crashing but log the error so we can diagnose
                    try:
                        logger.exception(f"Error during screen capture: {e}")
                    except Exception:
                        # Last-resort: print the traceback
                        import traceback

                        traceback.print_exc()
                time.sleep(interval)


