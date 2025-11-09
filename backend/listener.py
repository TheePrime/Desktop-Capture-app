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
        # First try to get active window info
        active_win = None
        try:
            active_win = pygetwindow.getActiveWindow()
        except Exception:
            pass

        if active_win:
            try:
                # Windows-specific: get PID from window handle
                if os.name == 'nt':
                    import win32process
                    import win32gui
                    hwnd = active_win._hWnd
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    try:
                        proc = psutil.Process(pid)
                        return proc.name(), pid
                    except Exception:
                        pass
            except Exception:
                pass

        # Fallback: scan for known browser processes
        browser_names = ['chrome', 'msedge', 'firefox', 'brave', 'opera']
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                name = proc.info['name'].lower()
                # Match browser processes
                if any(b in name for b in browser_names):
                    # If we have an active window title, try to match it to browser tabs
                    if active_win and active_win.title:
                        title = active_win.title.lower()
                        cmdline = ' '.join(proc.info.get('cmdline', [])).lower()
                        if title in cmdline or any(b in title for b in browser_names):
                            return proc.info['name'], proc.info['pid']
                    else:
                        # No title to match - return first browser found
                        return proc.info['name'], proc.info['pid']
            except Exception:
                continue

        return None, None
    except Exception as e:
        logger.error(f"Error getting process info: {e}")
        return None, None

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


def _looks_like_adobe_reader_process(name: Optional[str]) -> bool:
    if not name:
        return False
    n = name.lower()
    # Common Adobe Reader process names: AcroRd32.exe, AcroRd64.exe, Acrobat.exe
    return any(k in n for k in ("acro", "acrord", "adobe"))


