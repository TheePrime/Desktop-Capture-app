import csv
import datetime
import json
import os
import struct
import sys
from logger import ClickLogger


OUTPUT_BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
_CLICK_LOGGER = ClickLogger(OUTPUT_BASE)


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
        "text": text,
        "screenshot_path": None,
    }
    _CLICK_LOGGER.log_click(record)


def main():
    ensure_log_dir()
    while True:
        message = read_message()
        write_log(message)
        send_message({"status": "ok"})


if __name__ == "__main__":
    main()

