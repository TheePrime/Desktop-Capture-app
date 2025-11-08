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
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        sys.exit(0)
    message_length = struct.unpack("I", raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)


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
    record = {
        "timestamp_utc": ts,
        "x": data.get("x"),
        "y": data.get("y"),
        "app_name": "chrome",
        "process_id": None,
        "window_title": data.get("title"),
        "display_id": data.get("display_id"),
        "source": data.get("source", "ext"),
        "url_or_path": url,
        # Optionally include doc_path when extension sends a file:// URL
        # (parsed below)
        # "doc_path": None,
        "text": text,
        "screenshot_path": None,
    }
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
    _CLICK_LOGGER.log_click(record)
    try:
        # Log to native_host.log for diagnostics (do not write to stdout/stderr)
        logger.info(f"Wrote click record to NDJSON: { _CLICK_LOGGER.ndjson_path }")
    except Exception:
        pass


def main():
    ensure_log_dir()
    while True:
        message = read_message()
        write_log(message)
        send_message({"status": "ok"})


if __name__ == "__main__":
    main()

