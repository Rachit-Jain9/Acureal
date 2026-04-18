"""
Vercel Python serverless entry for the FastAPI investor-intelligence
service. Re-exports the ASGI `app` from
`packages/financial-kernel/src/debt-engine-py/app.py`.

Vercel routes /api/investor-package (and any sub-paths via the
`matcher` in vercel.json) to this file, which hands off to FastAPI.
"""
import os
import sys

# Make the kernel python module importable as `intelligence`.
_KERNEL_PY = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "packages",
    "financial-kernel",
    "src",
    "debt-engine-py",
)
if _KERNEL_PY not in sys.path:
    sys.path.insert(0, _KERNEL_PY)

from app import app  # noqa: E402  re-export ASGI app for Vercel
