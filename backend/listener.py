from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Thread
from typing import Callable, Optional

import psutil
from pynput import mouse
import pyautogui
import pygetwindow

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
        win = pygetwindow.getActiveWindow()
        if win and hasattr(win, "_hWnd"):
            # Fallback: use foreground process by mouse position
            for p in psutil.process_iter(attrs=["pid", "name"]):
                # We can't reliably map hWnd -> pid without win32, keep simple
                pass
        # Use current process under cursor via psutil as placeholder
        name = None
        pid = None
        return name, pid
    except Exception:
        return None, None


def _get_display_id_for_point(x: int, y: int) -> int:
    # Heuristic: derive display index from position
    try:
        screens = pyautogui.screenInfo()
    except Exception:
        screens = None
    # If pyautogui doesn't provide, fallback to 0
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


