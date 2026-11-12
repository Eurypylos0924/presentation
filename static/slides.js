// 슬라이드 템플릿 레지스트리
// 각 템플릿 = { id, name, category, desc, visual, fields, sample, render(v, ctx) }
// 필드 타입: text | textarea | select | number | list | rows | image
import { esc, num, splitComma } from "./util.js";
import { chartSVG } from "./charts.js";

export const CATEGORIES = [
  { id: "basic", name: "기본" },
  { id: "status", name: "진행 현황" },
  { id: "analysis", name: "결과·분석" },
  { id: "explain", name: "구조·설명" },
  { id: "study", name: "학습·공유" },
  { id: "discuss", name: "논의·마무리" },
];

// 채도를 낮춘 차분한 톤 (오래 봐도 눈이 덜 피로하게). 글자로 쓰는 accent 는 흰 바탕 대비 4.5:1 이상.
export const THEMES = {
  blue: { name: "차분한 블루", accent: "#4A6A9C", soft: "#EEF1F6", c2: "#B3BCC8", c3: "#D2A56E" },
  green: { name: "세이지", accent: "#4D7A65", soft: "#EDF2EF", c2: "#B4BDB8", c3: "#C99A72" },
  purple: { name: "라벤더", accent: "#6B6399", soft: "#F0EFF5", c2: "#B8B5C4", c3: "#CFA571" },
  slate: { name: "차콜", accent: "#4A505B", soft: "#F0F1F2", c2: "#8DA3BF", c3: "#C9A27A" },
  sand: { name: "샌드", accent: "#8C6448", soft: "#F5F0EB", c2: "#BEB5AC", c3: "#7D97AD" },
};

const C_OK = "#5E8F72", C_BAD = "#B9675E", C_MID = "#C29A52", C_OFF = "#A4AAB3";
const STATUS_COLOR = { 완료: C_OK, 진행중: "var(--accent)", 예정: C_OFF, 지연: C_BAD };
const IMPACT_COLOR = { 높음: C_BAD, 중간: C_MID, 낮음: C_OK };
const FEEDBACK_COLOR = { 반영완료: C_OK, 진행중: "var(--accent)", 보류: C_OFF };

const T = (key = "title", label = "슬라이드 제목", max = 34, extra = {}) => ({ key, label, type: "text", max, ...extra });

// ------------------------------------------------------------------ 공통 조각
const title = (v, fallback = "") => {
  const t = v.title || fallback;
  return t ? `<h2 class="s-title">${esc(t)}</h2>` : "";
};
const kicker = (ctx) => `<div class="s-kicker">${esc(ctx.kicker || "")}</div>`;
const list = (items, cls = "s-bullets") =>
  (items || []).filter(Boolean).length
    ? `<ul class="${cls}">${items.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
    : "";
const rows = (r) => (r || []).filter((x) => x && Object.values(x).some((y) => String(y ?? "").trim()));
const arrow = `<div class="s-arrow"><svg width="40" height="40" viewBox="0 0 40 40"><path d="M8 20h22m-8-9 9 9-9 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;

