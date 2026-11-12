from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

from . import ai  # noqa: E402  (load_dotenv 이후에 import)

STATIC = ROOT / "static"
DECKS = ROOT / "decks"
DECKS.mkdir(exist_ok=True)

app = FastAPI(title="발표 표준화")


@app.middleware("http")
async def no_stale_static(request, call_next):
    """코드를 고친 뒤 브라우저가 옛 파일을 쓰지 않도록 매번 확인하게 한다."""
    resp = await call_next(request)
    if request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def _safe_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    if not name:
        raise HTTPException(400, "파일 이름이 비어 있습니다.")
    return name[:80]


# ---------------------------------------------------------------- 덱 저장/불러오기

@app.get("/api/decks")
def list_decks():
    items = []
    for p in sorted(DECKS.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            meta = json.loads(p.read_text(encoding="utf-8")).get("meta", {})
        except (json.JSONDecodeError, OSError):
            meta = {}
        items.append({
            "name": p.stem,
            "title": meta.get("title", ""),
            "presenter": meta.get("presenter", ""),
            "updated": datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
        })
    return items


@app.get("/api/decks/{name}")
def get_deck(name: str):
    p = DECKS / f"{_safe_name(name)}.json"
    if not p.exists():
        raise HTTPException(404, "덱을 찾지 못했습니다.")
    return json.loads(p.read_text(encoding="utf-8"))


@app.put("/api/decks/{name}")
def save_deck(name: str, deck: dict):
    p = DECKS / f"{_safe_name(name)}.json"
    p.write_text(json.dumps(deck, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True, "name": p.stem}


@app.delete("/api/decks/{name}")
def delete_deck(name: str):
    p = DECKS / f"{_safe_name(name)}.json"
    if p.exists():
        p.unlink()
    return {"ok": True}


# ---------------------------------------------------------------- AI

class FillReq(BaseModel):
    slide: dict
    text: str


class DraftReq(BaseModel):
    catalog: list[dict]
    text: str
    max_slides: int = 10


@app.get("/api/ai/status")
def ai_status():
    return ai.status()


async def _guard(coro):
    try:
        return await coro
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"AI 호출 실패 ({e.response.status_code}): {e.response.text[:300]}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"AI 서버에 연결하지 못했습니다: {e}")
    except (ValueError, KeyError) as e:
        raise HTTPException(502, f"AI 응답을 해석하지 못했습니다: {e}")


@app.post("/api/ai/fill")
async def ai_fill(req: FillReq):
    if not req.text.strip():
        raise HTTPException(400, "내용을 입력해 주세요.")
    return await _guard(ai.fill(req.slide, req.text))


@app.post("/api/ai/draft")
async def ai_draft(req: DraftReq):
    if not req.text.strip():
        raise HTTPException(400, "내용을 입력해 주세요.")
    return await _guard(ai.draft(req.catalog, req.text, req.max_slides))


# ---------------------------------------------------------------- 화면

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
