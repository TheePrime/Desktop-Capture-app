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
                # Gather context first so we can log a single, informative line
                app_name, pid = _get_active_process_info()
                title = _get_active_window_title()
                display_id = _get_display_id_for_point(x, y)
                # Verbose log for every OS click so we can diagnose missed Acrobat events
                try:
                    logger.info(
                        f"OS click detected: x={x}, y={y}, button={button}, "
                        f"app_name={app_name}, process_id={pid}, window_title={title}, display_id={display_id}"
                    )
                except Exception:
                    # Non-fatal logging failure should not stop processing
                    logger.debug("OS click detected (failed to format full info)")
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
                # If this looks like a browser window (Chrome/Edge/Firefox), attempt a
                # simple clipboard-based selection extraction (Ctrl+C). This is a
                # lightweight, cross-browser approach that works for typical web pages
                # and Chrome's built-in PDF viewer. Keep this optional and non-fatal.
                try:
                    name_lower = (app_name or "").lower()
                    title_lower = (title or "").lower()
                    if any(b in name_lower for b in ("chrome", "msedge", "firefox", "brave", "opera")) or "google chrome" in title_lower:
                        import time
                        try:
                            import win32clipboard
                        except Exception:
                            win32clipboard = None

                        prev_clip = None
                        if win32clipboard:
                            try:
                                win32clipboard.OpenClipboard()
                                try:
                                    prev_clip = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
                                except Exception:
                                    prev_clip = None
                                finally:
                                    win32clipboard.CloseClipboard()
                            except Exception:
                                prev_clip = None

                        try:
                            logger.info("Attempting clipboard-based selection extraction (Ctrl+C) for browser window")
                        except Exception:
                            pass
                        try:
                            pyautogui.hotkey('ctrl', 'c')
                        except Exception:
                            logger.warning("pyautogui.hotkey('ctrl','c') failed or unavailable")

                        sel_text = None
                        if win32clipboard:
                            for _ in range(10):
                                try:
                                    win32clipboard.OpenClipboard()
                                    try:
                                        data = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
                                        if data and data != prev_clip:
                                            sel_text = data
                                            win32clipboard.CloseClipboard()
                                            break
                                    except Exception:
                                        pass
                                    finally:
                                        try:
                                            win32clipboard.CloseClipboard()
                                        except Exception:
                                            pass
                                except Exception:
                                    pass
                                time.sleep(0.05)

                        if sel_text:
                            click_record["text"] = sel_text.strip()
                            try:
                                logger.info(f"Clipboard selection extracted ({len(sel_text)} chars)")
                            except Exception:
                                pass
                        else:
                            try:
                                logger.info("No clipboard selection detected after Ctrl+C")
                            except Exception:
                                pass

                        # Restore previous clipboard content
                        if win32clipboard and prev_clip is not None:
                            try:
                                win32clipboard.OpenClipboard()
                                try:
                                    win32clipboard.EmptyClipboard()
                                    win32clipboard.SetClipboardData(win32clipboard.CF_UNICODETEXT, prev_clip)
                                finally:
                                    win32clipboard.CloseClipboard()
                            except Exception:
                                pass
                except Exception:
                    # Non-fatal: if extraction fails, continue without text
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