// ------------------------------------------------------------------ 템플릿
export const SLIDE_TYPES = [
  // ============ 기본
  {
    id: "cover",
    name: "표지",
    category: "basic",
    desc: "발표 제목, 부제, 발표자·날짜·회차",
    fields: [T("title", "발표 제목", 40), T("subtitle", "부제 / 한 줄 요약", 60)],
    sample: { title: "검색 기능 2차 개선 결과", subtitle: "응답 시간 2.4초 → 0.9초, 정답률 71% → 86%" },
    render: (v, ctx) => `
      <div class="s-cover">
        <div class="s-cover-bar"></div>
        <div class="s-cover-session">${esc(ctx.meta.session || "")}</div>
        <h1>${esc(v.title || "발표 제목")}</h1>
        ${v.subtitle ? `<p class="s-cover-sub">${esc(v.subtitle)}</p>` : ""}
        <div class="s-cover-meta">${[ctx.meta.presenter, ctx.meta.date].filter(Boolean).map(esc).join("<span>·</span>")}</div>
      </div>`,
  },
  {
    id: "agenda",
    name: "목차",
    category: "basic",
    desc: "오늘 발표 순서 (최대 6개)",
    fields: [T("title", "제목", 20, { default: "목차" }), { key: "items", label: "순서", type: "list", max: 28, maxItems: 6 }],
    sample: { title: "목차", items: ["지난 멘토링 피드백 반영", "실험 결과", "이슈와 원인", "다음 주 계획", "질문"] },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "목차")}
      <ol class="s-agenda">${(v.items || []).filter(Boolean).map((x, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${esc(x)}</li>`).join("")}</ol>`,
  },
  {
    id: "section",
    name: "구간 표지",
    category: "basic",
    desc: "큰 주제가 바뀔 때 넣는 구분 페이지",
    fields: [T("number", "번호", 4), T("title", "구간 제목", 30), T("subtitle", "설명", 50)],
    sample: { number: "02", title: "개선 결과", subtitle: "1차 대비 2차 성능 비교" },
    render: (v) => `
      <div class="s-section">
        <div class="s-section-num">${esc(v.number || "")}</div>
        <h1>${esc(v.title || "")}</h1>
        ${v.subtitle ? `<p>${esc(v.subtitle)}</p>` : ""}
      </div>`,
  },
  {
    id: "summary",
    name: "핵심 요약 3줄",
    category: "basic",
    visual: true,
    desc: "오늘 꼭 전달할 메시지 3개 — 결론부터",
    fields: [
      T("title", "제목", 30, { default: "오늘의 핵심" }),
      { key: "points", label: "핵심 메시지", type: "rows", maxItems: 3, columns: [{ key: "head", label: "한 줄 결론", max: 20 }, { key: "detail", label: "근거 / 설명", max: 70 }] },
    ],
    sample: {
      title: "오늘의 핵심",
      points: [
        { head: "응답 시간 1초 이내", detail: "캐시 적용 후 평균 응답 시간이 2.4초에서 0.9초로 줄어듦" },
        { head: "정답률 86% 달성", detail: "질문 유형을 나눠 처리하면서 엉뚱한 답이 크게 줄어듦" },
        { head: "결정 필요: 범위", detail: "다음 스프린트에 기능 추가와 안정화 중 무엇을 먼저 할지 결정 필요" },
      ],
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "오늘의 핵심")}
      <div class="s-cards s-cards-${Math.max(1, rows(v.points).length)}">
        ${rows(v.points).map((p, i) => `<div class="s-card"><div class="s-card-num">${i + 1}</div><h3>${esc(p.head)}</h3><p>${esc(p.detail)}</p></div>`).join("")}
      </div>`,
  },
  {
    id: "bullets",
    name: "개조식 목록",
    category: "basic",
    desc: "짧은 항목 나열 (최대 5개, 항목당 45자) — 줄글 대신",
    fields: [T(), { key: "items", label: "항목", type: "list", max: 45, maxItems: 5 }, T("callout", "강조 문구 (선택)", 50)],
    sample: { title: "이번 주 변경 사항", items: ["검색 결과 캐시 추가", "질문 유형별 처리 분기", "평가용 질문 100개 세트 구축"], callout: "같은 질문 세트로 매주 성능을 비교할 수 있게 됨" },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v)}
      ${list(v.items)}
      ${v.callout ? `<div class="s-callout">${esc(v.callout)}</div>` : ""}`,
  },

  // ============ 진행 현황
  {
    id: "kpi",
    name: "숫자 강조 (KPI)",
    category: "status",
    visual: true,
    desc: "핵심 지표를 큰 숫자로 (최대 4개)",
    fields: [
      T(),
      {
        key: "metrics", label: "지표", type: "rows", maxItems: 4,
        columns: [
          { key: "label", label: "지표 이름", max: 14 },
          { key: "value", label: "값", max: 8, hint: "현재 값 숫자만 (단위 제외)" },
          { key: "unit", label: "단위", max: 5 },
          { key: "delta", label: "변화 (예: +17%p)", max: 14 },
          { key: "trend", label: "방향", type: "select", options: ["좋아짐", "나빠짐", "변화없음"] },
        ],
      },
      T("note", "한 줄 해석", 70),
    ],
    sample: {
      title: "이번 주 성능 지표",
      metrics: [
        { label: "정답률", value: "86", unit: "%", delta: "+15%p", trend: "좋아짐" },
        { label: "응답 시간", value: "0.9", unit: "초", delta: "-1.5초", trend: "좋아짐" },
        { label: "오류율", value: "4", unit: "%", delta: "+1%p", trend: "나빠짐" },
      ],
      note: "속도와 정확도는 좋아졌고, 오류율은 소폭 증가",
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v)}
      <div class="s-kpis s-kpis-${Math.max(1, rows(v.metrics).length)}">
        ${rows(v.metrics).map((m) => {
          const t = m.trend === "좋아짐" ? "up" : m.trend === "나빠짐" ? "down" : "flat";
          return `<div class="s-kpi"><div class="s-kpi-label">${esc(m.label)}</div>
            <div class="s-kpi-value">${esc(m.value)}<small>${esc(m.unit)}</small></div>
            ${m.delta ? `<div class="s-kpi-delta ${t}">${t === "up" ? "▲" : t === "down" ? "▼" : "–"} ${esc(m.delta)}</div>` : ""}</div>`;
        }).join("")}
      </div>
      ${v.note ? `<div class="s-callout">${esc(v.note)}</div>` : ""}`,
  },
  {
    id: "progress",
    name: "진행 현황 (칸반)",
    category: "status",
    visual: true,
    desc: "완료 / 진행 중 / 예정 + 전체 진척률",
    fields: [
      T("title", "제목", 30, { default: "진행 현황" }),
      { key: "percent", label: "전체 진척률 (%)", type: "number" },
      { key: "done", label: "완료", type: "list", max: 26, maxItems: 5 },
      { key: "doing", label: "진행 중", type: "list", max: 26, maxItems: 5 },
      { key: "todo", label: "예정", type: "list", max: 26, maxItems: 5 },
    ],
    sample: { title: "진행 현황", percent: "55", done: ["요구사항 정의", "화면 설계", "검색 기능 1차"], doing: ["검색 성능 개선", "로그인 연동"], todo: ["사용자 테스트", "배포 준비"] },
    render: (v, ctx) => {
      const p = Math.min(100, Math.max(0, num(v.percent)));
      const col = (name, cls, items) => `<div class="s-kcol ${cls}"><div class="s-kcol-head">${name}<b>${(items || []).filter(Boolean).length}</b></div>${(items || []).filter(Boolean).map((x) => `<div class="s-kitem">${esc(x)}</div>`).join("")}</div>`;
      return `${kicker(ctx)}${title(v, "진행 현황")}
        ${isFinite(p) ? `<div class="s-pbar"><div style="width:${p}%"></div><span>${p}%</span></div>` : ""}
        <div class="s-kanban">${col("완료", "done", v.done)}${col("진행 중", "doing", v.doing)}${col("예정", "todo", v.todo)}</div>`;
    },
  },
  {
    id: "timeline",
    name: "일정 타임라인",
    category: "status",
    visual: true,
    desc: "마일스톤과 상태 (최대 6개)",
    fields: [
      T("title", "제목", 30, { default: "일정" }),
      { key: "items", label: "마일스톤", type: "rows", maxItems: 6, columns: [{ key: "date", label: "날짜", max: 10 }, { key: "name", label: "내용", max: 22 }, { key: "status", label: "상태", type: "select", options: ["완료", "진행중", "예정", "지연"] }] },
    ],
    sample: {
      title: "전체 일정",
      items: [
        { date: "11/03", name: "주제 확정", status: "완료" },
        { date: "11/10", name: "데이터 검수", status: "완료" },
        { date: "11/17", name: "모델 1차", status: "진행중" },
        { date: "11/24", name: "화면 연동", status: "예정" },
        { date: "12/01", name: "중간 발표", status: "예정" },
      ],
    },
    render: (v, ctx) => {
      const it = rows(v.items);
      return `${kicker(ctx)}${title(v, "일정")}
        <div class="s-timeline">
          <div class="s-tl-line"></div>
          ${it.map((x) => `<div class="s-tl-item"><div class="s-tl-date">${esc(x.date)}</div><div class="s-tl-dot" style="--c:${STATUS_COLOR[x.status] || STATUS_COLOR.예정}"></div><div class="s-tl-name">${esc(x.name)}</div><div class="s-tl-status" style="--c:${STATUS_COLOR[x.status] || STATUS_COLOR.예정}">${esc(x.status || "")}</div></div>`).join("")}
        </div>
        <div class="s-tl-legend">${Object.entries(STATUS_COLOR).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}</div>`;
    },
  },
  {
    id: "issues",
    name: "이슈·리스크",
    category: "status",
    visual: true,
    desc: "문제, 영향도, 대응, 담당 (최대 5개)",
    fields: [
      T("title", "제목", 30, { default: "이슈 및 리스크" }),
      {
        key: "items", label: "이슈", type: "rows", maxItems: 5,
        columns: [{ key: "issue", label: "이슈", max: 28 }, { key: "impact", label: "영향", type: "select", options: ["높음", "중간", "낮음"] }, { key: "action", label: "대응", max: 36 }, { key: "owner", label: "담당", max: 6 }],
      },
    ],
    sample: {
      title: "이슈 및 리스크",
      items: [
        { issue: "평가 데이터가 부족함", impact: "높음", action: "팀원별 질문 20개씩 추가 수집", owner: "김OO" },
        { issue: "외부 API 호출 제한", impact: "중간", action: "결과 캐시, 호출 횟수 모니터링", owner: "이OO" },
        { issue: "회의록 정리 지연", impact: "낮음", action: "회의 직후 10분 정리 규칙", owner: "박OO" },
      ],
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "이슈 및 리스크")}
      <table class="s-table s-issues"><thead><tr><th>이슈</th><th style="width:120px">영향</th><th>대응</th><th style="width:120px">담당</th></tr></thead>
      <tbody>${rows(v.items).map((r) => `<tr><td><b>${esc(r.issue)}</b></td><td>${r.impact ? `<span class="s-pill" style="--c:${IMPACT_COLOR[r.impact]}">${esc(r.impact)}</span>` : ""}</td><td>${esc(r.action)}</td><td>${esc(r.owner)}</td></tr>`).join("")}</tbody></table>`,
  },

  // ============ 결과·분석
  {
    id: "chart",
    name: "차트 + 해석",
    category: "analysis",
    visual: true,
    desc: "막대/선/원형 차트와 핵심 해석",
    fields: [
      T(),
      { key: "kind", label: "차트 종류", type: "select", options: ["막대", "선", "원형"], default: "막대" },
      T("series", "계열 이름 (쉼표로 구분, 최대 3개)", 40, { hint: "예: 기존, 개선" }),
      T("unit", "단위", 8),
      {
        key: "data", label: "데이터", type: "rows", maxItems: 8,
        columns: [{ key: "label", label: "항목", max: 10, hint: "x축 이름" }, { key: "v1", label: "값1", type: "number", hint: "첫 번째 계열 값" }, { key: "v2", label: "값2", type: "number", hint: "두 번째 계열 값" }, { key: "v3", label: "값3", type: "number", hint: "세 번째 계열 값" }],
      },
      T("takeaway", "핵심 해석 (결론 한 줄)", 50),
      { key: "points", label: "근거 (선택)", type: "list", max: 34, maxItems: 3 },
    ],
    sample: {
      title: "질문 유형별 정답률",
      kind: "막대",
      series: "1차, 2차",
      unit: "%",
      data: [
        { label: "단순 조회", v1: "85", v2: "94" },
        { label: "비교", v1: "70", v2: "88" },
        { label: "요약", v1: "62", v2: "83" },
        { label: "복합 질문", v1: "41", v2: "72" },
      ],
      takeaway: "복합 질문에서 개선 폭이 가장 큼 (+31%p)",
      points: ["질문 유형 분기 효과가 어려운 질문에 집중", "복합 질문은 아직 목표(80%) 미달"],
    },
    render: (v, ctx) => {
      const names = splitComma(v.series);
      const d = rows(v.data);
      const series = [0, 1, 2].map((i) => ({ name: names[i] || `값${i + 1}`, values: d.map((r) => num(r[`v${i + 1}`])) })).filter((s, i) => i === 0 || names[i] || s.values.some(isFinite));
      const kind = { 막대: "bar", 선: "line", 원형: "pie" }[v.kind] || "bar";
      const svg = chartSVG({ kind, labels: d.map((r) => r.label || ""), series, unit: v.unit, colors: [ctx.theme.accent, ctx.theme.c2, ctx.theme.c3] });
      const side = v.takeaway || (v.points || []).filter(Boolean).length;
      return `${kicker(ctx)}${title(v)}
        <div class="s-chart ${side ? "" : "s-chart-full"}"><div class="s-chart-svg">${svg}</div>
        ${side ? `<div class="s-chart-side">${v.takeaway ? `<div class="s-takeaway"><span>핵심</span>${esc(v.takeaway)}</div>` : ""}${list(v.points, "s-bullets small")}</div>` : ""}</div>`;
    },
  },
  {
    id: "table",
    name: "비교표",
    category: "analysis",
    visual: true,
    desc: "대안·모델 비교, 추천안 강조",
    fields: [
      T(),
      T("columns", "비교 대상 (쉼표로 구분, 최대 4개)", 50, { hint: "예: A안, B안, C안" }),
      {
        key: "rows", label: "비교 기준", type: "rows", maxItems: 6,
        columns: [{ key: "criterion", label: "기준", max: 12 }, { key: "c1", label: "대상1", max: 18 }, { key: "c2", label: "대상2", max: 18 }, { key: "c3", label: "대상3", max: 18 }, { key: "c4", label: "대상4", max: 18 }],
      },
      T("recommend", "추천 대상 (이름 그대로)", 20),
      T("conclusion", "결론", 60),
    ],
    sample: {
      title: "데이터베이스 후보 비교",
      columns: "A안, B안, C안",
      rows: [
        { criterion: "검색 속도", c1: "보통", c2: "빠름", c3: "매우 빠름" },
        { criterion: "월 비용", c1: "무료", c2: "무료", c3: "유료" },
        { criterion: "학습 난이도", c1: "낮음", c2: "낮음", c3: "높음" },
        { criterion: "팀 경험", c1: "있음", c2: "있음", c3: "없음" },
      ],
      recommend: "B안",
      conclusion: "속도는 충분하고 비용·난이도가 낮음 → B안 채택",
    },
    render: (v, ctx) => {
      const cols = splitComma(v.columns).slice(0, 4);
      const rec = (v.recommend || "").trim();
      return `${kicker(ctx)}${title(v)}
        <table class="s-table s-compare"><thead><tr><th></th>${cols.map((c) => `<th class="${c === rec ? "rec" : ""}">${esc(c)}${c === rec ? `<em>추천</em>` : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows(v.rows).map((r) => `<tr><th>${esc(r.criterion)}</th>${cols.map((c, i) => `<td class="${c === rec ? "rec" : ""}">${esc(r[`c${i + 1}`])}</td>`).join("")}</tr>`).join("")}</tbody></table>
        ${v.conclusion ? `<div class="s-callout">${esc(v.conclusion)}</div>` : ""}`;
    },
  },
  {
    id: "before_after",
    name: "전후 비교",
    category: "analysis",
    visual: true,
    desc: "바꾸기 전과 후를 나란히",
    fields: [
      T(),
      T("beforeLabel", "왼쪽 이름", 10, { default: "기존" }),
      { key: "before", label: "왼쪽 내용", type: "list", max: 30, maxItems: 4, labelFrom: "beforeLabel", aliases: ["전", "before", "왼쪽"] },
      T("afterLabel", "오른쪽 이름", 10, { default: "개선" }),
      { key: "after", label: "오른쪽 내용", type: "list", max: 30, maxItems: 4, labelFrom: "afterLabel", aliases: ["후", "after", "오른쪽"] },
      T("metric", "변화 수치 (예: 72% → 89%)", 24),
    ],
    sample: {
      title: "평가 방식 변경",
      beforeLabel: "기존",
      before: ["팀원이 직접 몇 개 질문해 봄", "매번 다른 질문으로 확인", "좋아졌는지 판단이 어려움"],
      afterLabel: "개선",
      after: ["고정 질문 100개 세트", "매주 같은 세트로 자동 채점", "변화를 숫자로 비교 가능"],
      metric: "평가 시간 2시간 → 10분",
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v)}
      <div class="s-ba">
        <div class="s-ba-col before"><div class="s-ba-head">${esc(v.beforeLabel || "기존")}</div>${list(v.before)}</div>
        <div class="s-ba-mid">${arrow}</div>
        <div class="s-ba-col after"><div class="s-ba-head">${esc(v.afterLabel || "개선")}</div>${list(v.after)}</div>
      </div>
      ${v.metric ? `<div class="s-ba-metric">${esc(v.metric)}</div>` : ""}`,
  },

  // ============ 구조·설명
  {
    id: "flow",
    name: "단계 흐름도",
    category: "explain",
    visual: true,
    desc: "처리 순서·파이프라인 (최대 6단계)",
    fields: [
      T(),
      { key: "steps", label: "단계", type: "rows", maxItems: 6, columns: [{ key: "name", label: "단계 이름", max: 12 }, { key: "desc", label: "설명", max: 36 }] },
      T("caption", "아래 설명 (선택)", 60),
    ],
    sample: {
      title: "질문 처리 흐름",
      steps: [
        { name: "입력", desc: "사용자 질문 받기" },
        { name: "분류", desc: "질문 유형 판단" },
        { name: "검색", desc: "관련 자료 찾기" },
        { name: "답변", desc: "근거와 함께 생성" },
        { name: "기록", desc: "평가용 로그 저장" },
      ],
      caption: "현재 4단계(답변)까지 구현 완료",
    },
    render: (v, ctx) => {
      const s = rows(v.steps);
      return `${kicker(ctx)}${title(v)}
        <div class="s-flow s-flow-${s.length}">${s.map((x, i) => `${i ? arrow : ""}<div class="s-flow-step"><div class="s-flow-num">${i + 1}</div><h3>${esc(x.name)}</h3><p>${esc(x.desc)}</p></div>`).join("")}</div>
        ${v.caption ? `<div class="s-caption">${esc(v.caption)}</div>` : ""}`;
    },
  },
  {
    id: "layers",
    name: "계층 구조도",
    category: "explain",
    visual: true,
    desc: "시스템을 층으로 나눠 구성요소 표시",
    fields: [
      T(),
      { key: "layers", label: "층 (위에서 아래로)", type: "rows", maxItems: 5, columns: [{ key: "name", label: "층 이름", max: 12 }, { key: "items", label: "구성요소 (쉼표로 구분)", max: 70 }] },
      T("caption", "아래 설명 (선택)", 60),
    ],
    sample: {
      title: "서비스 구조",
      layers: [
        { name: "화면", items: "대시보드, 리포트 뷰어, 알림" },
        { name: "서비스", items: "질문 분류, 검색, 답변 생성" },
        { name: "도구", items: "DB 조회, 외부 API, 차트 생성" },
        { name: "데이터", items: "사용자 DB, 문서 저장소, 로그" },
      ],
      caption: "각 층은 바로 아래 층만 호출",
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v)}
      <div class="s-layers">${rows(v.layers).map((l, i, a) => `<div class="s-layer" style="--o:${1 - i / Math.max(a.length, 1) * 0.75}"><div class="s-layer-name">${esc(l.name)}</div><div class="s-layer-items">${splitComma(l.items).map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`).join("")}</div>
      ${v.caption ? `<div class="s-caption">${esc(v.caption)}</div>` : ""}`,
  },
  {
    id: "problem_solution",
    name: "문제 → 원인 → 해결",
    category: "explain",
    visual: true,
    desc: "문제 정의부터 기대효과까지 한 장에",
    fields: [
      T(),
      { key: "problem", label: "문제", type: "textarea", max: 50 },
      { key: "causes", label: "원인", type: "list", max: 26, maxItems: 3 },
      { key: "solutions", label: "해결", type: "list", max: 26, maxItems: 3 },
      { key: "effect", label: "기대 효과", type: "textarea", max: 50 },
    ],
    sample: {
      title: "복합 질문 정답률 저하",
      problem: "복합 질문은 41%만 맞게 답함",
      causes: ["질문을 한 번에 처리", "필요한 자료를 일부만 검색"],
      solutions: ["질문을 단계로 쪼개기", "단계별로 따로 검색", "답변 전 자체 점검"],
      effect: "정답률 72%로 개선, 재질문 40% 감소",
    },
    render: (v, ctx) => {
      const box = (h, cls, body) => `<div class="s-ps-box ${cls}"><div class="s-ps-head">${h}</div>${body}</div>`;
      return `${kicker(ctx)}${title(v)}
        <div class="s-ps">
          ${box("문제", "p", `<p>${esc(v.problem)}</p>`)}${arrow}
          ${box("원인", "c", list(v.causes, "s-bullets small"))}${arrow}
          ${box("해결", "s", list(v.solutions, "s-bullets small"))}${arrow}
          ${box("기대 효과", "e", `<p>${esc(v.effect)}</p>`)}
        </div>`;
    },
  },
  {
    id: "image",
    name: "이미지 + 설명",
    category: "explain",
    visual: true,
    desc: "스크린샷·결과 이미지와 요점",
    fields: [T(), { key: "image", label: "이미지", type: "image" }, T("caption", "이미지 설명", 40), { key: "points", label: "요점", type: "list", max: 34, maxItems: 4 }],
    sample: { title: "메인 화면 시안", caption: "질문 입력과 답변 화면", points: ["왼쪽에 대화 목록", "답변마다 근거 자료 링크", "클릭하면 원문 미리보기"] },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v)}
      <div class="s-img">
        <figure>${v.image ? `<img src="${esc(v.image)}" alt="">` : `<div class="s-img-empty">이미지를 올려주세요</div>`}${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ""}</figure>
        ${(v.points || []).filter(Boolean).length ? `<div class="s-img-side">${list(v.points)}</div>` : ""}
      </div>`,
  },

  // ============ 논의·마무리
  {
    id: "discussion",
    name: "멘토 질문·결정 요청",
    category: "discuss",
    visual: true,
    desc: "멘토님께 받고 싶은 답과 선택지",
    fields: [
      T("title", "제목", 30, { default: "멘토님께 여쭙고 싶은 점" }),
      { key: "items", label: "질문", type: "rows", maxItems: 4, columns: [{ key: "q", label: "질문", max: 45 }, { key: "options", label: "선택지·우리 생각", max: 50 }] },
    ],
    sample: {
      title: "멘토님께 여쭙고 싶은 점",
      items: [
        { q: "다음 스프린트는 기능 추가와 안정화 중 무엇이 먼저일까요?", options: "우리 생각: 안정화 먼저 (오류율 4% → 2%)" },
        { q: "평가 질문 100개로 충분할까요?", options: "A) 100개 유지  B) 300개로 확대" },
      ],
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "멘토님께 여쭙고 싶은 점")}
      <div class="s-qs">${rows(v.items).map((x, i) => `<div class="s-q"><div class="s-q-num">Q${i + 1}</div><div><h3>${esc(x.q)}</h3>${x.options ? `<p>${esc(x.options)}</p>` : ""}</div></div>`).join("")}</div>`,
  },
  {
    id: "next_steps",
    name: "다음 할 일",
    category: "discuss",
    visual: true,
    desc: "할 일, 담당, 기한 (최대 6개)",
    fields: [
      T("title", "제목", 30, { default: "다음 할 일" }),
      { key: "items", label: "할 일", type: "rows", maxItems: 6, columns: [{ key: "task", label: "할 일", max: 30 }, { key: "owner", label: "담당", max: 6, hint: "원문에 나온 이름만" }, { key: "due", label: "기한", max: 8, hint: "원문에 나온 날짜만" }] },
    ],
    sample: {
      title: "다음 주 할 일",
      items: [
        { task: "복합 질문 처리 개선", owner: "김OO", due: "11/19" },
        { task: "평가 질문 세트 확대", owner: "이OO", due: "11/20" },
        { task: "로그인 화면 연동", owner: "박OO", due: "11/21" },
      ],
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "다음 할 일")}
      <div class="s-todo">${rows(v.items).map((x) => `<div class="s-todo-row"><div class="s-todo-check"></div><div class="s-todo-task">${esc(x.task)}</div><div class="s-todo-owner">${esc(x.owner)}</div><div class="s-todo-due">${esc(x.due)}</div></div>`).join("")}</div>`,
  },
  {
    id: "end",
    name: "마무리",
    category: "discuss",
    desc: "감사 인사 / Q&A",
    fields: [T("title", "큰 문구", 20, { default: "감사합니다" }), T("message", "작은 문구", 50)],
    sample: { title: "감사합니다", message: "질문과 피드백 부탁드립니다" },
    render: (v, ctx) => `
      <div class="s-end"><h1>${esc(v.title || "감사합니다")}</h1>${v.message ? `<p>${esc(v.message)}</p>` : ""}<div class="s-cover-meta">${[ctx.meta.presenter, ctx.meta.session].filter(Boolean).map(esc).join("<span>·</span>")}</div></div>`,
  },

  // ============ 멘토링 추가
  {
    id: "feedback",
    name: "피드백 반영표",
    category: "status",
    visual: true,
    desc: "지난 멘토링 피드백 → 우리가 한 조치 → 상태",
    fields: [
      T("title", "제목", 30, { default: "지난 피드백 반영" }),
      { key: "items", label: "피드백", type: "rows", maxItems: 5, columns: [{ key: "feedback", label: "받은 피드백", max: 30 }, { key: "action", label: "우리가 한 조치", max: 36 }, { key: "status", label: "상태", type: "select", options: ["반영완료", "진행중", "보류"] }] },
    ],
    sample: {
      title: "지난 피드백 반영",
      items: [
        { feedback: "평가 기준이 모호함", action: "고정 질문 100개로 매주 자동 채점", status: "반영완료" },
        { feedback: "화면 흐름 설명이 부족함", action: "흐름도 슬라이드 추가", status: "반영완료" },
        { feedback: "외부 API 의존도가 높음", action: "캐시 적용, 대체 API 조사 중", status: "진행중" },
      ],
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "지난 피드백 반영")}
      <table class="s-table s-feedback"><thead><tr><th>받은 피드백</th><th style="width:60px"></th><th>우리가 한 조치</th><th style="width:150px">상태</th></tr></thead>
      <tbody>${rows(v.items).map((r) => `<tr><td>${esc(r.feedback)}</td><td class="s-fb-arrow">→</td><td><b>${esc(r.action)}</b></td><td>${r.status ? `<span class="s-pill" style="--c:${FEEDBACK_COLOR[r.status]}">${esc(r.status)}</span>` : ""}</td></tr>`).join("")}</tbody></table>`,
  },
  {
    id: "kpt",
    name: "회고 (KPT)",
    category: "discuss",
    visual: true,
    desc: "Keep 계속할 것 / Problem 문제 / Try 시도할 것",
    fields: [
      T("title", "제목", 30, { default: "이번 주 회고" }),
      { key: "keep", label: "Keep", type: "list", max: 26, maxItems: 4, aliases: ["계속", "유지", "잘한점"] },
      { key: "problem", label: "Problem", type: "list", max: 26, maxItems: 4, aliases: ["문제", "아쉬운점"] },
      { key: "try", label: "Try", type: "list", max: 26, maxItems: 4, aliases: ["시도", "개선"] },
    ],
    sample: {
      title: "이번 주 회고",
      keep: ["매일 10분 진행 공유", "PR 리뷰 당일 처리"],
      problem: ["회의가 길어짐", "작업 범위가 겹침"],
      try: ["회의 30분 제한", "작업 시작 전 담당 표시"],
    },
    render: (v, ctx) => {
      const col = (cls, letter, name, items) => `<div class="s-kpt-col ${cls}"><div class="s-kpt-head"><b>${letter}</b><span>${name}</span></div>${list(items, "s-bullets small")}</div>`;
      return `${kicker(ctx)}${title(v, "이번 주 회고")}
        <div class="s-kpt">${col("k", "K", "Keep · 계속할 것", v.keep)}${col("p", "P", "Problem · 문제", v.problem)}${col("t", "T", "Try · 시도할 것", v.try)}</div>`;
    },
  },
  {
    id: "big_number",
    name: "숫자 하나 크게",
    category: "analysis",
    visual: true,
    desc: "화면 가득 핵심 숫자 하나 + 한 줄 설명",
    fields: [T("label", "무엇의 숫자인지", 24), T("value", "숫자", 8), T("unit", "단위", 6), T("desc", "한 줄 설명", 60), T("sub", "보조 문구 (예: 이전 2.4초)", 30)],
    sample: { label: "평균 응답 시간", value: "0.9", unit: "초", desc: "캐시 적용 후 2.6배 빨라짐", sub: "이전 2.4초" },
    render: (v) => `
      <div class="s-big">
        <div class="s-big-label">${esc(v.label || "")}</div>
        <div class="s-big-value">${esc(v.value || "")}<small>${esc(v.unit || "")}</small></div>
        ${v.sub ? `<div class="s-big-sub">${esc(v.sub)}</div>` : ""}
        ${v.desc ? `<p>${esc(v.desc)}</p>` : ""}
      </div>`,
  },
  {
    id: "matrix",
    name: "2×2 우선순위",
    category: "analysis",
    visual: true,
    desc: "영향도 × 난이도로 할 일 나누기",
    fields: [
      T("title", "제목", 30, { default: "우선순위" }),
      { key: "q1", label: "지금 바로 (영향 큼·쉬움)", type: "list", max: 18, maxItems: 4 },
      { key: "q2", label: "계획해서 (영향 큼·어려움)", type: "list", max: 18, maxItems: 4 },
      { key: "q3", label: "틈틈이 (영향 작음·쉬움)", type: "list", max: 18, maxItems: 4 },
      { key: "q4", label: "미루기 (영향 작음·어려움)", type: "list", max: 18, maxItems: 4 },
    ],
    sample: {
      title: "다음 스프린트 우선순위",
      q1: ["오류 메시지 개선", "캐시 확대"],
      q2: ["복합 질문 처리", "권한 관리"],
      q3: ["버튼 문구 정리"],
      q4: ["다국어 지원"],
    },
    render: (v, ctx) => {
      const q = (k, name, cls) => `<div class="s-mx-q ${cls}"><div class="s-mx-name">${name}</div><div class="s-mx-items">${(v[k] || []).filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`;
      return `${kicker(ctx)}${title(v, "우선순위")}
        <div class="s-mx">
          <div class="s-mx-y"><span>영향 큼</span><i></i><span>영향 작음</span></div>
          <div class="s-mx-grid">${q("q1", "지금 바로", "hot")}${q("q2", "계획해서", "")}${q("q3", "틈틈이", "")}${q("q4", "미루기", "cold")}</div>
          <div class="s-mx-x"><span>쉬움</span><i></i><span>어려움</span></div>
        </div>`;
    },
  },

  // ============ 학습·공유
  {
    id: "concept",
    name: "개념 카드",
    category: "study",
    visual: true,
    desc: "개념 하나를 정의·비유·특징·예시로",
    fields: [
      T("title", "개념 이름", 24),
      { key: "definition", label: "한 줄 정의", type: "textarea", max: 60 },
      { key: "analogy", label: "쉽게 말하면 (비유)", type: "textarea", max: 60 },
      { key: "points", label: "핵심 특징", type: "list", max: 30, maxItems: 3 },
      T("example", "예시", 60),
    ],
    sample: {
      title: "캐시 (Cache)",
      definition: "자주 쓰는 결과를 가까운 곳에 저장해 두고 다시 꺼내 쓰는 방법",
      analogy: "자주 보는 책을 책상 위에 꺼내 두는 것",
      points: ["같은 요청은 다시 계산하지 않음", "저장 공간과 속도의 교환", "오래된 값 관리가 필요"],
      example: "같은 질문이 오면 저장된 답을 바로 돌려줌",
    },
    render: (v, ctx) => `
      ${kicker(ctx)}
      <div class="s-concept">
        <div class="s-concept-main">
          <div class="s-concept-tag">개념</div>
          <h2>${esc(v.title || "")}</h2>
          ${v.definition ? `<p>${esc(v.definition)}</p>` : ""}
        </div>
        <div class="s-concept-side">
          ${v.analogy ? `<div class="s-concept-box"><span>쉽게 말하면</span>${esc(v.analogy)}</div>` : ""}
          ${(v.points || []).filter(Boolean).length ? `<div class="s-concept-sec"><span>핵심 특징</span>${list(v.points, "s-bullets small")}</div>` : ""}
          ${v.example ? `<div class="s-concept-sec"><span>예시</span><p>${esc(v.example)}</p></div>` : ""}
        </div>
      </div>`,
  },
  {
    id: "compare_concepts",
    name: "개념 비교 (A vs B)",
    category: "study",
    visual: true,
    desc: "비슷한 두 개념의 차이와 언제 무엇을 쓰는지",
    fields: [
      T(),
      T("aName", "A 이름", 14),
      T("bName", "B 이름", 14),
      { key: "rows", label: "비교 기준", type: "rows", maxItems: 5, columns: [{ key: "criterion", label: "기준", max: 10 }, { key: "a", label: "A", max: 24 }, { key: "b", label: "B", max: 24 }] },
      T("whenA", "A를 쓸 때", 36),
      T("whenB", "B를 쓸 때", 36),
    ],
    sample: {
      title: "SQL vs NoSQL",
      aName: "SQL",
      bName: "NoSQL",
      rows: [
        { criterion: "구조", a: "정해진 표(스키마)", b: "자유로운 문서 형태" },
        { criterion: "확장", a: "주로 서버 성능 향상", b: "서버 수를 늘리기 쉬움" },
        { criterion: "일관성", a: "강함", b: "상황에 따라 느슨함" },
      ],
      whenA: "데이터 관계가 중요하고 정확해야 할 때",
      whenB: "형태가 자주 바뀌고 양이 많을 때",
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v)}
      <table class="s-table s-vs"><thead><tr><th></th><th><span class="s-vs-name a">${esc(v.aName || "A")}</span></th><th class="s-vs-mid">vs</th><th><span class="s-vs-name b">${esc(v.bName || "B")}</span></th></tr></thead>
      <tbody>${rows(v.rows).map((r) => `<tr><th>${esc(r.criterion)}</th><td>${esc(r.a)}</td><td></td><td>${esc(r.b)}</td></tr>`).join("")}</tbody></table>
      ${v.whenA || v.whenB ? `<div class="s-vs-when"><div><span>이럴 땐 ${esc(v.aName || "A")}</span>${esc(v.whenA || "")}</div><div><span>이럴 땐 ${esc(v.bName || "B")}</span>${esc(v.whenB || "")}</div></div>` : ""}`,
  },
  {
    id: "how_it_works",
    name: "동작 원리",
    category: "study",
    visual: true,
    desc: "단계별로 어떻게 동작하는지 (세로, 설명 길게)",
    fields: [
      T(),
      { key: "steps", label: "단계", type: "rows", maxItems: 5, columns: [{ key: "name", label: "단계", max: 14 }, { key: "desc", label: "설명", max: 56 }] },
      T("caution", "주의할 점 (선택)", 60),
    ],
    sample: {
      title: "검색 증강 생성(RAG)은 이렇게 동작해요",
      steps: [
        { name: "문서 쪼개기", desc: "긴 문서를 문단 단위로 잘라 둔다" },
        { name: "벡터로 저장", desc: "각 문단을 숫자 벡터로 바꿔 DB에 저장한다" },
        { name: "비슷한 문단 찾기", desc: "질문도 벡터로 바꿔 가까운 문단을 찾는다" },
        { name: "답변 생성", desc: "찾은 문단을 근거로 모델이 답을 쓴다" },
      ],
      caution: "문단을 너무 잘게 자르면 맥락이 끊김",
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v)}
      <div class="s-how">${rows(v.steps).map((s, i) => `<div class="s-how-step"><div class="s-how-num">${i + 1}</div><div class="s-how-name">${esc(s.name)}</div><div class="s-how-desc">${esc(s.desc)}</div></div>`).join("")}</div>
      ${v.caution ? `<div class="s-callout warn"><span>주의</span> ${esc(v.caution)}</div>` : ""}`,
  },
  {
    id: "code",
    name: "코드 설명",
    category: "study",
    visual: true,
    desc: "코드 조각과 줄별 설명 (최대 16줄)",
    fields: [
      T(),
      T("lang", "언어", 12),
      { key: "code", label: "코드", type: "code", maxLines: 16 },
      { key: "notes", label: "줄 설명", type: "rows", maxItems: 4, columns: [{ key: "line", label: "줄 번호", max: 5, hint: "예: 3 또는 3-5" }, { key: "text", label: "설명", max: 40 }] },
      T("takeaway", "핵심 (선택)", 50),
    ],
    sample: {
      title: "캐시 적용 코드",
      lang: "Python",
      code: "cache = {}\n\ndef answer(question):\n    if question in cache:\n        return cache[question]\n    result = search_and_generate(question)\n    cache[question] = result\n    return result",
      notes: [
        { line: "1", text: "질문 → 답을 저장할 딕셔너리" },
        { line: "4-5", text: "이미 본 질문이면 저장된 답을 바로 반환" },
        { line: "7", text: "새로 만든 답을 저장" },
      ],
      takeaway: "두 번째부터는 검색·생성을 건너뜀",
    },
    render: (v, ctx) => {
      const lines = String(v.code || "").replace(/\s+$/, "").split("\n").slice(0, 16);
      const marked = new Set();
      rows(v.notes).forEach((n) => {
        const m = String(n.line || "").match(/(\d+)\s*(?:[-~]\s*(\d+))?/);
        if (m) for (let k = +m[1]; k <= +(m[2] || m[1]); k++) marked.add(k);
      });
      return `${kicker(ctx)}${title(v)}
        <div class="s-code">
          <div class="s-code-box">${v.lang ? `<div class="s-code-lang">${esc(v.lang)}</div>` : ""}<pre>${lines.map((l, i) => `<div class="${marked.has(i + 1) ? "hl" : ""}"><span>${i + 1}</span>${esc(l) || " "}</div>`).join("")}</pre></div>
          <div class="s-code-side">
            ${rows(v.notes).map((n) => `<div class="s-code-note"><b>${esc(n.line)}</b><span>${esc(n.text)}</span></div>`).join("")}
            ${v.takeaway ? `<div class="s-takeaway"><span>핵심</span>${esc(v.takeaway)}</div>` : ""}
          </div>
        </div>`;
    },
  },
  {
    id: "paper",
    name: "논문·자료 요약",
    category: "study",
    visual: true,
    desc: "문제 / 방법 / 결과 / 한계 + 우리 적용점",
    fields: [
      T("title", "자료 제목", 44),
      T("source", "출처 (저자·연도·링크)", 50),
      { key: "problem", label: "풀려는 문제", type: "textarea", max: 50 },
      { key: "method", label: "방법", type: "textarea", max: 50 },
      { key: "result", label: "결과", type: "textarea", max: 50 },
      { key: "limit", label: "한계", type: "textarea", max: 50 },
      T("apply", "우리 프로젝트에 적용", 60),
    ],
    sample: {
      title: "질문을 단계로 나눠 푸는 방법",
      source: "사내 스터디 자료 · 2026",
      problem: "여러 단계가 필요한 질문에서 답이 자주 틀림",
      method: "질문을 하위 질문으로 쪼개 하나씩 답한 뒤 합침",
      result: "복합 질문 정답률이 크게 오름",
      limit: "단계가 늘수록 느려지고 비용이 커짐",
      apply: "복합 질문으로 분류된 경우에만 단계 분해 적용",
    },
    render: (v, ctx) => {
      const box = (h, x) => `<div class="s-paper-box"><span>${h}</span><p>${esc(x || "")}</p></div>`;
      return `${kicker(ctx)}${title(v)}
        ${v.source ? `<div class="s-paper-src">${esc(v.source)}</div>` : ""}
        <div class="s-paper">${box("풀려는 문제", v.problem)}${box("방법", v.method)}${box("결과", v.result)}${box("한계", v.limit)}</div>
        ${v.apply ? `<div class="s-callout"><span class="s-callout-tag">우리 적용</span> ${esc(v.apply)}</div>` : ""}`;
    },
  },
  {
    id: "learned",
    name: "배운 점 → 적용",
    category: "study",
    visual: true,
    desc: "공부한 내용을 우리 프로젝트에 어떻게 쓰는지",
    fields: [
      T("title", "제목", 30, { default: "배운 점과 적용" }),
      { key: "items", label: "배운 점", type: "rows", maxItems: 4, columns: [{ key: "learned", label: "배운 것", max: 32 }, { key: "apply", label: "우리 프로젝트에 적용", max: 32 }] },
    ],
    sample: {
      title: "배운 점과 적용",
      items: [
        { learned: "자주 쓰는 결과는 캐시하면 빠르다", apply: "검색 결과 캐시 도입" },
        { learned: "평가는 고정된 데이터로 해야 비교된다", apply: "질문 100개 평가 세트 구축" },
        { learned: "어려운 질문은 단계로 나누면 정확하다", apply: "복합 질문만 단계 분해" },
      ],
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "배운 점과 적용")}
      <div class="s-learn">
        <div class="s-learn-head"><span>배운 것</span><i></i><span>우리 프로젝트에 적용</span></div>
        ${rows(v.items).map((r) => `<div class="s-learn-row"><div class="l">${esc(r.learned)}</div>${arrow}<div class="r">${esc(r.apply)}</div></div>`).join("")}
      </div>`,
  },
  {
    id: "glossary",
    name: "용어 정리",
    category: "study",
    visual: true,
    desc: "발표에 나오는 용어를 미리 정리 (최대 6개)",
    fields: [
      T("title", "제목", 30, { default: "용어 정리" }),
      { key: "items", label: "용어", type: "rows", maxItems: 6, columns: [{ key: "term", label: "용어", max: 14 }, { key: "desc", label: "뜻", max: 46 }] },
    ],
    sample: {
      title: "용어 정리",
      items: [
        { term: "캐시", desc: "자주 쓰는 결과를 저장해 두고 다시 쓰는 것" },
        { term: "임베딩", desc: "글을 의미가 담긴 숫자 벡터로 바꾼 것" },
        { term: "API", desc: "프로그램끼리 기능을 주고받는 약속된 창구" },
        { term: "스프린트", desc: "1~2주 단위로 끊어서 하는 개발 주기" },
      ],
    },
    render: (v, ctx) => `
      ${kicker(ctx)}${title(v, "용어 정리")}
      <div class="s-gloss">${rows(v.items).map((r) => `<div class="s-gloss-item"><b>${esc(r.term)}</b><p>${esc(r.desc)}</p></div>`).join("")}</div>`,
  },
];

