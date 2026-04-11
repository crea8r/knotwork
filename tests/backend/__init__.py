from pathlib import Path
import sys


_BACKEND_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _BACKEND_DIR.parent

for path in (str(_REPO_ROOT), str(_BACKEND_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)
