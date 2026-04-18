"""
FastAPI app exposing the Python debt kernel as an optional service.

Run:
  uvicorn debt_engine_py.main:app --host 0.0.0.0 --port 8080

The TS orchestration layer (`src/orchestration/pythonClient.ts`) will
call `/orchestrate` when `DEBT_ENGINE_PY_URL` is set; otherwise it uses
the pure-TS fallback. Keeping both paths in lockstep is enforced by the
parity tests under `tests/orchestration/`.
"""
from __future__ import annotations
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .models import OrchestrateRequest, OrchestrateResponse
from .orchestrator import orchestrate

app = FastAPI(title='REDIP Debt Kernel (Python)', version='1.0')


@app.get('/health')
def health():
    return {'status': 'ok', 'engine': 'python-1.0'}


@app.post('/orchestrate', response_model=OrchestrateResponse)
def orchestrate_endpoint(req: OrchestrateRequest):
    try:
        return orchestrate(req)
    except Exception as e:  # pragma: no cover - surface error detail
        return JSONResponse(status_code=500, content={'error': str(e), 'type': type(e).__name__})
