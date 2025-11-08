"""Diagnostic helper to verify screenshot capture and cursor overlay.

Run this from the backend folder. It will perform a single capture and then (optionally)
start the running capture for a short duration to confirm 1Hz behavior.
"""
import os
import time
from capture import ScreenCapture, CaptureConfig


def _repo_root_data_path() -> str:
    # Resolve the repo-root `data` directory relative to this file (../data)
    here = os.path.dirname(os.path.abspath(__file__))
    root_data = os.path.abspath(os.path.join(here, "..", "data"))
    os.makedirs(root_data, exist_ok=True)
    return root_data


def run_once():
    cfg = CaptureConfig(hz=1.0, output_base=_repo_root_data_path())
    sc = ScreenCapture(cfg)
    path = sc.capture_once()
    if path:
        print(f"Captured: {path}")
    else:
        print("Capture failed; check backend logs for details.")


if __name__ == "__main__":
    print("Running single capture test...")
    run_once()
    print("Now running a short 3-second capture at 1Hz to verify cadence...")
    cfg = CaptureConfig(hz=1.0, output_base=_repo_root_data_path())
    sc = ScreenCapture(cfg)
    sc.start()
    time.sleep(3.2)
    sc.stop()
    print("Short capture run complete. Check data/ for new screenshots and backend logs.")
