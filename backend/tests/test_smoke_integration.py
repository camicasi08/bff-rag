import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(
    os.getenv("RUN_LIVE_STACK_TESTS") == "1",
    "Set RUN_LIVE_STACK_TESTS=1 to run live integration checks.",
)
class LiveSmokeIntegrationTest(unittest.TestCase):
    def test_smoke_script_passes(self) -> None:
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "smoke_test.py")],
            check=True,
            cwd=ROOT,
        )


if __name__ == "__main__":
    unittest.main()
