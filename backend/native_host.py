import csv
import datetime
import json
import os
import struct
import sys


LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
CSV_PATH = os.path.join(LOG_DIR, "clicks.csv")
NDJSON_PATH = os.path.join(LOG_DIR, "clicks.ndjson")


def ensure_log_dir() -> None:
    os.makedirs(LOG_DIR, exist_ok=True)


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
    data["ts"] = ts
    data.setdefault("source", "ext")

    with open(NDJSON_PATH, "a", encoding="utf-8") as ndjson_file:
        ndjson_file.write(json.dumps(data, ensure_ascii=False) + "\n")

    header = ["ts", "text", "browser_url", "source"]
    write_header = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=header)
        if write_header:
            writer.writeheader()
        row = {key: data.get(key, "") for key in header}
        writer.writerow(row)


def main():
    ensure_log_dir()
    while True:
        message = read_message()
        write_log(message)
        send_message({"status": "ok"})


if __name__ == "__main__":
    main()

