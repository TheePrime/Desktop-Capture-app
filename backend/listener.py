from __future__ import annotations

import logging
from dataclasses import dataclass
import os
from datetime import datetime, timezone
from threading import Thread
from typing import Callable, Optional

import psutil
from pynput import mouse
import pyautogui
import pygetwindow
import mss

logger = logging.getLogger(__name__)

# Suppress pynput's internal error logging for known issues
# These errors occur when pynput encounters unsupported mouse events
# but don't affect the listener's functionality
pynput_logger = logging.getLogger('pynput')
pynput_logger.setLevel(logging.CRITICAL)  # Only show critical errors
pynput_mouse_logger = logging.getLogger('pynput.mouse.Listener')
pynput_mouse_logger.setLevel(logging.CRITICAL)


def _get_active_window_title() -> Optional[str]:
    try:
        win = pygetwindow.getActiveWindow()
        if win:
            return win.title
    except Exception:
        pass
    return None


def _get_active_process_info() -> tuple[Optional[str], Optional[int]]:
    try:
        # Platform-specific fast path for Windows using win32 APIs
        if os.name == "nt":
            try:
                import win32gui
                import win32process

                hwnd = win32gui.GetForegroundWindow()
                if hwnd:
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    try:
                        p = psutil.Process(pid)
                        return p.name(), pid
                    except Exception:
                        return None, pid
            except Exception:
                # If pywin32 isn't available, fall back to generic method below
                pass

        # Generic fallback: try to guess process by active window title
        win = pygetwindow.getActiveWindow()
        if win:
            title = getattr(win, "title", None) or getattr(win, "name", None)
            if title:
                # Try to find a process whose name or cmdline contains parts of the title
                title_lower = title.lower()
                for p in psutil.process_iter(attrs=["pid", "name", "cmdline"]):
                    try:
                        name = (p.info.get("name") or "")
                        cmd = " ".join(p.info.get("cmdline") or [])
                        if name and name.lower() in title_lower:
                            return name, p.info.get("pid")
                        if cmd and any(part.lower() in title_lower for part in (name,)):
                            return name, p.info.get("pid")
                    except Exception:
                        continue

        return None, None
    except Exception:
        return None, None


def _get_display_id_for_point(x: int, y: int) -> int:
    # Use the same monitor mapping as capture.py (mss.monitors)
    try:
        with mss.mss() as sct:
            monitors = sct.monitors
            # monitors[0] is virtual screen; real monitors start at 1
            for idx in range(1, len(monitors)):
                mon = monitors[idx]
                if mon["left"] <= x < mon["left"] + mon["width"] and mon["top"] <= y < mon["top"] + mon["height"]:
                    return idx
            # Fallback to primary monitor (1)
            return 1
    except Exception:
        # Best-effort fallback
        return 0


@dataclass
class ListenerConfig:
    on_click: Callable[[dict], None]


class GlobalClickListener:
    def __init__(self, config: ListenerConfig) -> None:
        self.config = config
        self._listener: Optional[mouse.Listener] = None
        self._thread: Optional[Thread] = None

    def start(self) -> None:
        if self._listener and self._listener.running:
            return

        def on_click(x: int, y: int, button, pressed: bool) -> None:
            try:
                if not pressed or str(button) != "Button.left":
                    return
                logger.debug(f"Mouse click detected: x={x}, y={y}, button={button}")
                app_name, pid = _get_active_process_info()
                title = _get_active_window_title()
                display_id = _get_display_id_for_point(x, y)
                click_record = {
                    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                    "x": x,
                    "y": y,
                    "app_name": app_name,
                    "process_id": pid,
                    "window_title": title,
                    "display_id": display_id,
                    "source": "os",
                }
                logger.info(f"Calling on_click callback: {click_record}")
                self.config.on_click(click_record)
            except Exception as e:
                # Log the exception but don't crash the listener
                logger.error(f"Error handling click event: {e}", exc_info=True)

        try:
            self._listener = mouse.Listener(on_click=on_click)
            self._listener.daemon = True  # type: ignore[attr-defined]
            self._listener.start()
        except Exception as e:
            logger.error(f"Failed to start mouse listener: {e}", exc_info=True)
            self._listener = None
            raise

    def stop(self) -> None:
        if self._listener:
            self._listener.stop()
            self._listener = None

    def is_running(self) -> bool:
        return self._listener is not None and self._listener.running


