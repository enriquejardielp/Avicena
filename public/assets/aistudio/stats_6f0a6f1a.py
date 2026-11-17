from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from lib import stats_engine
from lib.access import get_dataset
from lib.auth import analyst
from lib.dataset_utils import load_rows
from models.core import AnalysisRequest, AnalysisResult

router = APIRouter()


async def run_analysis(dataset: dict, test: str, params: dict) -> AnalysisResult:
    rows = await load_rows(dataset["id"])
    try:
        res = await run_in_threadpool(stats_engine.run, test, rows, dataset["variables"], params)
    except stats_engine.StatsError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:  # numerical failures surface as a readable message, not a 500
        raise HTTPException(status_code=422, detail=f"No se pudo calcular: {e}")
    return AnalysisResult(**res)


@router.post("/analyze", response_model=AnalysisResult)
async def analyze(body: AnalysisRequest, member: dict = Depends(analyst)):
    d, _ = await get_dataset(body.dataset_id, member)
    return await run_analysis(d, body.test, body.params)
