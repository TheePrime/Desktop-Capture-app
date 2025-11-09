import csv
import datetime
import json
import logging
import os
import struct
import sys
from urllib.parse import urlparse, unquote
from logger import ClickLogger


OUTPUT_BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
_CLICK_LOGGER = ClickLogger(OUTPUT_BASE)

# Configure a small file logger for the native host process. We avoid printing to stdout
# because stdout is used for the native messaging framing protocol.
LOG_PATH = os.path.join(os.path.dirname(__file__), 'native_host.log')
logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format='%(asctime)s [native_host] %(levelname)s: %(message)s',
)
logger = logging.getLogger('native_host')


def ensure_log_dir() -> None:
    os.makedirs(OUTPUT_BASE, exist_ok=True)


def read_message():
    try:
        # Read the message length (first 4 bytes)
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            logger.warning("Native host: stdin closed, exiting gracefully")
            sys.exit(0)
            
        # Unpack message length as unsigned int
        try:
            message_length = struct.unpack("I", raw_length)[0]
        except struct.error as e:
            logger.error(f"Failed to unpack message length: {e}")
            return None
            
        # Read the message content
        try:
            message = sys.stdin.buffer.read(message_length).decode("utf-8")
        except (IOError, UnicodeDecodeError) as e:
            logger.error(f"Failed to read message content: {e}")
            return None
            
        # Parse JSON
        try:
            return json.loads(message)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse message JSON: {e}")
            return None
            
    except Exception as e:
        logger.error(f"Unexpected error in read_message: {e}", exc_info=True)
        return None