export const TYPE_MAP =Object.fromEntries(SLIDE_TYPES.map((t) => [t.id, t]));

// 표지·구간·마무리는 머리글/바닥글 없음
const BARE = new Set(["cover", "section", "end"]);

// ------------------------------------------------------------------ 빠른 시작 세트
export const PRESETS = [
  { id: "weekly", name: "주간 진행 보고", desc: "가장 자주 쓰는 정기 멘토링 구성", types: ["cover", "feedback", "summary", "kpi", "progress", "issues", "discussion", "next_steps"] },
  { id: "study", name: "공부한 내용 공유", desc: "개념 → 원리 → 코드 → 우리 적용", types: ["cover", "glossary", "concept", "how_it_works", "code", "compare_concepts", "learned", "discussion"] },
  { id: "paper", name: "논문·자료 리뷰", desc: "자료 한 편을 요약하고 적용점 정리", types: ["cover", "paper", "how_it_works", "chart", "learned", "discussion"] },
  { id: "retro", name: "회고·스프린트 정리", desc: "돌아보기와 다음 우선순위", types: ["cover", "big_number", "timeline", "kpt", "matrix", "next_steps"] },
  { id: "experiment", name: "실험·분석 결과", desc: "가설 → 방법 → 결과 차트 → 해석", types: ["cover", "summary", "flow", "chart", "table", "before_after", "discussion", "next_steps"] },
  { id: "decision", name: "문제 해결·결정 요청", desc: "문제를 정의하고 대안을 비교해 결정 받기", types: ["cover", "problem_solution", "table", "discussion", "next_steps"] },
  { id: "architecture", name: "기술 구조 설명", desc: "시스템 구조와 처리 흐름 소개", types: ["cover", "agenda", "layers", "flow", "image", "issues", "next_steps"] },
  { id: "plan", name: "기획·일정 공유", desc: "목표, 일정, 역할 공유", types: ["cover", "summary", "timeline", "bullets", "next_steps", "end"] },
  { id: "blank", name: "빈 덱", desc: "표지 한 장에서 직접 골라 담기", types: ["cover"] },
];

