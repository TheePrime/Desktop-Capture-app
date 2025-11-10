"""Simulate a PDF click/log event to verify `doc_path` appears in NDJSON and CSV.

This script uses ClickLogger directly to log a synthetic record for today.
"""
import time
import os
from logger import ClickLogger

OUTPUT_BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
logger = ClickLogger(OUTPUT_BASE)

record = {
    # time.strftime doesn't support %f; use time.time() for ms
    "timestamp_utc": time.strftime("%Y-%m-%dT%H-%M-%S", time.gmtime()) + ".000Z",
    "x": 100,
    "y": 200,
    "app_name": "chrome",
    "process_id": 12345,
    "window_title": "Example Domain - Google Chrome",
    "display_id": 1,
    "source": "os",
    "url_or_path": "https://example.com",
    "doc_path": None,
    "text": "Clicked inside Chrome page",
    "screenshot_path": None,
}

print("Logging synthetic PDF click record...")
logger.log_click(record)

# Give a moment for file writes
time.sleep(0.1)

# Print last NDJSON line for today
ndjson_path = logger.ndjson_path
csv_path = logger.csv_path
print("NDJSON:", ndjson_path)
try:
    with open(ndjson_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        if lines:
            print(lines[-1].strip())
        else:
            print('<no lines>')
except Exception as e:
    print('Failed to read NDJSON:', e)

print('CSV:', csv_path)
try:
    with open(csv_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        if lines:
            print(lines[-1].strip())
        else:
            print('<no lines>')
except Exception as e:
    print('Failed to read CSV:', e)