def send_message(message):
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def write_log(data):
    ensure_log_dir()
    ts = datetime.datetime.utcnow().isoformat() + "Z"
    text = data.get("text")
    url = data.get("browser_url") or data.get("url")
    
    # Log the incoming data for debugging
    try:
        logger.info(f"Received data: {json.dumps(data)}")
    except Exception:
        logger.warning("Could not log incoming data")
        
    # Try to get process info for Chrome
    process_id = None
    try:
        import psutil
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                if 'chrome' in proc.info['name'].lower():
                    # If we have a tab ID, try to match it in the command line
                    tab_id = data.get('tabId')
                    if tab_id:
                        cmdline = ' '.join(proc.cmdline()).lower()
                        if f'tab={tab_id}' in cmdline or str(tab_id) in cmdline:
                            process_id = proc.info['pid']
                            break
                    else:
                        # No tab ID - use first Chrome process found
                        process_id = proc.info['pid']
                        break
            except Exception:
                continue
    except Exception as e:
        logger.warning(f"Failed to get Chrome process info: {e}")
    # Handle PDF paths first
    doc_path = None
    if data.get("is_pdf"):
        # Check explicit PDF path from extension
        if data.get("pdf_path"):
            doc_path = os.path.abspath(data["pdf_path"])
            logger.info(f"Using explicit PDF path: {doc_path}")
        # Try file:// URL parsing
        elif url and isinstance(url, str) and url.startswith("file://"):
            try:
                parsed = urlparse(url)
                path = unquote(parsed.path or "")
                # Clean Windows paths
                if os.name == "nt" and path.startswith("/") and len(path) > 2 and path[2] == ":":
                    path = path.lstrip("/")
                doc_path = os.path.abspath(path)
                logger.info(f"Extracted PDF path from URL: {doc_path}")
            except Exception as e:
                logger.warning(f"Failed to parse PDF URL: {e}")

    record = {
        "timestamp_utc": ts,
        "x": data.get("x"),
        "y": data.get("y"),
        "app_name": "chrome_pdf" if data.get("is_pdf") else "chrome",
        "process_id": process_id,  # Use the process_id we found above
        "window_title": data.get("title"),
        "display_id": None,  # Will be set below
        "source": data.get("source", "ext"),
        "url_or_path": doc_path if doc_path else url,
        "doc_path": doc_path,
        "text": text,
        "screenshot_path": None,
    }
    
    # Always try to map display_id from coordinates
    gx = data.get("global_x")
    gy = data.get("global_y")
    if gx is not None and gy is not None:
        try:
            # Try Win32 API first
            if os.name == "nt":
                import win32api
                monitor = win32api.MonitorFromPoint((gx, gy))
                if monitor:
                    # Get all monitors and find our index
                    monitors = win32api.EnumDisplayMonitors()
                    for i, m in enumerate(monitors, 1):
                        if m[0] == monitor:
                            record["display_id"] = i
                            logger.info(f"Win32API: Mapped ({gx},{gy}) to display {i}")
                            break
        except Exception as e:
            logger.warning(f"Win32 display mapping failed: {e}")
            
        # Fallback to MSS mapping if needed
        if not record["display_id"]:
    # If the extension supplied a file:// URL (Chrome PDF viewer), record the
    # local document path in `doc_path` and normalize `url_or_path` to that path.
    try:
        if url and isinstance(url, str) and url.startswith("file://"):
            parsed = urlparse(url)
            path = unquote(parsed.path or "")
            # On Windows the path may start with a leading slash ("/C:/...")
            if os.name == "nt" and path.startswith("/") and len(path) > 2 and path[2] == ":":
                path = path.lstrip("/")
            record["doc_path"] = path
            record["url_or_path"] = path
            # Keep app_name as chrome (embedded PDF viewer) for now
    except Exception:
        # Don't let parsing errors break the native host
        pass

    # If extension provided global coordinates, try to map to a display id.
    # Heuristic: try the raw coords first; if no monitor matches and the
    # extension provided a devicePixelRatio, also try scaled variants (gx * dpr)
    # and (gx / dpr) to handle cases where the extension reported CSS pixels
    # rather than physical pixels. Log monitors and attempts to native_host.log
    try:
        gx = data.get("global_x")
        gy = data.get("global_y")
        dpr = data.get("devicePixelRatio") or data.get("dpr") or 1
        if gx is not None and gy is not None:
            try:
                import mss
                with mss.mss() as sct:
                    monitors = sct.monitors
                    # Diagnostic: log monitor rectangles and incoming coords
                    try:
                        logger.info(f"Mapping global coords gx={gx}, gy={gy}, dpr={dpr}")
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

                    # Attempt 1: raw coords
                    mapped = try_map(gx, gy)

                    # Attempt 2: scale up (assume extension gave CSS pixels)
                    if mapped is None and dpr and dpr != 1:
                        try:
                            sgx = int(round(float(gx) * float(dpr)))
                            sgy = int(round(float(gy) * float(dpr)))
                            mapped = try_map(sgx, sgy)
                            if mapped is not None:
                                used_coords = (sgx, sgy)
                        except Exception:
                            pass

                    # Attempt 3: scale down (extension may have sent physical pixels)
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
                logger.exception("mss mapping failed in native host")
    except Exception:
        # ignore any mapping/parsing errors but don't crash the host
        logger.exception("Error while attempting to map global coords in native host")

    _CLICK_LOGGER.log_click(record)
    try:
        # Log to native_host.log for diagnostics (do not write to stdout/stderr)
        logger.info(f"Wrote click record to NDJSON: { _CLICK_LOGGER.ndjson_path }")
    except Exception:
        pass


def main():
    ensure_log_dir()
    logger.info("Native host starting up")
    error_count = 0
    max_errors = 5  # Allow up to 5 errors before exiting
    
    while True:
        try:
            # Read the next message
            message = read_message()
            if message is None:
                error_count += 1
                logger.warning(f"Failed to read message (error {error_count} of {max_errors})")
                if error_count >= max_errors:
                    logger.error("Too many errors, exiting")
                    sys.exit(1)
                continue
                
            # Reset error count on successful message
            error_count = 0
            
            # Process the message
            try:
                write_log(message)
                send_message({"status": "ok"})
            except Exception as e:
                logger.error(f"Error processing message: {e}", exc_info=True)
                try:
                    # Try to notify extension of the error
                    send_message({"status": "error", "error": str(e)})
                except Exception:
                    pass
                    
        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}", exc_info=True)
            error_count += 1
            if error_count >= max_errors:
                logger.error("Too many errors, exiting")
                sys.exit(1)


if __name__ == "__main__":
    main()

