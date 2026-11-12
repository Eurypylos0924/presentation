// 양식 메모 ⇄ 덱 변환 (AI 없이, 쓴 그대로 들어감)
//
//   제목: 3팀 5차 멘토링          ← 맨 위: 덱 정보 (제목/발표자/날짜/회차)
//   발표자: 홍길동
//
//   # 표지: 검색 기능 2차 개선     ← '# 종류: 슬라이드 제목' 으로 새 슬라이드 시작
//   부제: 응답 시간 2.4초 → 0.9초  ← '칸 이름: 값'
//
//   # KPI: 이번 주 지표
//   - 정답률 | 86 | % | +15%p | 좋아짐   ← 표 형태 칸은 '|' 로 열 구분
//
//   # 진행 현황
//   완료:                          ← 목록 칸이 여러 개면 '칸 이름:' 으로 구분
//   - 요구사항 정의
import { SLIDE_TYPES, TYPE_MAP, defaults, sanitize } from "./slides.js";

const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s·+→()\-_/,.:]/g, "");
export const shortLabel = (label) => String(label).replace(/\s*[(/].*$/, "").trim();
const isCollection = (f) => f.type === "list" || f.type === "rows";

// ------------------------------------------------------------ 종류 이름 → id
const EXTRA_ALIASES = {
  cover: ["표지", "제목"],
  agenda: ["목차", "순서"],
  section: ["구간", "섹션", "간지"],
  summary: ["요약", "핵심", "핵심요약", "결론"],
  bullets: ["목록", "개조식", "리스트"],
  kpi: ["지표", "숫자", "숫자강조"],
  progress: ["칸반", "진행", "진행현황", "현황"],
  timeline: ["일정", "타임라인", "마일스톤"],
  issues: ["이슈", "리스크", "위험", "문제점"],
  chart: ["차트", "그래프"],
  table: ["비교", "표", "비교표"],
  before_after: ["전후", "전후비교", "비포애프터"],
  flow: ["흐름", "흐름도", "파이프라인", "프로세스", "단계"],
  layers: ["구조", "계층", "구조도", "아키텍처"],
  problem_solution: ["문제해결", "문제", "원인해결"],
  image: ["이미지", "사진", "스크린샷"],
  discussion: ["질문", "멘토질문", "결정요청", "논의"],
  next_steps: ["할일", "다음할일", "todo", "계획"],
  end: ["마무리", "감사", "qna", "끝"],
  feedback: ["피드백", "피드백반영", "반영표"],
  kpt: ["회고", "kpt"],
  big_number: ["큰숫자", "숫자하나", "빅넘버"],
  matrix: ["매트릭스", "2x2", "우선순위"],
  concept: ["개념", "개념카드", "정의"],
  compare_concepts: ["vs", "개념비교", "avsb"],
  how_it_works: ["원리", "동작원리", "작동원리"],
  code: ["코드", "코드설명"],
  paper: ["논문", "자료요약", "논문요약", "리뷰"],
  learned: ["배운점", "적용", "배운점적용"],
  glossary: ["용어", "용어정리"],
};

const ALIAS = new Map();
for (const t of SLIDE_TYPES) {
  for (const a of [t.id, t.name, shortLabel(t.name), ...(t.name.match(/\(([^)]+)\)/)?.slice(1) || []), ...(EXTRA_ALIASES[t.id] || [])]) {
    const k = norm(a);
    if (k && !ALIAS.has(k)) ALIAS.set(k, t.id);
  }
}
export const typeFromName = (s) => ALIAS.get(norm(s)) || null;

// ------------------------------------------------------------ 칸 이름 → 필드
function fieldFinder(t) {
  const m = new Map();
  for (const f of t.fields) {
    for (const a of [f.key, f.label, shortLabel(f.label), ...(f.aliases || [])]) {
      const k = norm(a);
      if (k && !m.has(k)) m.set(k, f);
    }
  }
  return (s) => {
    const k = norm(s);
    if (!k) return null;
    if (m.has(k)) return m.get(k);
    // 줄여 쓴 이름 ('해석' → '한 줄 해석', '종류' → '차트 종류'): 하나로 정해질 때만
    const hits = t.fields.filter((f) => {
      const L = norm(shortLabel(f.label));
      return L.includes(k) || (k.length >= 2 && k.includes(L));
    });
    return hits.length === 1 ? hits[0] : null;
  };
}

const META_KEYS = { 제목: "title", 덱제목: "title", 발표자: "presenter", 날짜: "date", 회차: "session", 색상: "theme" };

