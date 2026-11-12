"""줄글 → 슬라이드 칸 채우기.

AI 공급자는 .env 로 고른다 (AI_PROVIDER = openai | anthropic | none).
설정이 없으면 규칙 기반(문장 나누기)으로 대신 채운다.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

TIMEOUT = float(os.getenv("AI_TIMEOUT", "300"))  # 로컬 모델(CPU)은 느리므로 넉넉히

STYLE_RULES = """\
너는 팀 프로젝트 멘토링 발표 자료를 정리하는 도우미다.
규칙:
- 한국어로만 쓴다 (한자·중국어 금지). 개조식으로 짧게 쓴다. 문장 끝은 '~함', '~완료', 명사형으로 끝낸다.
- 각 칸의 글자 수 제한(max)과 항목 수 제한(maxItems)을 반드시 지킨다.
- 원문에 없는 사실·숫자·이름·날짜를 지어내지 않는다. 모르면 빈 문자열로 둔다.
- 숫자는 원문에 나온 값을 그대로 쓴다. 추정하거나 새로 계산한 값을 넣지 않는다 (두 값의 차이는 허용).
- 차트 한 장에는 단위가 같은 값만 넣는다. 계열(series)은 비교 시점·대상(예: 기존, 개선)이다.
- 숫자·비교·순서가 있으면 표, 차트, 흐름 칸에 넣어 시각적으로 보이게 한다.
- 출력은 JSON 하나만. 설명, 코드블록 표시(```) 없이.
"""


def provider() -> str:
    p = os.getenv("AI_PROVIDER", "none").strip().lower()
    if p in ("openai", "anthropic") and os.getenv("AI_MODEL", "").strip():
        if p == "anthropic" and not os.getenv("AI_API_KEY", "").strip():
            return "none"
        return p
    return "none"


def status() -> dict[str, Any]:
    p = provider()
    return {"enabled": p != "none", "provider": p, "model": os.getenv("AI_MODEL", "") if p != "none" else ""}


# ---------------------------------------------------------------- LLM 호출

async def _call_llm(system: str, user: str) -> str:
    p = provider()
    model = os.getenv("AI_MODEL", "").strip()
    key = os.getenv("AI_API_KEY", "").strip()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        if p == "anthropic":
            base = os.getenv("AI_BASE_URL", "https://api.anthropic.com").rstrip("/")
            r = await client.post(
                f"{base}/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": model, "max_tokens": 4096, "system": system,
                      "messages": [{"role": "user", "content": user}]},
            )
            r.raise_for_status()
            data = r.json()
            return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        # openai 호환 (OpenAI, Ollama, vLLM, LM Studio 등)
        base = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        headers = {"content-type": "application/json"}
        if key:
            headers["authorization"] = f"Bearer {key}"
        body = {"model": model, "temperature": 0.2,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        # JSON 모드: 작은 로컬 모델도 형식이 깨지지 않게 강제 (지원 안 하는 서버면 끄고 재시도)
        if os.getenv("AI_JSON_MODE", "1") != "0":
            body["response_format"] = {"type": "json_object"}
        r = await client.post(f"{base}/chat/completions", headers=headers, json=body)
        if r.status_code in (400, 422) and "response_format" in body:
            body.pop("response_format")
            r = await client.post(f"{base}/chat/completions", headers=headers, json=body)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


_HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]+")


def _parse_json(text: str) -> Any:
    # 일부 다국어 모델이 섞어 쓰는 한자/중국어 단어를 제거
    text = _HAN.sub("", text).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"[\{\[].*[\}\]]", text, re.S)
        if not m:
            raise ValueError("AI 응답에서 JSON을 찾지 못했습니다.")
        return json.loads(m.group(0))


# ---------------------------------------------------------------- 프롬프트 조각
# 작은 로컬 모델은 '스키마 설명'보다 '빈 JSON 틀 채우기'를 훨씬 잘 따른다.

def _fields(fields: list[dict]) -> list[dict]:
    return [f for f in fields if f.get("type") != "image"]


def _skeleton(fields: list[dict]) -> dict:
    def blank(f):
        if f.get("type") == "select":
            return "|".join(f.get("options", []))
        return ""
    out: dict[str, Any] = {}
    for f in _fields(fields):
        t = f.get("type")
        if t == "list":
            out[f["key"]] = [""]
        elif t == "rows":
            out[f["key"]] = [{c["key"]: blank(c) for c in f.get("columns", [])}]
        else:
            out[f["key"]] = blank(f)
    return out


def _field_lines(fields: list[dict]) -> str:
    lines = []
    for f in _fields(fields):
        parts = [f.get("label", f["key"])]
        if f.get("max"):
            parts.append(f"최대 {f['max']}자")
        if f.get("maxItems"):
            parts.append(f"최대 {f['maxItems']}개")
        if f.get("options"):
            parts.append("다음 중 하나: " + "|".join(f["options"]))
        if f.get("hint"):
            parts.append(f["hint"])
        lines.append(f"- {f['key']}: " + ", ".join(parts))
        for c in f.get("columns", []):
            cp = [c.get("label", c["key"])]
            if c.get("max"):
                cp.append(f"최대 {c['max']}자")
            if c.get("type") == "number":
                cp.append("숫자만")
            if c.get("options"):
                cp.append("다음 중 하나: " + "|".join(c["options"]))
            if c.get("hint"):
                cp.append(c["hint"])
            lines.append(f"    - {c['key']}: " + ", ".join(cp))
    return "\n".join(lines)


FILL_RULES = (
    "아래 JSON 틀의 키를 그대로 두고 값만 채워라. 키 이름을 바꾸거나 새 키를 만들거나 한 단계 더 감싸지 마라.\n"
    "'a|b|c' 처럼 생긴 칸은 그 중 하나만 고른다. 배열 칸은 필요한 만큼 항목을 늘린다.\n"
    "원문에 해당 내용이 없으면 빈 문자열이나 빈 배열로 둔다."
)


# ---------------------------------------------------------------- 응답 정리·검증

def _align(obj: Any, fields: list[dict]) -> dict:
    """모델이 키를 라벨로 쓰거나 한 단계 감싸서 내놓아도 칸 키로 맞춘다."""
    keys = {f["key"] for f in fields}
    by_label = {f.get("label"): f["key"] for f in fields if f.get("label")}
    if not isinstance(obj, dict):
        return {}

    def score(d):
        return sum(1 for k in d if k in keys or k in by_label) if isinstance(d, dict) else 0

    # 감싸진 경우: 칸 키가 더 많이 보이는 안쪽 dict 를 고른다
    best = obj
    for v in obj.values():
        if isinstance(v, dict) and score(v) > score(best):
            best = v
    out = {}
    for k, v in best.items():
        k2 = k if k in keys else by_label.get(k)
        if k2 and k2 not in out:
            out[k2] = v
    return out


_NUM = re.compile(r"\d+(?:\.\d+)?")


def _nums(s: str) -> set[str]:
    return {str(float(x)) for x in _NUM.findall(s.replace(",", ""))}


def _unverified_numbers(values: Any, source: str) -> list[str]:
    """원문에 없는 숫자(두 숫자의 차이는 허용)를 찾아 경고용으로 돌려준다."""
    src = _nums(source)
    allowed = set(src)
    fl = [float(x) for x in src]
    for a in fl:
        for b in fl:
            allowed.add(str(round(abs(a - b), 2)))
            allowed.add(str(float(round(abs(a - b), 1))))
    found: list[str] = []

    def walk(v):
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif v is not None and not isinstance(v, bool):
            for n in _NUM.findall(str(v).replace(",", "")):
                if float(n) >= 10 or "." in n:  # 한 자리 정수(순번 등)는 건너뜀
                    if str(float(n)) not in allowed and n not in found:
                        found.append(n)

    walk(values)
    return found


def _num_warning(nums: list[str]) -> list[str]:
    if not nums:
        return []
    return [f"원문에 없는 숫자가 있어요: {', '.join(nums[:6])} — 맞는지 꼭 확인하세요."]


# ---------------------------------------------------------------- 공개 함수

async def fill(slide: dict, text: str) -> dict:
    """한 장의 슬라이드 칸을 채운다. slide = {id, name, desc, fields}"""
    if provider() == "none":
        return {"values": _rule_fill(slide["fields"], text), "mode": "rule", "warnings": []}
    user = (
        f"슬라이드: {slide['name']} — {slide.get('desc', '')}\n"
        f"칸 설명:\n{_field_lines(slide['fields'])}\n\n"
        f"{FILL_RULES}\n"
        f"틀:\n{json.dumps(_skeleton(slide['fields']), ensure_ascii=False)}\n\n"
        f"원문:\n{text}"
    )
    raw = await _call_llm(STYLE_RULES, user)
    values = _align(_parse_json(raw), _fields(slide["fields"]))
    return {"values": values, "mode": "ai", "warnings": _num_warning(_unverified_numbers(values, text))}


async def draft(catalog: list[dict], text: str, max_slides: int = 10) -> dict:
    """줄글 전체로 덱 초안을 만든다.
    1단계: 슬라이드 종류만 고른다 (짧은 목록이라 빠름)
    2단계: 고른 종류의 빈 틀만 주고 한 번에 채운다
    """
    if provider() == "none":
        return {"slides": _rule_draft(text), "mode": "rule", "warnings": []}
    cmap = {c["id"]: c for c in catalog}

    # 1단계: 구성
    menu = "\n".join(f"- {c['id']}: {c['name']} — {c.get('desc', '')}" for c in catalog)
    plan_user = (
        f"아래 원문으로 멘토링 발표 덱을 {max_slides}장 이하로 구성하라. 내용은 아직 쓰지 말고 슬라이드 종류만 고른다.\n"
        "- 첫 장은 cover. 마지막 쪽에 next_steps 나 discussion.\n"
        "- 원문에 숫자 비교가 있으면 kpi 나 chart, 대안 비교가 있으면 table, 순서가 있으면 flow 를 고른다.\n"
        "- bullets 는 꼭 필요할 때만. 같은 종류를 반복하지 않는다. 원문에 내용이 없는 종류는 고르지 않는다.\n"
        f"사용 가능한 종류:\n{menu}\n\n"
        "출력: {\"slides\": [{\"type\": \"<id>\", \"focus\": \"이 장에 담을 내용 한 줄\"}]}\n\n"
        f"원문:\n{text}"
    )
    plan = _parse_json(await _call_llm(STYLE_RULES, plan_user))
    items = plan.get("slides", []) if isinstance(plan, dict) else plan
    picked = [p for p in items if isinstance(p, dict) and p.get("type") in cmap][:max_slides]
    if not picked or picked[0]["type"] != "cover":
        picked = [{"type": "cover", "focus": "발표 제목"}] + [p for p in picked if p["type"] != "cover"]
        picked = picked[:max_slides]

    # 2단계: 채우기
    frame = {"slides": [{"type": p["type"], "focus": p.get("focus", ""), "values": _skeleton(cmap[p["type"]]["fields"])} for p in picked]}
    guide = "\n\n".join(f"[{i + 1}. {p['type']} — {cmap[p['type']]['name']}]\n{_field_lines(cmap[p['type']]['fields'])}" for i, p in enumerate(picked))
    fill_user = (
        f"각 슬라이드의 values 를 원문으로 채워라. focus 는 그 장에 담을 내용이다.\n{FILL_RULES}\n"
        "type, focus 는 그대로 둔다. 슬라이드 순서와 개수를 바꾸지 않는다.\n\n"
        f"칸 설명:\n{guide}\n\n"
        f"틀:\n{json.dumps(frame, ensure_ascii=False)}\n\n"
        f"원문:\n{text}"
    )
    data = _parse_json(await _call_llm(STYLE_RULES, fill_user))
    got = data.get("slides", []) if isinstance(data, dict) else data
    slides = []
    for i, p in enumerate(picked):
        raw = got[i] if i < len(got) and isinstance(got[i], dict) else {}
        vals = raw.get("values", raw)
        slides.append({"type": p["type"], "values": _align(vals, _fields(cmap[p["type"]]["fields"]))})
    return {"slides": slides, "mode": "ai", "warnings": _num_warning(_unverified_numbers([s["values"] for s in slides], text))}


# ---------------------------------------------------------------- 규칙 기반 대체

def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?。])\s+|\n+|(?<=다\.)|(?<=음\.)|(?<=함\.)", text)
    out = []
    for p in parts:
        p = re.sub(r"^\s*([-*•·▶▷○●]|\d+[.)])\s*", "", (p or "")).strip().rstrip(".")
        if p:
            out.append(p)
    return out


def _cut(s: str, n: int | None) -> str:
    if not n or len(s) <= n:
        return s
    return s[: max(1, n - 1)].rstrip() + "…"


def _rule_fill(fields: list[dict], text: str) -> dict:
    sents = _sentences(text)
    values: dict[str, Any] = {}
    i = 0
    for f in fields:
        t = f.get("type")
        if t in ("text", "textarea") and i < len(sents):
            values[f["key"]] = _cut(sents[i], f.get("max"))
            i += 1
        elif t == "list":
            n = f.get("maxItems", 5)
            values[f["key"]] = [_cut(s, f.get("max")) for s in sents[i:i + n]]
            i += len(values[f["key"]])
        elif t == "rows":
            n = f.get("maxItems", 5)
            col = next((c for c in f.get("columns", []) if c.get("type", "text") == "text"), None)
            if col:
                values[f["key"]] = [{col["key"]: _cut(s, col.get("max"))} for s in sents[i:i + n]]
                i += len(values[f["key"]])
    return values


def _rule_draft(text: str) -> list[dict]:
    sents = _sentences(text)
    if not sents:
        return []
    slides = [{"type": "cover", "values": {"title": _cut(sents[0], 40)}}]
    rest = sents[1:]
    if rest:
        slides.append({"type": "summary", "values": {
            "points": [{"head": _cut(s, 20), "detail": _cut(s, 70) if len(s) > 20 else ""} for s in rest[:3]]}})
    if len(rest) > 3:
        for k in range(3, len(rest), 5):
            slides.append({"type": "bullets", "values": {"items": [_cut(s, 45) for s in rest[k:k + 5]]}})
            if len(slides) >= 8:
                break
    slides.append({"type": "next_steps", "values": {}})
    return slides