// ------------------------------------------------------------------ 값 다루기
export function defaults(type) {
  const t = TYPE_MAP[type];
  const v = {};
  for (const f of t.fields) if (f.default != null) v[f.key] = f.default;
  return v;
}

/** 슬라이드에 사용자가 채운 값이 있는지 (기본값 제외) */
export function isEmpty(slide) {
  const t = TYPE_MAP[slide.type];
  const d = defaults(slide.type);
  return t.fields.every((f) => {
    const x = slide.values[f.key];
    if (x == null || x === "" || x === d[f.key]) return true;
    if (Array.isArray(x)) return x.every((y) => (typeof y === "object" ? !Object.values(y).some((z) => String(z ?? "").trim()) : !String(y).trim()));
    return false;
  });
}

/** AI·가져오기 값 정리: 알 수 없는 키 제거, 형식 맞추기, 개수 제한 */
export function sanitize(type, raw) {
  const t = TYPE_MAP[type];
  const out = {};
  if (!t || !raw || typeof raw !== "object") return out;
  for (const f of t.fields) {
    let x = raw[f.key];
    if (x == null) continue;
    if (f.type === "list") {
      if (!Array.isArray(x)) x = String(x).split(/\n/);
      out[f.key] = x.map((y) => String(typeof y === "object" ? Object.values(y).join(" ") : y).trim()).filter(Boolean).slice(0, f.maxItems || 10);
    } else if (f.type === "rows") {
      if (!Array.isArray(x)) continue;
      out[f.key] = x.slice(0, f.maxItems || 10).map((r) => {
        const o = {};
        for (const c of f.columns) {
          let val = r && typeof r === "object" ? r[c.key] : c === f.columns[0] ? r : "";
          val = val == null ? "" : String(val).trim();
          if (c.type === "select" && val && !c.options.includes(val)) val = "";
          o[c.key] = val;
        }
        return o;
      });
    } else if (f.type === "select") {
      if (f.options.includes(String(x))) out[f.key] = String(x);
    } else if (f.type === "image") {
      if (typeof x === "string" && x.startsWith("data:image/")) out[f.key] = x;
    } else if (f.type === "code") {
      out[f.key] = String(Array.isArray(x) ? x.join("\n") : x).replace(/\r/g, "").replace(/^\n+|\s+$/g, ""); // 들여쓰기 유지
    } else {
      out[f.key] = Array.isArray(x) ? x.join(", ") : String(x).trim();
    }
  }
  return out;
}

