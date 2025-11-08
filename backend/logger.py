import csv
import json
import logging
import os
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, Any

logger = logging.getLogger(__name__)


def utc_iso_millis(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.now(timezone.utc)
    # Format: YYYY-MM-DDTHH-MM-SS.mmmZ (note dashes instead of colons for Windows-safe filenames)
    return dt.strftime("%Y-%m-%dT%H-%M-%S.%f")[:-3] + "Z"


def day_folder(base_dir: str) -> str:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    folder = os.path.join(base_dir, day)
    os.makedirs(folder, exist_ok=True)
    return folder


class ClickLogger:
    def __init__(self, output_base: str) -> None:
        self.output_base = output_base
        os.makedirs(self.output_base, exist_ok=True)
        self._csv_lock = Lock()
        self._ndjson_lock = Lock()

    @property
    def csv_path(self) -> str:
        folder = day_folder(self.output_base)
        return os.path.join(folder, "clicks.csv")

    @property
    def ndjson_path(self) -> str:
        folder = day_folder(self.output_base)
        return os.path.join(folder, "clicks.ndjson")

    def _ensure_csv_header(self) -> None:
        path = self.csv_path
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            with open(path, mode="w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow([
                    "timestamp_utc",
                    "x",
                    "y",
                    "app_name",
                    "process_id",
                    "window_title",
                    "display_id",
                    "source",
                    "url_or_path",
                    "doc_path",
                    "text",
                    "screenshot_path",
                ])

    def log_click(self, record: Dict[str, Any]) -> None:
        try:
            # Normalize minimal fields
            record = {
                "timestamp_utc": record.get("timestamp_utc", utc_iso_millis()),
                "x": record.get("x"),
                "y": record.get("y"),
                "app_name": record.get("app_name"),
                "process_id": record.get("process_id"),
                "window_title": record.get("window_title"),
                "display_id": record.get("display_id"),
                "source": record.get("source", "os"),
                "url_or_path": record.get("url_or_path"),
                "text": record.get("text"),
                "screenshot_path": record.get("screenshot_path"),
                **{k: v for k, v in record.items() if k not in {
                    "timestamp_utc","x","y","app_name","process_id","window_title","display_id","source","url_or_path","text","screenshot_path"
                }}
            }

            logger.info(f"Logging click: source={record.get('source')}, x={record.get('x')}, y={record.get('y')}, text={record.get('text')[:50] if record.get('text') else None}")

            # NDJSON
            try:
                with self._ndjson_lock:
                    with open(self.ndjson_path, mode="a", encoding="utf-8") as nf:
                        nf.write(json.dumps(record, ensure_ascii=False) + "\n")
                logger.debug(f"Wrote to NDJSON: {self.ndjson_path}")
            except Exception as e:
                logger.error(f"Failed to write NDJSON: {e}", exc_info=True)

            # CSV
            try:
                with self._csv_lock:
                    self._ensure_csv_header()
                    with open(self.csv_path, mode="a", newline="", encoding="utf-8") as cf:
                        writer = csv.writer(cf)
                        writer.writerow([
                            record.get("timestamp_utc"),
                            record.get("x"),
                            record.get("y"),
                            record.get("app_name"),
                            record.get("process_id"),
                            record.get("window_title"),
                            record.get("display_id"),
                            record.get("source"),
                            record.get("url_or_path"),
                            record.get("doc_path"),
                            (record.get("text") or "").replace("\n", " ").strip(),
                            record.get("screenshot_path"),
                        ])
                logger.debug(f"Wrote to CSV: {self.csv_path}")
            except Exception as e:
                logger.error(f"Failed to write CSV: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"Error in log_click: {e}", exc_info=True)


