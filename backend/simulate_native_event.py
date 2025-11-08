"""Simulate a native-host incoming message to test display_id mapping.
Calls native_host.write_log with global_x/global_y and prints NDJSON/CSV tail.
"""
import os
import time
from native_host import write_log
from logger import ClickLogger

OUTPUT_BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
logger = ClickLogger(OUTPUT_BASE)

payload = {
    "text": "Simulated native ext click",
    "browser_url": "file:///C:/Users/Admin/Downloads/example.pdf",
    "title": "C:/Users/Admin/Downloads/example.pdf - Chrome",
    "global_x": 100,
    "global_y": 200,
}

print("Calling native_host.write_log with payload:", payload)
write_log(payload)

# allow file writes
time.sleep(0.1)
ndjson_path = logger.ndjson_path
csv_path = logger.csv_path
print('NDJSON:', ndjson_path)
with open(ndjson_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
    print(lines[-1].strip())
print('CSV:', csv_path)
with open(csv_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
    print(lines[-1].strip())
