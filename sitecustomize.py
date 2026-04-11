import sys
from pathlib import Path


_REPO_ROOT = Path(__file__).resolve().parent
repo_root_str = str(_REPO_ROOT)
if repo_root_str not in sys.path:
    sys.path.insert(0, repo_root_str)