def _extract_pdf_from_title(title: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Try to extract a PDF filename or path from a window title.

    Returns (full_path_or_none, filename_or_none). If only filename is found,
    full_path_or_none will be None and filename_or_none will contain the name.
    """
    if not title:
        return None, None
    t = title.strip()
    # Look for .pdf in the title
    idx = t.lower().find(".pdf")
    if idx == -1:
        return None, None
    # Try to expand backwards to capture the full path or filename
    start = idx
    while start > 0 and t[start] not in (' ', '"', '\'', '-', '|', '\\', '/'):
        start -= 1
    # include the .pdf
    pdf_candidate = t[start: idx + 4].strip(' -"\'')
    # Clean up surrounding separators like ' - Adobe Acrobat'
    pdf_candidate = pdf_candidate.strip()
    if pdf_candidate.lower().endswith('.pdf'):
        # If it looks like a full path (contains a drive letter), return as full
        if ":" in pdf_candidate or pdf_candidate.startswith("/"):
            return pdf_candidate, os.path.basename(pdf_candidate)
        return None, os.path.basename(pdf_candidate)
    return None, None


def _find_file_in_common_places(filename: str) -> Optional[str]:
    """Quick heuristic: look for filename in common user folders (Downloads, Desktop, Documents).

    This is intentionally non-recursive for performance; if not found we return None.
    """
    user = os.path.expanduser("~")
    candidates = [
        os.path.join(user, "Downloads"),
        os.path.join(user, "Desktop"),
        os.path.join(user, "Documents"),
    ]
    for d in candidates:
        try:
            p = os.path.join(d, filename)
            if os.path.exists(p):
                return p
        except Exception:
            continue
    return None


def _get_display_id_for_point(x: int, y: int) -> int:
    """Enhanced display mapping with Win32 API support and device pixel ratio handling."""
    try:
        # Try Win32 API first for more accurate monitor info
        if os.name == 'nt':
            try:
                import win32api
                monitor = win32api.MonitorFromPoint((x, y))
                if monitor:
                    info = win32api.GetMonitorInfo(monitor)
                    # Convert monitor number to 1-based index
                    display_num = len(win32api.EnumDisplayMonitors()) 
                    for i, m in enumerate(win32api.EnumDisplayMonitors(), 1):
                        if m[0] == monitor:
                            logger.info(f"Win32API: Point ({x},{y}) matched to monitor {i} of {display_num}")
                            return i
            except Exception as e:
                logger.warning(f"Win32 monitor detection failed: {e}")

        # Fallback to MSS
        with mss.mss() as sct:
            # Skip virtual screen, get physical monitors
            real_monitors = sct.monitors[1:]
            
            # Log monitor layout
            logger.info("Monitor layout:")
            for idx, mon in enumerate(real_monitors, 1):
                logger.info(f"Monitor {idx}: {mon['left']},{mon['top']} {mon['width']}x{mon['height']}")

            # Try direct match first
            for idx, mon in enumerate(real_monitors, 1):
                if (mon['left'] <= x < mon['left'] + mon['width'] and 
                    mon['top'] <= y < mon['top'] + mon['height']):
                    logger.info(f"MSS direct match: ({x},{y}) -> monitor {idx}")
                    return idx

            # Try with device pixel ratio adjustment
            try:
                if os.name == 'nt':
                    import ctypes
                    user32 = ctypes.windll
                    dpi = user32.user32.GetDpiForSystem()
                    scale = dpi / 96.0
                    scaled_x = int(x / scale)
                    scaled_y = int(y / scale)
                    for idx, mon in enumerate(real_monitors, 1):
                        if (mon['left'] <= scaled_x < mon['left'] + mon['width'] and 
                            mon['top'] <= scaled_y < mon['top'] + mon['height']):
                            logger.info(f"MSS scaled match: ({x},{y}) -> ({scaled_x},{scaled_y}) -> monitor {idx}")
                            return idx
            except Exception as e:
                logger.warning(f"DPI scaling adjustment failed: {e}")

            # If no match, use primary monitor
            logger.info(f"No monitor match for ({x},{y}), using primary (1)")
            return 1
            
    except Exception as e:
        logger.error(f"Display mapping failed: {e}")
        return 1


def find_pid_for_window_title(title: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """Return (process_name, pid) for a window whose title contains the given string.

    Best-effort: uses win32 EnumWindows on Windows to find matching HWNDs and returns
    the first matching process. Falls back to scanning psutil process cmdlines.
    """
    if not title:
        return None, None
    try:
        # Prefer Windows API where available
        if os.name == "nt":
            try:
                import win32gui
                import win32process

                matches = []

                def _cb(hwnd, _):
                    try:
                        text = win32gui.GetWindowText(hwnd)
                        if text and title.lower() in text.lower():
                            _, pid = win32process.GetWindowThreadProcessId(hwnd)
                            matches.append(pid)
                    except Exception:
                        pass
                    return True

                win32gui.EnumWindows(_cb, None)
                for pid in matches:
                    try:
                        p = psutil.Process(pid)
                        return p.name(), pid
                    except Exception:
                        continue
            except Exception:
                pass

        # Fallback: scan processes for likely browsers and check cmdline/title hints
        title_lower = title.lower()
        for p in psutil.process_iter(attrs=["pid", "name", "cmdline"]):
            try:
                name = (p.info.get("name") or "")
                cmd = " ".join(p.info.get("cmdline") or [])
                if name and any(k in name.lower() for k in ("chrome", "msedge", "firefox", "acrord", "acrobat")):
                    if title_lower in name.lower() or title_lower in cmd.lower():
                        return name, p.info.get("pid")
            except Exception:
                continue
    except Exception:
        pass
    return None, None


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
                # If this looks like an Adobe Reader window, attempt to extract the
                # open PDF path or filename from the window title and try to resolve
                # it to a full path in common locations.
                try:
                    if _looks_like_adobe_reader_process(app_name) or (title and "adobe" in title.lower()):
                        full, name = _extract_pdf_from_title(title)
                        if full:
                            click_record["doc_path"] = full
                        elif name:
                            # Try to find the file in common user folders
                            found = _find_file_in_common_places(name)
                            if found:
                                click_record["doc_path"] = found
                            else:
                                click_record["doc_name"] = name
                except Exception:
                    # Non-fatal: if extraction fails, continue without doc info
                    pass
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