// ------------------------------------------------------------------ 가독성 점검
const TEXT_LIMIT = 260; // 한 장의 글자 수가 이보다 많으면 '줄글 과다'

export function slideText(slide) {
  const t = TYPE_MAP[slide.type];
  let n = 0;
  for (const f of t.fields) {
    const x = slide.values[f.key];
    if (f.type === "image" || f.type === "number" || f.type === "code" || f.key === "kind") continue;
    if (Array.isArray(x)) n += x.reduce((a, y) => a + (typeof y === "object" ? Object.values(y).join("").length : String(y).length), 0);
    else if (x) n += String(x).length;
  }
  return n;
}

export function lint(slide) {
  const t = TYPE_MAP[slide.type];
  const warns = [];
  const over = (label, s, max) => {
    if (max && String(s ?? "").length > max) warns.push(`'${label}'이(가) ${String(s).length}자예요 (권장 ${max}자 이하)`);
  };
  for (const f of t.fields) {
    const x = slide.values[f.key];
    if (f.type === "list") (x || []).forEach((y, i) => over(`${f.label} ${i + 1}`, y, f.max));
    else if (f.type === "rows") (x || []).forEach((r, i) => f.columns.forEach((c) => over(`${f.label} ${i + 1}의 ${c.label}`, r?.[c.key], c.max)));
    else if (f.type === "text" || f.type === "textarea") over(f.label, x, f.max);
    else if (f.type === "code" && x) {
      const ls = String(x).split("\n");
      if (ls.length > (f.maxLines || 16)) warns.push(`코드가 ${ls.length}줄이에요. ${f.maxLines || 16}줄까지만 보여요 — 핵심 부분만 남기세요.`);
      const wide = ls.filter((l) => l.length > 60).length;
      if (wide) warns.push(`60자가 넘는 코드 줄이 ${wide}개 있어요. 화면에서 잘릴 수 있어요.`);
    }
  }
  const n = slideText(slide);
  if (n > TEXT_LIMIT) warns.unshift(`글자가 ${n}자로 많아요. 핵심만 남기고 나머지는 말로 설명하세요.`);
  if (slide.type === "chart" && !rows(slide.values.data).length) warns.push("차트 데이터가 비어 있어요.");
  if (slide.type === "chart" && splitComma(slide.values.unit).length > 1) warns.push("한 차트에 단위가 섞여 있어요. 단위별로 차트를 나누거나 'KPI' 슬라이드를 쓰세요.");
  return warns;
}

