"""
AI service: language understanding + wording only.

The Node backend owns every business decision (product validation, quantity, price, discounts,
booking authorisation). This service can therefore never change a price, discount or booking:
  /nlu     -> extracts *hints* (product text, plan, count, intent flags) that the backend re-validates.
  /polish  -> rewords a backend-written reply; the backend rejects the result if any number/code changed.
If GEMINI_API_KEY is missing or Gemini fails, both endpoints answer {"available": false}
and the backend falls back to its deterministic logic.
"""
import json
import os
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

_client = None
if API_KEY:
    try:
        from google import genai

        _client = genai.Client(api_key=API_KEY)
    except Exception as exc:  # pragma: no cover
        print(f"[ai] Gemini client init failed: {exc}")

app = FastAPI(title="AI Sales Agent – language service")

NLU_SYSTEM = """You extract structured hints from ONE customer message sent to a sales assistant.
Return ONLY a JSON object with exactly these keys:
  "product_text": string|null   - the product the customer refers to, copied/normalised from their words (keep typos), null if none
  "plan": "STD"|"PRO"|"CARE"|null
  "count": {"value": integer, "unit_type": "capacity"|"units"}|null
        capacity = how many rooms/people to cover; units = number of physical units/packs/pairs
  "confirm": boolean            - true ONLY if the customer clearly agrees to book exactly what was last quoted
  "price_objection": boolean    - true ONLY if the customer complains about price or asks for a discount
  "cancel": boolean
Rules: never invent values that are not in the message. You do not know prices, discounts or stock. No prose."""

POLISH_SYSTEM = """You are a friendly, concise sales assistant. Rewrite the DRAFT reply so it sounds natural and warm.
STRICT RULES: keep every number, price, percentage, SKU, plan name and promo code EXACTLY as written; do not add, remove or
change any number or code; do not add offers, discounts, promises or new facts; keep bullet lines and the final question/call
to action; keep it about the same length. Output only the rewritten reply text."""


class NluRequest(BaseModel):
    message: str
    state: Optional[dict[str, Any]] = None
    history: list[dict[str, Any]] = []
    catalog: Optional[dict[str, Any]] = None


class PolishRequest(BaseModel):
    text: str
    user_message: str = ""
    history: list[dict[str, Any]] = []


@app.get("/health")
def health():
    return {"ok": True, "llm": bool(_client), "model": MODEL if _client else None}


def _generate(system: str, prompt: str, as_json: bool) -> Optional[str]:
    if not _client:
        return None
    try:
        cfg: dict[str, Any] = {"system_instruction": system, "temperature": 0.0 if as_json else 0.4}
        if as_json:
            cfg["response_mime_type"] = "application/json"
        resp = _client.models.generate_content(model=MODEL, contents=prompt, config=cfg)
        return (resp.text or "").strip()
    except Exception as exc:
        print(f"[ai] Gemini call failed: {exc}")
        return None


@app.post("/nlu")
def nlu(req: NluRequest):
    products = list((req.catalog or {}).keys())
    names = [v.get("name") for v in (req.catalog or {}).values()]
    prompt = (
        f"Catalog product names (for reference only): {names}\n"
        f"Conversation so far: {json.dumps(req.history[-6:])}\n"
        f"Current order state: {json.dumps(req.state)}\n"
        f"Customer message: {json.dumps(req.message)}"
    )
    raw = _generate(NLU_SYSTEM, prompt, as_json=True)
    if not raw:
        return {"available": False}
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("not an object")
        return {"available": True, "result": data}
    except Exception:
        return {"available": False}


@app.post("/polish")
def polish(req: PolishRequest):
    prompt = f"Customer said: {json.dumps(req.user_message)}\n\nDRAFT reply:\n{req.text}"
    out = _generate(POLISH_SYSTEM, prompt, as_json=False)
    return {"available": bool(out), "text": out}
