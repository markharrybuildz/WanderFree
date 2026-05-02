"""Shared pytest fixtures and path setup.

Adds ``src/`` to sys.path so tests can ``import extract.foo`` without needing
the package to be ``pip install -e``'d. This is a small convenience that lets
contributors run tests immediately after cloning.
"""

from __future__ import annotations

import sys
from pathlib import Path

# pipeline/ is two levels up from this file (pipeline/tests/conftest.py).
PIPELINE_ROOT = Path(__file__).resolve().parents[1]
SRC = PIPELINE_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