// ------------------------------------------------------------ 메모 → 덱
export function fromMemo(text) {
  const meta = {};
  const slides = [];
  const warnings = [];
  let cur = null; // { type, t, find, values, target, line, full }
  let skipping = false; // 없는 종류의 슬라이드 내용은 건너뜀
  let codeBuf = null; // ``` 블록 안의 줄들
  let codeField = null;
  let codeStart = 0;
  const closeCode = () => {
    if (cur && codeField) cur.values[codeField.key] = codeBuf.join("\n");
    codeBuf = null;
    codeField = null;
  };

  const finish = () => {
    if (!cur) return;
    const clean = sanitize(cur.type, cur.values);
    slides.push({ type: cur.type, values: { ...defaults(cur.type), ...clean }, line: cur.line });
    cur = null;
  };

  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    // 코드 블록 안: 들여쓰기 그대로, 닫는 ``` 까지
    if (codeBuf) {
      if (raw.trim().startsWith("```")) closeCode();
      else codeBuf.push(raw.replace(/\s+$/, ""));
      return;
    }
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    if (line.startsWith("```") && !skipping) {
      codeField = cur?.t.fields.find((f) => f.type === "code") || null;
      if (!codeField) warnings.push(`${ln}줄: ${cur ? cur.t.name : "슬라이드 밖"}에는 코드 칸이 없어 코드 블록을 무시했어요.`);
      codeBuf = [];
      codeStart = ln;
      return;
    }

    // 새 슬라이드: '# 종류' 또는 '# 종류: 제목'
    const h = line.match(/^#(?!#)\s*([^:：]+?)\s*(?:[:：]\s*(.*))?$/);
    if (h) {
      finish();
      const type = typeFromName(h[1]);
      if (!type) {
        warnings.push(`${ln}줄: '${h[1]}'은(는) 없는 슬라이드 종류예요. (이 슬라이드는 건너뜀)`);
        cur = null;
        skipping = true;
        return;
      }
      skipping = false;
      const t = TYPE_MAP[type];
      cur = { type, t, find: fieldFinder(t), values: {}, target: t.fields.find(isCollection) || null, line: ln };
      if (h[2]) {
        // 제목 칸이 없는 종류(숫자 하나 크게 등)는 첫 글 칸에 넣는다
        const tf = t.fields.find((f) => f.key === "title") || t.fields.find((f) => f.type === "text");
        if (tf) cur.values[tf.key] = h[2].trim();
      }
      return;
    }
    if (skipping) return;

    // 슬라이드 시작 전: 덱 정보
    if (!cur) {
      const kv = line.match(/^([^:：]+)[:：]\s*(.*)$/);
      const key = kv && META_KEYS[norm(kv[1])];
      if (key) meta[key] = kv[2].trim();
      else warnings.push(`${ln}줄: 슬라이드 밖의 내용이라 무시했어요. '# 종류'로 슬라이드를 먼저 시작하세요.`);
      return;
    }

    // '## 칸 이름' 또는 '칸 이름:' (값 없음) → 이후 목록이 들어갈 칸
    const sec = line.match(/^##\s*(.+)$/) || line.match(/^([^:：|]+)[:：]\s*$/);
    if (sec) {
      // 이름이 사용자 값인 목록 (전후 비교의 '기존:' / '개선:' 등)
      const named = cur.t.fields.filter((f) => f.labelFrom);
      const byValue = named.find((f) => norm(cur.values[f.labelFrom] ?? defaults(cur.type)[f.labelFrom]) === norm(sec[1]));
      if (byValue) { cur.target = byValue; return; }
      const fnd = cur.find(sec[1]);
      if (!fnd && named.length) {
        const free = named.find((f) => !(cur.values[f.key] || []).length);
        if (free) { cur.values[free.labelFrom] = sec[1].trim(); cur.target = free; return; }
      }
      const f = fnd;
      if (f && isCollection(f)) { cur.target = f; return; }
      if (line.startsWith("##")) { warnings.push(`${ln}줄: '${sec[1]}'은(는) ${cur.t.name}에 없는 칸이에요.`); return; }
    }

    // '- 항목' → 현재 목록 칸
    const b = line.match(/^(?:[-*•·]|\d+[.)])\s*(.*)$/);
    if (b) {
      addItem(cur, b[1], ln, warnings);
      return;
    }

    // '칸 이름: 값'
    const kv = line.match(/^([^:：|]+?)\s*[:：]\s*(.+)$/);
    if (kv) {
      const f = cur.find(kv[1]);
      if (f && !isCollection(f) && f.type !== "image") { cur.values[f.key] = kv[2].trim(); return; }
      if (f && isCollection(f)) {
        // '완료: A, B' 처럼 한 줄에 쓴 목록
        cur.target = f;
        for (const part of kv[2].split(f.type === "rows" ? /\s*;\s*/ : /\s*[,，]\s*/)) if (part) addItem(cur, part, ln, warnings);
        return;
      }
    }

    // 그 밖의 문장 → 목록 칸이 있으면 항목으로, 없으면 빈 글 칸으로
    if (cur.target) { addItem(cur, line, ln, warnings); return; }
    const empty = cur.t.fields.find((f) => (f.type === "text" || f.type === "textarea") && !cur.values[f.key]);
    if (empty) cur.values[empty.key] = line;
    else warnings.push(`${ln}줄: 넣을 칸이 없어 무시했어요.`);
  });
  if (codeBuf) {
    warnings.push(`${codeStart}줄: 코드 블록을 닫는 \`\`\` 가 없어요. 끝까지를 코드로 넣었어요.`);
    closeCode();
  }
  finish();
  return { meta, slides, warnings };
}