export function deckReport(deck) {
  const content = deck.slides.filter((s) => !BARE.has(s.type) && s.type !== "agenda");
  const visual = content.filter((s) => TYPE_MAP[s.type].visual).length;
  const ratio = content.length ? Math.round((visual / content.length) * 100) : 100;
  const heavy = deck.slides.filter((s) => slideText(s) > TEXT_LIMIT).length;
  const warnCount = deck.slides.reduce((a, s) => a + lint(s).length, 0);
  const hasSummary = deck.slides.some((s) => s.type === "summary");
  const hasAsk = deck.slides.some((s) => s.type === "discussion" || s.type === "next_steps");
  const tips = [];
  if (ratio < 60) tips.push("시각화 슬라이드 비율이 낮아요. 차트·표·흐름도로 바꿔 보세요.");
  if (heavy) tips.push(`글이 많은 슬라이드가 ${heavy}장 있어요.`);
  if (!hasSummary) tips.push("앞부분에 '핵심 요약 3줄'을 넣으면 결론이 먼저 전달돼요.");
  if (!hasAsk) tips.push("'멘토 질문' 또는 '다음 할 일'로 마무리하면 피드백 받기 쉬워요.");
  if (deck.slides.length > 12) tips.push(`슬라이드가 ${deck.slides.length}장이에요. 10장 안쪽을 권장해요.`);
  return { ratio, heavy, warnCount, tips };
}

