"""Julius-style copilot: plan an analysis (JSON), run it in Python, stream the interpretation."""

import json
import logging
import os
import re
import uuid

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from lib.access import get_dataset
from lib.auth import analyst
from lib.db import db
from lib.stats_engine import TEST_DOCS
from models.core import ChatIn, ChatMessage
from routers.stats import run_analysis

router = APIRouter()
log = logging.getLogger(__name__)

MODELS = {
    "claude": ("anthropic", "claude-sonnet-4-5-20250929"),
    "gpt": ("openai", "gpt-5.2"),
    "gemini": ("gemini", "gemini-3.1-pro-preview"),
}


def _chat(model: str, system: str) -> LlmChat:
    provider, name = MODELS[model]
    return LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=str(uuid.uuid4()), system_message=system).with_model(provider, name)


def _schema(ds: dict) -> str:
    lines = []
    for v in ds["variables"]:
        extra = f" niveles={v['levels'][:12]}" if v.get("levels") else ""
        lines.append(f"- {v['name']} ({v['type']}){' «' + v['label'] + '»' if v.get('label') else ''}{extra}")
    return "\n".join(lines)


def _history(msgs: list[dict]) -> str:
    return "\n".join(f"{m['role'].upper()}: {m['content'][:800]}" for m in msgs)


PLAN_SYSTEM = """Eres un bioestadístico experto. Decides qué análisis estadístico ejecutar sobre la base de datos del usuario.
Responde SOLO con JSON válido, sin texto adicional: {"analysis": null} o {"analysis": {"test": "<nombre>", "params": {...}}}.
Usa nombres de variable EXACTOS de la lista. Elige null si la pregunta es conceptual o no requiere cálculo.
Pruebas disponibles y parámetros:
""" + TEST_DOCS

ANSWER_SYSTEM = """Eres un asistente de bioestadística para médicos (estilo Julius AI), en español claro y cálido.
Interpreta resultados con rigor: valor p, IC95%, tamaño del efecto, OR/HR, supuestos y limitaciones, y sugiere el siguiente paso.
Usa markdown breve (títulos cortos, viñetas, **negritas**). No inventes números: usa solo los resultados proporcionados.
Si no hay resultados, responde la duda metodológica y propone qué análisis hacer con las variables disponibles."""


def _parse_plan(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        a = json.loads(m.group(0)).get("analysis")
        return a if isinstance(a, dict) and a.get("test") else None
    except json.JSONDecodeError:
        return None


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


@router.get("/ai/messages/{dataset_id}", response_model=list[ChatMessage])
async def history(dataset_id: str, member: dict = Depends(analyst)):
    await get_dataset(dataset_id, member)
    docs = await db.chat_messages.find({"dataset_id": dataset_id, "user_id": member["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [ChatMessage(**d) for d in docs]


@router.delete("/ai/messages/{dataset_id}", status_code=204)
async def clear(dataset_id: str, member: dict = Depends(analyst)):
    await get_dataset(dataset_id, member)
    await db.chat_messages.delete_many({"dataset_id": dataset_id, "user_id": member["user_id"]})


@router.post("/ai/chat")
async def chat(body: ChatIn, member: dict = Depends(analyst)):
    ds, _ = await get_dataset(body.dataset_id, member)
    if not os.environ.get("EMERGENT_LLM_KEY"):
        raise HTTPException(status_code=503, detail="IA no configurada")
    uid = member["user_id"]
    past = await db.chat_messages.find({"dataset_id": ds["id"], "user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(6)
    past.reverse()
    user_msg = ChatMessage(dataset_id=ds["id"], user_id=uid, role="user", content=body.message)
    await db.chat_messages.insert_one(user_msg.model_dump())
    n = await db.rows.count_documents({"dataset_id": ds["id"]})
    context = f"Base de datos «{ds['name']}» (N={n}). Variables:\n{_schema(ds)}\n\nConversación previa:\n{_history(past) or '(ninguna)'}"

    async def gen():
        result = None
        text = ""
        try:
            yield _sse({"type": "status", "text": "Planificando el análisis…"})
            plan_raw = await _chat(body.model, PLAN_SYSTEM).send_message(UserMessage(text=f"{context}\n\nPregunta: {body.message}"))
            plan = _parse_plan(plan_raw or "")
            results_txt = "(sin cálculo)"
            if plan:
                yield _sse({"type": "status", "text": f"Ejecutando {plan['test']} en Python…"})
                try:
                    result = await run_analysis(ds, plan["test"], plan.get("params") or {})
                    yield _sse({"type": "analysis", "result": result.model_dump()})
                    results_txt = json.dumps({"titulo": result.title, "resumen": result.summary,
                                              "tablas": [t.model_dump() for t in result.tables]}, ensure_ascii=False, default=str)[:12000]
                except HTTPException as e:
                    results_txt = f"El análisis {plan['test']} falló: {e.detail}"
            prompt = f"{context}\n\nPregunta: {body.message}\n\nResultados calculados en Python:\n{results_txt}"
            async for ev in _chat(body.model, ANSWER_SYSTEM).stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    text += ev.content
                    yield _sse({"type": "delta", "text": ev.content})
                elif isinstance(ev, StreamDone):
                    break
        except Exception as e:
            log.exception("ai chat failed")
            yield _sse({"type": "error", "text": f"Error del asistente: {e}"})
        msg = ChatMessage(dataset_id=ds["id"], user_id=uid, role="assistant", content=text or "(sin respuesta)", analysis=result)
        await db.chat_messages.insert_one(msg.model_dump())
        yield _sse({"type": "done", "id": msg.id})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
