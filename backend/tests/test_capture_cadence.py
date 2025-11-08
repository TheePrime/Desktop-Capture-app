import time
import os
from capture import ScreenCapture, CaptureConfig


def repo_data():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "data"))


def test_capture_creates_png(tmp_path):
    data_root = repo_data()
    before = len([p for p in os.listdir(os.path.join(data_root, time.strftime("%Y-%m-%d"))) if p.lower().endswith('.png')]) if os.path.isdir(os.path.join(data_root, time.strftime("%Y-%m-%d"))) else 0
    cfg = CaptureConfig(hz=1.0, output_base=data_root)
    sc = ScreenCapture(cfg)
    sc.start()
    time.sleep(2.2)
    sc.stop()
    after = len([p for p in os.listdir(os.path.join(data_root, time.strftime("%Y-%m-%d"))) if p.lower().endswith('.png')]) if os.path.isdir(os.path.join(data_root, time.strftime("%Y-%m-%d"))) else 0
    assert after - before >= 1