// ------------------------------------------------------------------ 렌더
export function renderSlide(slide, deck, index, opts = {}) {
  const t = TYPE_MAP[slide.type];
  const theme = THEMES[deck.meta.theme] || THEMES.blue;
  const ghost = opts.ghost ?? false;
  const values = ghost ? { ...t.sample } : slide.values;
  const cat = CATEGORIES.find((c) => c.id === t.category)?.name;
  const ctx = { meta: deck.meta, theme, kicker: cat, index, total: deck.slides.length };
  let body;
  try {
    body = t.render(values, ctx);
  } catch (e) {
    body = `<div class="s-error">이 슬라이드를 그리는 중 오류: ${esc(e.message)}</div>`;
  }
  const bare = BARE.has(slide.type);
  const foot = bare
    ? ""
    : `<div class="s-foot"><span>${esc(deck.meta.title || "")}</span><span>${esc(deck.meta.presenter || "")}</span><b>${index + 1} / ${deck.slides.length}</b></div>`;
  return `<div class="slide t-${slide.type} ${bare ? "bare" : ""} ${ghost ? "is-ghost" : ""}" style="--accent:${theme.accent};--soft:${theme.soft}">
    <div class="s-body">${body}</div>${foot}
    ${ghost ? `<div class="s-ghost"><span>예시 화면 — 오른쪽 칸을 채우면 내 내용으로 바뀝니다</span></div>` : ""}
  </div>`;
}
