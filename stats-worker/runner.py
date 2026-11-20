from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

# Prevent worker libraries from spawning oversized thread pools or touching network proxies
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

try:
    import resource

    # Cap virtual memory (1.5 GB) and CPU time (25s) inside the isolated worker process
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
except Exception:
    pass

from pydantic import BaseModel, Field, ValidationError

from citations import runtime_metadata
from engine import WorkerStatsError, dispatch_test
from repro_script import generate_reproducible_script


class WorkerRequest(BaseModel):
    spec: dict[str, Any]
    spec_hash: str = Field(min_length=16, max_length=128)
    dataset_sha256: str = Field(min_length=16, max_length=128)
    variables: list[dict[str, Any]]
    rows: list[dict[str, Any]]


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--health":
        meta = runtime_metadata()
        print(json.dumps({"ok": True, **meta}))
        return 0

    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
        req = WorkerRequest.model_validate(payload)
        computed = dispatch_test(req.spec, req.variables, req.rows)
        meta = runtime_metadata()
        seed = int((req.spec.get("options") or {}).get("seed", 42))
        provenance = {
            "spec_version": str(req.spec.get("specVersion", "1.0")),
            "spec_hash": req.spec_hash,
            "dataset_sha256": req.dataset_sha256,
            "engine": meta["engine"],
            "engine_version": meta["engine_version"],
            "runtime": meta["runtime"],
            "libraries": computed["citations"],
            "seed": seed,
            "executed_at_utc": datetime.now(timezone.utc).isoformat(),
            "verified_by_library": True,
            "warnings": computed.get("warnings", []),
        }
        result = computed["result"]
        result["provenance"] = provenance
        result["reproducible_script"] = generate_reproducible_script(
            req.spec,
            req.spec_hash,
            req.dataset_sha256,
        )
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except ValidationError as exc:
        print(json.dumps({"ok": False, "code": "INVALID_INPUT", "detail": str(exc)}, ensure_ascii=False))
        return 2
    except WorkerStatsError as exc:
        msg = str(exc)
        code = "UNSUPPORTED_TEST" if msg.startswith("UNSUPPORTED_TEST:") else "STATS_ERROR"
        print(json.dumps({"ok": False, "code": code, "detail": msg}, ensure_ascii=False))
        return 3
    except Exception as exc:
        print(json.dumps({"ok": False, "code": "WORKER_ERROR", "detail": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