function addItem(cur, text, ln, warnings) {
  const f = cur.target;
  if (!f) { warnings.push(`${ln}줄: ${cur.t.name}에는 목록 칸이 없어요.`); return; }
  const arr = (cur.values[f.key] ||= []);
  if (arr.length >= (f.maxItems || 99)) {
    cur.full ||= new Set();
    if (!cur.full.has(f.key)) {
      cur.full.add(f.key);
      warnings.push(`${ln}줄: '${shortLabel(f.label)}'은(는) 최대 ${f.maxItems}개라 넘는 항목은 뺐어요.`);
    }
    return;
  }
  if (f.type === "list") { arr.push(text.trim()); return; }
  const cells = text.split("|").map((x) => x.trim());
  const row = {};
  f.columns.forEach((c, i) => { row[c.key] = cells[i] ?? ""; });
  if (cells.length > f.columns.length) warnings.push(`${ln}줄: 열이 ${f.columns.length}개인데 ${cells.length}개를 썼어요. 넘는 열은 뺐어요.`);
  arr.push(row);
}

// ------------------------------------------------------------ 덱 → 메모
export function slideToMemo(slide) {
  const t = TYPE_MAP[slide.type];
  const v = slide.values || {};
  const name = shortLabel(t.name);
  const out = [];
  const headF = t.fields.find((f) => f.key === "title") || t.fields.find((f) => f.type === "text");
  out.push(`# ${name}${headF && v[headF.key] ? `: ${v[headF.key]}` : ""}`);
  const cols = t.fields.filter(isCollection);
  const labelKeys = new Set(t.fields.map((f) => f.labelFrom).filter(Boolean));
  for (const f of t.fields) {
    if (f === headF || f.type === "image" || labelKeys.has(f.key)) continue;
    const x = v[f.key];
    if (f.type === "code") {
      if (x) out.push("```", ...String(x).split("\n"), "```");
      continue;
    }
    if (isCollection(f)) {
      const items = (x || []).filter((it) => (typeof it === "object" ? Object.values(it).some((y) => String(y ?? "").trim()) : String(it ?? "").trim()));
      const head = f.labelFrom ? (v[f.labelFrom] || defaults(slide.type)[f.labelFrom] || shortLabel(f.label)) : shortLabel(f.label);
      if (cols.length > 1 || f !== cols[0]) out.push(`${head}:`);
      for (const it of items) {
        if (f.type === "list") out.push(`- ${it}`);
        else {
          const cells = f.columns.map((c) => String(it[c.key] ?? "").trim());
          while (cells.length > 1 && !cells[cells.length - 1]) cells.pop();
          out.push(`- ${cells.join(" | ")}`);
        }
      }
    } else if (x != null && String(x).trim() && x !== f.default) {
      out.push(`${shortLabel(f.label)}: ${x}`);
    }
  }
  return out.join("\n");
}

export function toMemo(deck) {
  const m = deck.meta || {};
  const head = [
    m.title && `제목: ${m.title}`,
    m.presenter && `발표자: ${m.presenter}`,
    m.date && `날짜: ${m.date}`,
    m.session && `회차: ${m.session}`,
  ].filter(Boolean);
  return [head.join("\n"), ...deck.slides.map(slideToMemo)].filter(Boolean).join("\n\n") + "\n";
}

/** 템플릿별 칸 안내 (도움말용) */
export function formatHelp(t) {
  const cols = t.fields.filter(isCollection);
  const labelKeys = new Set(t.fields.map((f) => f.labelFrom).filter(Boolean));
  const d = defaults(t.id);
  return t.fields
    .filter((f) => f.key !== "title" && f.type !== "image" && !labelKeys.has(f.key))
    .map((f) => {
      if (f.type === "code") return "``` 다음 줄부터 코드, ``` 로 닫기";
      const nm = f.labelFrom ? `${d[f.labelFrom]}(이름 바꿔도 됨)` : shortLabel(f.label);
      if (f.type === "rows") return `${cols.length > 1 || f !== cols[0] ? `${nm}: 아래에 ` : ""}- ${f.columns.map((c) => shortLabel(c.label)).join(" | ")}${f.maxItems ? ` (최대 ${f.maxItems}줄)` : ""}`;
      if (f.type === "list") return `${cols.length > 1 || f !== cols[0] ? `${nm}: 아래에 ` : ""}- 항목${f.maxItems ? ` (최대 ${f.maxItems}개)` : ""}`;
      if (f.type === "select") return `${nm}: ${f.options.join(" / ")}`;
      return `${nm}: …`;
    });
}
