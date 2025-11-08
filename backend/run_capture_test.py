"""Quick runner to validate the capture produces at least one PNG in the repo-root data folder.
This is a simple integration check that doesn't require pytest.
Exit code 0 = success (>=1 PNG created), 1 = failure.
"""
import time
import os
import sys
from capture import ScreenCapture, CaptureConfig


def repo_data():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "data"))


def count_pngs_for_today(data_root: str) -> int:
    today = time.strftime("%Y-%m-%d")
    folder = os.path.join(data_root, today)
    if not os.path.isdir(folder):
        return 0
    return len([p for p in os.listdir(folder) if p.lower().endswith(".png")])


if __name__ == "__main__":
    data_root = repo_data()
    print("Using data root:", data_root)
    before = count_pngs_for_today(data_root)
    cfg = CaptureConfig(hz=1.0, output_base=data_root)
    sc = ScreenCapture(cfg)
    print("Running short capture for 3 seconds...")
    sc.start()
    time.sleep(3.2)
    sc.stop()
    after = count_pngs_for_today(data_root)
    created = after - before
    print(f"Screenshots created for today: {created}")
    if created >= 1:
        print("OK: capture created at least one PNG")
        sys.exit(0)
    else:
        print("FAIL: no PNG created")
        sys.exit(1)
