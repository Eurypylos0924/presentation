import { esc, uid, clone, debounce } from "./util.js";
import {
  SLIDE_TYPES, TYPE_MAP, CATEGORIES, THEMES, PRESETS,
  defaults, isEmpty, sanitize, lint, deckReport, renderSlide,
} from "./slides.js";
import { fromMemo, toMemo, slideToMemo, formatHelp } from "./memo.js";

const $ = (s, el = document) => el.querySelector(s);
const LS_KEY = "ps.state.v1";

// ======================================================= 상태
let deck = null;       // { meta: {title, presenter, date, session, theme}, slides: [{id, type, values, notes}] }
let deckName = null;   // 서버에 저장된 이름
let cur = 0;
let aiInfo = { enabled: false };

const today = () => new Date().toISOString().slice(0, 10);
const makeSlide = (type, values) => ({ id: uid(), type, values: values ?? defaults(type), notes: "" });

function newDeck(preset) {
  const prev = deck?.meta || {};
  return {
    meta: { title: "", presenter: prev.presenter || "", date: today(), session: "", theme: prev.theme || "blue" },
    slides: preset.types.map((t) => makeSlide(t)),
  };
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ deck, deckName, cur }));
  } catch { /* 저장 공간 부족 등 — 무시 */ }
}

function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (s?.deck?.slides?.length) {
      deck = normalizeDeck(s.deck);
      deckName = s.deckName || null;
      cur = Math.min(s.cur || 0, deck.slides.length - 1);
      return true;
    }
  } catch { /* 무시 */ }
  return false;
}

function normalizeDeck(d) {
  if (!d || !Array.isArray(d.slides)) throw new Error("덱 형식이 아닙니다.");
  const meta = { title: "", presenter: "", date: today(), session: "", theme: "blue", ...(d.meta || {}) };
  if (!THEMES[meta.theme]) meta.theme = "blue";
  const slides = d.slides
    .filter((s) => s && TYPE_MAP[s.type])
    .map((s) => ({ id: s.id || uid(), type: s.type, values: { ...defaults(s.type), ...sanitize(s.type, s.values) }, notes: String(s.notes || "") }));
  if (!slides.length) slides.push(makeSlide("cover"));
  return { meta, slides };
}

const curSlide = () => deck.slides[cur];

// ======================================================= 공통 UI
function toast(msg, err = false, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `요청 실패 (${r.status})`);
  return data;
}

/** 1280×720 슬라이드를 주어진 폭으로 축소한 요소 */
function scaled(html, width) {
  const wrap = document.createElement("div");
  wrap.className = "scaler";
  if (width) wrap.style.width = width + "px";
  wrap.innerHTML = html;
  scaleObserver.observe(wrap);
  return wrap;
}
const scaleObserver = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty("--k", e.contentRect.width / 1280);
});

function openModal(html, narrow = false) {
  const card = $("#modal-card");
  card.className = "modal-card" + (narrow ? " narrow" : "");
  card.innerHTML = html;
  $("#modal").hidden = false;
  return card;
}
function closeModal() {
  $("#modal").hidden = true;
  $("#modal-card").innerHTML = "";
}
$("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") closeModal(); });

// ======================================================= 그리기
function renderAll() {
  renderMeta();
  renderList();
  renderEditor();
  renderReport();
  persist();
}

function renderMeta() {
  $("#m-title").value = deck.meta.title;
  $("#m-presenter").value = deck.meta.presenter;
  $("#m-date").value = deck.meta.date;
  $("#m-session").value = deck.meta.session;
  $("#m-theme").value = deck.meta.theme;
  document.title = (deck.meta.title ? deck.meta.title + " · " : "") + "발표 표준화";
}

function slideHTML(i, opts = {}) {
  const s = deck.slides[i];
  const ghost = opts.noGhost ? false : isEmpty(s);
  return renderSlide(s, deck, i, { ghost });
}

function renderList() {
  const ol = $("#slide-list");
  ol.innerHTML = "";
  deck.slides.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "slide-item" + (i === cur ? " active" : "");
    li.draggable = true;
    li.dataset.i = i;
    const warn = lint(s).length > 0;
    li.innerHTML = `<div class="num">${i + 1}</div><div><div class="thumb"></div><div class="label">${warn ? '<i class="warn-dot" title="점검 필요"></i>' : ""}${esc(TYPE_MAP[s.type].name)}</div></div>
      <div class="tools"><button data-act="up" title="위로">↑</button><button data-act="down" title="아래로">↓</button><button data-act="dup" title="복제">⧉</button><button data-act="del" title="삭제">✕</button></div>`;
    li.querySelector(".thumb").appendChild(scaled(slideHTML(i)));
    li.addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act) return slideAction(act, i);
      select(i);
    });
    // 끌어서 순서 바꾸기
    li.addEventListener("dragstart", (e) => { li.classList.add("dragging"); e.dataTransfer.setData("text/plain", String(i)); });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drag-over"); });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      const from = Number(e.dataTransfer.getData("text/plain"));
      if (!isNaN(from) && from !== i) move(from, i);
    });
    ol.appendChild(li);
  });
}

function refreshThumb(i) {
  const li = $(`#slide-list .slide-item[data-i="${i}"]`);
  if (!li) return;
  const th = li.querySelector(".thumb");
  th.innerHTML = "";
  th.appendChild(scaled(slideHTML(i)));
  const label = li.querySelector(".label");
  const warn = lint(deck.slides[i]).length > 0;
  label.innerHTML = `${warn ? '<i class="warn-dot" title="점검 필요"></i>' : ""}${esc(TYPE_MAP[deck.slides[i].type].name)}`;
}

function renderStage() {
  const inner = $("#stage-inner");
  inner.innerHTML = "";
  inner.appendChild(scaled(slideHTML(cur)));
  fitStage();
  const warns = lint(curSlide());
  $("#lint").innerHTML = warns.length
    ? `<ul>${warns.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : isEmpty(curSlide()) ? "" : `<span class="lint-ok">✓ 가독성 점검 통과</span>`;
}

function fitStage() {
  const st = $("#stage");
  const w = st.clientWidth, h = st.clientHeight;
  const k = Math.min(w / 1280, h / 720);
  $("#stage-inner").style.width = Math.floor(1280 * k) + "px";
}
new ResizeObserver(() => fitStage()).observe(document.getElementById("stage"));

function renderReport() {
  const r = deckReport(deck);
  const color = r.ratio >= 70 ? "var(--ok)" : r.ratio >= 50 ? "#d97706" : "var(--bad)";
  $("#report").innerHTML = `
    <div class="report-score">시각화 비율 <b style="color:${color}">${r.ratio}%</b><span style="margin-left:auto;font-size:12px;color:var(--muted)">${deck.slides.length}장</span></div>
    <div class="report-bar"><div style="width:${r.ratio}%;background:${color}"></div></div>
    ${r.tips.length ? `<ul>${r.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<div class="ok">✓ 좋은 구성이에요</div>`}`;
}

function renderEditor() {
  const s = curSlide();
  const t = TYPE_MAP[s.type];
  $("#p-type").textContent = `${cur + 1}. ${t.name}`;
  $("#p-desc").textContent = t.desc;
  $("#notes").value = s.notes || "";
  renderForm();
  renderStage();
}

// 값이 바뀌었을 때 (폼은 다시 그리지 않음 — 입력 포커스 유지)
const softUpdate = debounce(() => {
  renderStage();
  refreshThumb(cur);
  renderReport();
  persist();
}, 120);

// ======================================================= 폼
function counter(val, max) {
  if (!max) return "";
  const n = String(val ?? "").length;
  return `<span class="count ${n > max ? "over" : ""}">${n}/${max}</span>`;
}

function bindCount(input, max, countEl) {
  const upd = () => {
    const n = input.value.length;
    if (countEl) {
      countEl.textContent = `${n}/${max}`;
      countEl.classList.toggle("over", n > max);
    }
    input.classList.toggle("over", n > max);
  };
  input.addEventListener("input", upd);
  upd();
}

function control(def, value, onChange) {
  let el;
  if (def.type === "select") {
    el = document.createElement("select");
    el.innerHTML = `<option value="">선택</option>` + def.options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("");
    el.addEventListener("change", () => onChange(el.value));
  } else if (def.type === "code") {
    el = document.createElement("textarea");
    el.rows = 10;
    el.className = "code-input";
    el.spellcheck = false;
    el.value = value ?? "";
    el.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); el.setRangeText("    ", el.selectionStart, el.selectionEnd, "end"); onChange(el.value); }
    });
    el.addEventListener("input", () => onChange(el.value));
  } else if (def.type === "textarea") {
    el = document.createElement("textarea");
    el.rows = 2;
    el.value = value ?? "";
    el.addEventListener("input", () => onChange(el.value));
  } else {
    el = document.createElement("input");
    el.type = def.type === "number" ? "text" : "text";
    if (def.type === "number") el.inputMode = "decimal";
    el.value = value ?? "";
    if (def.hint) el.placeholder = def.hint;
    el.addEventListener("input", () => onChange(el.value));
  }
  return el;
}

function renderForm() {
  const s = curSlide();
  const t = TYPE_MAP[s.type];
  const form = $("#form");
  form.innerHTML = "";
  const set = (k, v) => { s.values[k] = v; softUpdate(); };

  for (const f of t.fields) {
    const box = document.createElement("div");
    box.className = "field";
    const lab = document.createElement("div");
    lab.className = "f-label";
    const limitText = f.maxItems ? `최대 ${f.maxItems}개` : "";
    lab.innerHTML = `<span>${esc(f.label)} ${limitText ? `<span class="f-hint">· ${limitText}</span>` : ""}</span>`;
    box.appendChild(lab);

    if (f.type === "list") {
      const arr = Array.isArray(s.values[f.key]) ? s.values[f.key] : (s.values[f.key] = []);
      if (!arr.length) arr.push("");
      arr.forEach((val, i) => {
        const row = document.createElement("div");
        row.className = "list-item";
        const inp = control({ type: "text" }, val, (v) => { arr[i] = v; softUpdate(); });
        const cnt = document.createElement("span");
        cnt.className = "count";
        const x = document.createElement("button");
        x.className = "x-btn";
        x.textContent = "✕";
        x.title = "삭제";
        x.onclick = () => { arr.splice(i, 1); renderForm(); softUpdate(); };
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.isComposing && arr.length < (f.maxItems || 99)) {
            e.preventDefault();
            arr.splice(i + 1, 0, "");
            renderForm();
            $("#form").querySelectorAll(`[data-key="${f.key}"] .list-item input`)[i + 1]?.focus();
          }
        });
        row.append(inp, cnt, x);
        if (f.max) bindCount(inp, f.max, cnt);
        box.appendChild(row);
      });
      box.dataset.key = f.key;
      if (arr.length < (f.maxItems || 99)) box.appendChild(addButton("+ 항목 추가", () => { arr.push(""); renderForm(); }));
    } else if (f.type === "rows") {
      const arr = Array.isArray(s.values[f.key]) ? s.values[f.key] : (s.values[f.key] = []);
      if (!arr.length) arr.push({});
      arr.forEach((r, i) => {
        const card = document.createElement("div");
        card.className = "row-card";
        card.innerHTML = `<div class="row-head"><span>${i + 1}</span><span class="btns"><button data-a="up">↑</button><button data-a="down">↓</button><button data-a="del">✕</button></span></div>`;
        card.querySelector(".btns").onclick = (e) => {
          const a = e.target.dataset.a;
          if (a === "del") arr.splice(i, 1);
          else if (a === "up" && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
          else if (a === "down" && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
          else return;
          renderForm();
          softUpdate();
        };
        const grid = document.createElement("div");
        grid.className = "row-grid" + (f.columns.length === 1 ? " cols-1" : "");
        f.columns.forEach((c) => {
          const cell = document.createElement("div");
          const wide = (c.max || 0) >= 30;
          cell.className = "cell" + (wide ? " wide" : "");
          const l = document.createElement("label");
          l.innerHTML = `<span>${esc(c.label)}</span>`;
          const cnt = document.createElement("span");
          cnt.className = "count";
          l.appendChild(cnt);
          const inp = control(c, r[c.key], (v) => { r[c.key] = v; softUpdate(); });
          if (c.max) bindCount(inp, c.max, cnt);
          cell.append(l, inp);
          grid.appendChild(cell);
        });
        card.appendChild(grid);
        box.appendChild(card);
      });
      if (arr.length < (f.maxItems || 99)) box.appendChild(addButton("+ 추가", () => { arr.push({}); renderForm(); }));
    } else if (f.type === "image") {
      box.classList.add("img-field");
      if (s.values[f.key]) {
        const img = document.createElement("img");
        img.src = s.values[f.key];
        box.appendChild(img);
      }
      const btns = document.createElement("div");
      btns.className = "img-btns";
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/*";
      file.hidden = true;
      file.onchange = async () => {
        if (!file.files[0]) return;
        try {
          s.values[f.key] = await readImage(file.files[0]);
          renderForm();
          softUpdate();
        } catch (e) { toast(e.message, true); }
      };
      const pick = document.createElement("button");
      pick.textContent = s.values[f.key] ? "이미지 바꾸기" : "이미지 올리기";
      pick.onclick = () => file.click();
      btns.append(pick, file);
      if (s.values[f.key]) {
        const rm = document.createElement("button");
        rm.textContent = "삭제";
        rm.onclick = () => { delete s.values[f.key]; renderForm(); softUpdate(); };
        btns.appendChild(rm);
      }
      const hint = document.createElement("div");
      hint.className = "f-hint";
      hint.style.fontSize = "12px";
      hint.style.marginTop = "4px";
      hint.textContent = "붙여넣기(Ctrl+V)로도 넣을 수 있어요";
      box.append(btns, hint);
    } else {
      const inp = control(f, s.values[f.key], (v) => set(f.key, v));
      if (f.max) {
        const cnt = document.createElement("span");
        cnt.className = "count";
        lab.appendChild(cnt);
        bindCount(inp, f.max, cnt);
      }
      box.appendChild(inp);
    }
    form.appendChild(box);
  }
}

function addButton(text, fn) {
  const b = document.createElement("button");
  b.className = "add-btn";
  b.textContent = text;
  b.onclick = fn;
  return b;
}

async function readImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 올릴 수 있어요.");
  const url = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("이미지를 읽지 못했어요."));
    r.readAsDataURL(file);
  });
  if (file.size < 350_000) return url;
  // 큰 이미지는 줄여서 저장 (덱 파일이 너무 커지지 않게)
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, 1600 / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.86);
}

// 이미지 슬라이드에서 Ctrl+V로 붙여넣기
document.addEventListener("paste", async (e) => {
  const s = curSlide();
  if (!s || s.type !== "image" || !$("#present").hidden) return;
  const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith("image/"));
  if (!item) return;
  e.preventDefault();
  s.values.image = await readImage(item.getAsFile());
  renderForm();
  softUpdate();
  toast("이미지를 넣었어요");
});

// ======================================================= 슬라이드 조작
function select(i) {
  cur = Math.max(0, Math.min(i, deck.slides.length - 1));
  document.querySelectorAll(".slide-item").forEach((li) => li.classList.toggle("active", Number(li.dataset.i) === cur));
  $(`.slide-item[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" });
  renderEditor();
  persist();
}

function move(from, to) {
  const [s] = deck.slides.splice(from, 1);
  deck.slides.splice(to, 0, s);
  cur = to;
  renderAll();
}

function slideAction(act, i) {
  if (act === "up" && i > 0) return move(i, i - 1);
  if (act === "down" && i < deck.slides.length - 1) return move(i, i + 1);
  if (act === "dup") {
    const c = clone(deck.slides[i]);
    c.id = uid();
    deck.slides.splice(i + 1, 0, c);
    cur = i + 1;
    return renderAll();
  }
  if (act === "del") {
    if (deck.slides.length === 1) return toast("마지막 한 장은 지울 수 없어요", true);
    if (!isEmpty(deck.slides[i]) && !confirm(`${i + 1}번 '${TYPE_MAP[deck.slides[i].type].name}' 슬라이드를 지울까요?`)) return;
    deck.slides.splice(i, 1);
    cur = Math.min(cur, deck.slides.length - 1);
    renderAll();
  }
}

function insertSlides(types, after = cur) {
  const news = types.map((t) => makeSlide(t));
  deck.slides.splice(after + 1, 0, ...news);
  cur = after + 1;
  renderAll();
}

// ======================================================= 템플릿 라이브러리 (골라 담기)
function openLibrary() {
  const picked = [];
  const sampleDeck = { meta: { ...deck.meta, title: "예시 덱", presenter: deck.meta.presenter || "홍길동", session: deck.meta.session || "멘토링 5차" }, slides: [] };
  const card = openModal(`
    <div class="m-head"><div><h2>슬라이드 담기</h2><p>필요한 템플릿을 클릭해서 여러 개 고르세요. 고른 순서대로 현재 슬라이드 뒤에 들어갑니다.</p></div><button data-close>닫기</button></div>
    <div class="m-body">
      <div class="cat-tabs"><button class="on" data-cat="">전체</button>${CATEGORIES.map((c) => `<button data-cat="${c.id}">${c.name}</button>`).join("")}<button data-cat="visual">시각화만</button></div>
      <div id="lib"></div>
    </div>
    <div class="m-foot"><span class="grow" id="lib-sel">선택한 슬라이드 없음</span><button data-close>취소</button><button class="primary" id="lib-ok" disabled>담기</button></div>`);

  const lib = $("#lib", card);
  const cards = new Map();
  for (const c of CATEGORIES) {
    const types = SLIDE_TYPES.filter((t) => t.category === c.id);
    const sec = document.createElement("section");
    sec.dataset.cat = c.id;
    sec.innerHTML = `<div class="cat-title">${c.name}</div><div class="lib-grid"></div>`;
    const grid = sec.querySelector(".lib-grid");
    for (const t of types) {
      const b = document.createElement("button");
      b.className = "lib-card";
      b.dataset.visual = t.visual ? "1" : "";
      const html = renderSlide({ type: t.id, values: clone(t.sample), notes: "" }, { ...sampleDeck, slides: [1, 2, 3, 4, 5] }, 1);
      b.appendChild(scaled(html));
      const info = document.createElement("div");
      info.className = "info";
      info.innerHTML = `<div class="name">${esc(t.name)}${t.visual ? '<span class="vis-tag">시각화</span>' : ""}</div><div class="desc">${esc(t.desc)}</div>`;
      b.appendChild(info);
      b.onclick = () => {
        const k = picked.indexOf(t.id);
        if (k >= 0) picked.splice(k, 1);
        else picked.push(t.id);
        update();
      };
      b.ondblclick = () => { if (!picked.includes(t.id)) picked.push(t.id); finish(); };
      cards.set(t.id, b);
      grid.appendChild(b);
    }
    lib.appendChild(sec);
  }

  function update() {
    cards.forEach((b, id) => {
      const k = picked.indexOf(id);
      b.classList.toggle("on", k >= 0);
      b.querySelector(".badge")?.remove();
      if (k >= 0) b.insertAdjacentHTML("afterbegin", `<div class="badge">${k + 1}</div>`);
    });
    $("#lib-sel", card).textContent = picked.length ? `${picked.length}장 선택: ${picked.map((p) => TYPE_MAP[p].name).join(" → ")}` : "선택한 슬라이드 없음";
    const ok = $("#lib-ok", card);
    ok.disabled = !picked.length;
    ok.textContent = picked.length ? `${picked.length}장 담기` : "담기";
  }
  function finish() {
    if (!picked.length) return;
    closeModal();
    insertSlides(picked);
    toast(`${picked.length}장을 담았어요`);
  }
  $("#lib-ok", card).onclick = finish;
  card.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
  card.querySelectorAll(".cat-tabs button").forEach((b) => {
    b.onclick = () => {
      card.querySelectorAll(".cat-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      const cat = b.dataset.cat;
      lib.querySelectorAll("section").forEach((sec) => {
        if (cat === "visual") {
          sec.hidden = false;
          sec.querySelectorAll(".lib-card").forEach((c) => (c.hidden = !c.dataset.visual));
          sec.hidden = ![...sec.querySelectorAll(".lib-card")].some((c) => !c.hidden);
        } else {
          sec.querySelectorAll(".lib-card").forEach((c) => (c.hidden = false));
          sec.hidden = !!cat && sec.dataset.cat !== cat;
        }
      });
    };
  });
}

// ======================================================= 새 덱 (빠른 시작 세트)
function openPresets(firstRun = false) {
  const card = openModal(`
    <div class="m-head"><div><h2>${firstRun ? "어떤 발표를 준비하나요?" : "새 덱 만들기"}</h2><p>구성 세트로 시작한 뒤 슬라이드를 더 담거나 빼면 됩니다.</p></div>${firstRun ? "" : "<button data-close>닫기</button>"}</div>
    <div class="m-body"><div class="preset-grid">${PRESETS.map((p) => `
      <button class="preset" data-id="${p.id}"><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p>
        <div class="chips">${p.types.map((t) => `<span>${esc(TYPE_MAP[t].name)}</span>`).join("")}</div></button>`).join("")}</div></div>`);
  card.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
  card.querySelectorAll(".preset").forEach((b) => {
    b.onclick = () => {
      if (!firstRun && deck.slides.some((s) => !isEmpty(s)) && !confirm("지금 작업 중인 덱을 닫고 새로 시작할까요? (저장하지 않은 내용은 사라집니다)")) return;
      deck = newDeck(PRESETS.find((p) => p.id === b.dataset.id));
      deckName = null;
      cur = 0;
      closeModal();
      renderAll();
      $("#m-title").focus();
    };
  });
}

// ======================================================= 저장 / 불러오기
async function save(asNew = false) {
  let name = deckName;
  if (!name || asNew) {
    const def = [deck.meta.date, deck.meta.presenter, deck.meta.title].filter(Boolean).join("_") || "발표";
    name = prompt("저장할 이름", def);
    if (!name) return;
  }
  try {
    const r = await api("PUT", `/api/decks/${encodeURIComponent(name)}`, deck);
    deckName = r.name;
    persist();
    toast(`'${r.name}'(으)로 저장했어요`);
  } catch (e) { toast(e.message, true); }
}

async function openDecks() {
  const card = openModal(`<div class="m-head"><div><h2>저장된 덱</h2><p>decks 폴더에 저장된 덱입니다.</p></div><button data-close>닫기</button></div><div class="m-body" id="deck-list"><div class="empty">불러오는 중…</div></div>`, true);
  card.querySelector("[data-close]").onclick = closeModal;
  const box = $("#deck-list", card);
  try {
    const items = await api("GET", "/api/decks");
    if (!items.length) { box.innerHTML = `<div class="empty">아직 저장된 덱이 없어요.</div>`; return; }
    box.innerHTML = items.map((d) => `<div class="deck-row"><div class="grow"><b>${esc(d.name)}</b><small>${esc([d.title, d.presenter, d.updated].filter(Boolean).join(" · "))}</small></div><button data-open="${esc(d.name)}" class="primary-soft">열기</button><button data-del="${esc(d.name)}">삭제</button></div>`).join("");
    box.onclick = async (e) => {
      const o = e.target.dataset.open, d = e.target.dataset.del;
      try {
        if (o) {
          deck = normalizeDeck(await api("GET", `/api/decks/${encodeURIComponent(o)}`));
          deckName = o;
          cur = 0;
          closeModal();
          renderAll();
          toast(`'${o}'을(를) 열었어요`);
        } else if (d && confirm(`'${d}' 덱을 삭제할까요? 되돌릴 수 없어요.`)) {
          await api("DELETE", `/api/decks/${encodeURIComponent(d)}`);
          e.target.closest(".deck-row").remove();
        }
      } catch (err) { toast(err.message, true); }
    };
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(deck, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${[deck.meta.date, deck.meta.presenter, deck.meta.title].filter(Boolean).join("_") || "발표"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("#file-import").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    deck = normalizeDeck(JSON.parse(await f.text()));
    deckName = null;
    cur = 0;
    renderAll();
    toast("덱을 가져왔어요");
  } catch (err) { toast("가져오기 실패: " + err.message, true); }
});

// 서버 없이 더블클릭으로 열리는 단일 HTML 파일 (CSS·차트·이미지 모두 포함)
const VIEWER_CSS = `
html,body{margin:0;height:100%;background:#1f232a;overflow:hidden;font-family:"Pretendard Variable",Pretendard,"Malgun Gothic",sans-serif}
#deck{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
.frame{position:absolute;width:1280px;height:720px;transform:scale(var(--k,1));display:none;box-shadow:0 10px 40px rgba(0,0,0,.35)}
.frame.on{display:block}
.notes{display:none}
#hud{position:fixed;right:18px;bottom:14px;color:#c9ced6;font-size:14px;opacity:.75;user-select:none}
#hud kbd{border:1px solid #6b7280;border-radius:4px;padding:0 5px;font-family:inherit;font-size:12px}
#pnotes{position:fixed;left:0;right:0;bottom:0;max-height:30vh;overflow:auto;background:rgba(20,23,28,.94);color:#eef0f3;font-size:18px;line-height:1.6;padding:16px 28px;white-space:pre-wrap;display:none}
#pnotes.on{display:block}
@media print{
  @page{size:1280px 720px;margin:0}
  html,body{background:#fff;overflow:visible;height:auto}
  #deck{position:static;display:block}
  .frame{position:static;display:block;transform:none;box-shadow:none;break-after:page}
  .frame:last-child{break-after:auto}
  #hud,#pnotes{display:none!important}
}`;

const VIEWER_JS = `
(function(){
  var f=[].slice.call(document.querySelectorAll('.frame')),i=0,pn=document.getElementById('pnotes'),hud=document.getElementById('hud-n');
  function fit(){var k=Math.min(innerWidth/1280,innerHeight/720)*0.96;document.documentElement.style.setProperty('--k',k);f.forEach(function(e){e.style.setProperty('--k',k)})}
  function show(n){i=Math.max(0,Math.min(f.length-1,n));f.forEach(function(e,j){e.classList.toggle('on',j===i)});
    hud.textContent=(i+1)+' / '+f.length;var t=f[i].querySelector('.notes');pn.textContent=(t&&t.textContent)||'(메모 없음)';
    history.replaceState(null,'','#'+(i+1))}
  addEventListener('keydown',function(e){var k=e.key;
    if(k==='ArrowRight'||k==='PageDown'||k===' '||k==='Enter'){e.preventDefault();show(i+1)}
    else if(k==='ArrowLeft'||k==='PageUp'||k==='Backspace'){e.preventDefault();show(i-1)}
    else if(k==='Home')show(0);else if(k==='End')show(f.length-1);
    else if(k==='n'||k==='N')pn.classList.toggle('on');
    else if(k==='f'||k==='F'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}});
  document.getElementById('deck').addEventListener('click',function(e){show(e.clientX>innerWidth/2?i+1:i-1)});
  addEventListener('resize',fit);fit();show((parseInt(location.hash.slice(1),10)||1)-1);
})();`;

async function exportHTML() {
  const idx = deck.slides.map((s, i) => (isEmpty(s) ? -1 : i)).filter((i) => i >= 0);
  if (!idx.length) return toast("내용이 채워진 슬라이드가 없어요", true);
  let css;
  try {
    css = await (await fetch("/static/slide.css")).text();
  } catch (e) { return toast("스타일을 읽지 못했어요: " + e.message, true); }
  const out = { ...deck, slides: idx.map((i) => deck.slides[i]) };   // 빈 장을 뺀 뒤 쪽 번호를 다시 매김
  const frames = out.slides.map((s, j) => {
    const notes = s.notes ? `<div class="notes">${esc(s.notes)}</div>` : "";
    return `<div class="frame">${renderSlide(s, out, j, { ghost: false })}${notes}</div>`;
  }).join("\n");
  const title = [deck.meta.title, deck.meta.presenter].filter(Boolean).join(" · ") || "발표";
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>${css.replace(/<\/style/gi, "<\\/style")}
${VIEWER_CSS}</style>
</head>
<body>
<div id="deck">
${frames}
</div>
<div id="pnotes"></div>
<div id="hud"><span id="hud-n"></span> &nbsp; <kbd>← →</kbd> 이동 <kbd>N</kbd> 메모 <kbd>F</kbd> 전체화면</div>
<script>${VIEWER_JS}</script>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${[deck.meta.date, deck.meta.presenter, deck.meta.title].filter(Boolean).join("_") || "발표"}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const skipped = deck.slides.length - idx.length;
  toast(`HTML 파일로 저장했어요 (${idx.length}장${skipped ? `, 빈 슬라이드 ${skipped}장 제외` : ""})`);
}

function printPDF() {
  const root = $("#print-root");
  root.innerHTML = deck.slides.map((_, i) => slideHTML(i, { noGhost: true })).join("");
  const done = () => { root.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  toast("인쇄 창에서 '대상: PDF로 저장', 배경 그래픽 켜기를 선택하세요", false, 5000);
  setTimeout(() => window.print(), 300);
}

// ======================================================= AI
const schemaOf = (t) => ({ id: t.id, name: t.name, desc: t.desc, fields: t.fields });

async function aiFill() {
  const text = $("#ai-text").value.trim();
  if (!text) return toast("정리할 내용을 붙여넣어 주세요", true);
  const s = curSlide();
  const btn = $("#b-ai-fill");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>정리 중…`;
  try {
    const r = await api("POST", "/api/ai/fill", { slide: schemaOf(TYPE_MAP[s.type]), text });
    const vals = sanitize(s.type, r.values);
    if (s.values.image && !vals.image) vals.image = s.values.image;
    s.values = { ...defaults(s.type), ...vals };
    renderAll();
    if (r.warnings?.length) toast(r.warnings.join(" "), true, 7000);
    else toast(r.mode === "ai" ? "칸을 채웠어요. 내용을 확인하고 다듬어 주세요" : "AI 미설정 — 문장 단위로 나눠 넣었어요");
  } catch (e) { toast(e.message, true, 5000); }
  finally {
    btn.disabled = false;
    btn.textContent = "칸 채우기";
  }
}

// ======================================================= 양식 메모로 만들기 (AI 없음)
const MEMO_KEY = "ps.memo.v1";

function exampleMemo() {
  const p = PRESETS.find((x) => x.id === "weekly");
  const d = {
    meta: { title: "3팀 5차 멘토링", presenter: deck.meta.presenter || "홍길동", date: today(), session: "멘토링 5차" },
    slides: p.types.map((t) => ({ type: t, values: { ...defaults(t), ...clone(TYPE_MAP[t].sample) } })),
  };
  return toMemo(d);
}

function openMemo() {
  let saved = "";
  try { saved = localStorage.getItem(MEMO_KEY) || ""; } catch { /* 무시 */ }
  const card = openModal(`
    <div class="m-head"><div><h2>메모로 덱 만들기</h2><p>정해진 양식으로 쓰면 그대로 슬라이드가 됩니다. AI 없이 즉시 만들어지고, 쓴 내용만 들어가요.</p></div>
      <div class="m-head-tools">${aiInfo.enabled ? `<button id="memo-ai">✨ AI로 줄글 정리</button>` : ""}<button data-close>닫기</button></div></div>
    <div class="m-body memo-body">
      <div class="memo-left">
        <div class="memo-tools">
          <button id="memo-from-deck">지금 덱을 메모로</button>
          <button id="memo-example">예시 불러오기</button>
          <button id="memo-clear" class="ghost-btn">비우기</button>
        </div>
        <textarea id="memo-text" spellcheck="false" placeholder="# 표지: 발표 제목&#10;부제: 한 줄 요약&#10;&#10;# KPI: 이번 주 지표&#10;- 정답률 | 86 | % | +15%p | 좋아짐&#10;&#10;# 다음 할 일&#10;- 할 일 | 담당 | 기한"></textarea>
      </div>
      <div class="memo-right">
        <div class="memo-sec-title">미리보기 <span id="memo-count"></span></div>
        <div id="memo-warn"></div>
        <div class="memo-thumbs" id="memo-thumbs"></div>
        <details class="memo-help" open>
          <summary>양식 안내</summary>
          <div class="memo-rules">
            <div><code># 종류: 제목</code> 새 슬라이드 시작</div>
            <div><code>칸 이름: 값</code> 한 줄짜리 칸</div>
            <div><code>- 항목</code> 목록 · <code>- a | b | c</code> 표 칸 (열 순서대로)</div>
            <div><code>칸 이름:</code> 다음 줄부터 그 칸의 목록</div>
            <div>맨 위 <code>제목: / 발표자: / 날짜: / 회차:</code> 는 덱 정보</div>
          </div>
          <div class="memo-type-row">
            <select id="memo-type">${SLIDE_TYPES.filter((t) => t.id !== "image").map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
            <button id="memo-insert" class="primary-soft">이 종류 예시 넣기</button>
          </div>
          <pre class="memo-example" id="memo-type-ex"></pre>
        </details>
      </div>
    </div>
    <div class="m-foot">
      <span class="grow draft-opts" style="margin:0">
        <label><input type="radio" name="memo-mode" value="replace" checked> 지금 덱 바꾸기</label>
        <label><input type="radio" name="memo-mode" value="append"> 지금 덱 뒤에 붙이기</label>
      </span>
      <button data-close>취소</button><button class="primary" id="memo-ok" disabled>덱 만들기</button>
    </div>`);
  card.classList.add("wide");
  card.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
  const ta = $("#memo-text", card);
  ta.value = saved;

  const showTypeEx = () => {
    const t = TYPE_MAP[$("#memo-type", card).value];
    const ex = slideToMemo({ type: t.id, values: { ...defaults(t.id), ...clone(t.sample) } });
    $("#memo-type-ex", card).textContent = `${ex}\n\n// 칸: ${formatHelp(t).join(" · ")}`;
  };
  $("#memo-type", card).onchange = showTypeEx;
  showTypeEx();

  let parsed = { meta: {}, slides: [], warnings: [] };
  const preview = debounce(() => {
    try { localStorage.setItem(MEMO_KEY, ta.value); } catch { /* 무시 */ }
    parsed = fromMemo(ta.value);
    const n = parsed.slides.length;
    $("#memo-count", card).textContent = n ? `${n}장` : "";
    $("#memo-ok", card).disabled = !n;
    $("#memo-ok", card).textContent = n ? `${n}장으로 덱 만들기` : "덱 만들기";
    const lintN = parsed.slides.reduce((a, s) => a + lint(s).length, 0);
    const warns = [...parsed.warnings, ...(lintN ? [`글자 수 초과 등 점검 항목 ${lintN}개 — 만든 뒤 슬라이드별로 확인하세요.`] : [])];
    $("#memo-warn", card).innerHTML = warns.length ? `<ul class="memo-warn">${warns.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
    const box = $("#memo-thumbs", card);
    box.innerHTML = "";
    const tmp = { meta: { ...deck.meta, ...parsed.meta }, slides: parsed.slides };
    parsed.slides.forEach((s, i) => {
      const d = document.createElement("div");
      d.className = "memo-thumb";
      d.title = `${s.line}줄`;
      d.appendChild(scaled(renderSlide(s, tmp, i)));
      const cap = document.createElement("div");
      cap.textContent = `${i + 1}. ${TYPE_MAP[s.type].name}`;
      d.appendChild(cap);
      box.appendChild(d);
    });
    if (!n) box.innerHTML = `<div class="empty">왼쪽에 메모를 쓰면 여기에 슬라이드가 보여요</div>`;
  }, 250);
  ta.addEventListener("input", preview);
  preview();

  const setText = (v) => { ta.value = v; preview(); ta.focus(); };
  $("#memo-from-deck", card).onclick = () => {
    if (ta.value.trim() && !confirm("메모 내용을 지금 덱 내용으로 바꿀까요?")) return;
    setText(toMemo(deck));
  };
  $("#memo-example", card).onclick = () => {
    if (ta.value.trim() && !confirm("메모 내용을 예시로 바꿀까요?")) return;
    setText(exampleMemo());
  };
  $("#memo-clear", card).onclick = () => { if (!ta.value.trim() || confirm("메모를 비울까요?")) setText(""); };
  $("#memo-insert", card).onclick = () => {
    const t = TYPE_MAP[$("#memo-type", card).value];
    const ex = slideToMemo({ type: t.id, values: { ...defaults(t.id), ...clone(t.sample) } });
    const pos = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, pos).replace(/\s*$/, "");
    const after = ta.value.slice(pos).replace(/^\s*/, "");
    setText(`${before}${before ? "\n\n" : ""}${ex}\n${after ? "\n" + after : ""}`);
  };
  $("#memo-ai", card) && ($("#memo-ai", card).onclick = () => { closeModal(); openDraft(); });
  // Tab 키로 들여쓰기 대신 2칸 공백
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); }
  });

  $("#memo-ok", card).onclick = () => {
    parsed = fromMemo(ta.value);
    if (!parsed.slides.length) return;
    const slides = parsed.slides.map((s) => makeSlide(s.type, s.values));
    const mode = card.querySelector('[name="memo-mode"]:checked').value;
    if (mode === "replace") {
      if (deck.slides.some((s) => !isEmpty(s)) && !confirm(`지금 덱(${deck.slides.length}장)을 메모 내용 ${slides.length}장으로 바꿀까요?`)) return;
      deck.slides = slides;
      cur = 0;
    } else {
      deck.slides.push(...slides);
      cur = deck.slides.length - slides.length;
    }
    for (const [k, v] of Object.entries(parsed.meta)) {
      if (k === "theme") { const th = Object.entries(THEMES).find(([id, t]) => id === v || t.name === v); if (th) deck.meta.theme = th[0]; }
      else if (k === "date") { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) deck.meta.date = v; }
      else deck.meta[k] = v;
    }
    closeModal();
    renderAll();
    toast(`${slides.length}장을 만들었어요`);
  };
  ta.focus();
}

function downloadMemo() {
  const blob = new Blob([toMemo(deck)], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${[deck.meta.date, deck.meta.presenter, deck.meta.title].filter(Boolean).join("_") || "발표"}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function openDraft() {
  const card = openModal(`
    <div class="m-head"><div><h2>줄글로 덱 초안 만들기</h2><p>회의록·보고 메모를 붙여넣으면 알맞은 템플릿을 골라 채웁니다. ${aiInfo.enabled ? "" : "<b>(AI 미설정: 문장 나누기 규칙으로 간단히 구성)</b>"}</p></div><button data-close>닫기</button></div>
    <div class="m-body">
      <textarea id="draft-text" rows="14" placeholder="예) 이번 주에는 검색 기능에 캐시를 붙여서 응답 시간이 2.4초에서 0.9초로 줄었다. 정답률은 71%에서 86%로 올랐다. 다만 오류율이 조금 늘었다. ..."></textarea>
      <div class="draft-opts">
        <label>최대 <input type="number" id="draft-max" value="8" min="3" max="15"> 장</label>
        <label><input type="radio" name="draft-mode" value="append" checked> 현재 덱 뒤에 붙이기</label>
        <label><input type="radio" name="draft-mode" value="replace"> 현재 덱 바꾸기</label>
      </div>
    </div>
    <div class="m-foot"><button data-close>취소</button><button class="primary" id="draft-ok">초안 만들기</button></div>`, true);
  card.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
  $("#draft-text", card).focus();
  $("#draft-ok", card).onclick = async () => {
    const text = $("#draft-text", card).value.trim();
    if (!text) return toast("내용을 붙여넣어 주세요", true);
    const btn = $("#draft-ok", card);
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>만드는 중…`;
    try {
      const max = Math.max(3, Math.min(15, Number($("#draft-max", card).value) || 8));
      const r = await api("POST", "/api/ai/draft", { catalog: SLIDE_TYPES.filter((t) => t.id !== "image").map(schemaOf), text, max_slides: max });
      const slides = (r.slides || [])
        .filter((x) => x && TYPE_MAP[x.type])
        .slice(0, max)
        .map((x) => makeSlide(x.type, { ...defaults(x.type), ...sanitize(x.type, x.values) }));
      if (!slides.length) throw new Error("만들 수 있는 슬라이드가 없었어요.");
      const mode = card.querySelector('[name="draft-mode"]:checked').value;
      if (mode === "replace") { deck.slides = slides; cur = 0; }
      else { deck.slides.push(...slides); cur = deck.slides.length - slides.length; }
      closeModal();
      renderAll();
      if (r.warnings?.length) toast(`${slides.length}장 초안 완성. ${r.warnings.join(" ")}`, true, 7000);
      else toast(`${slides.length}장 초안을 만들었어요. 한 장씩 확인해 주세요`, false, 4000);
    } catch (e) {
      toast(e.message, true, 5000);
      btn.disabled = false;
      btn.textContent = "초안 만들기";
    }
  };
}

// ======================================================= 발표 모드
let pIdx = 0;
function present(start = cur) {
  pIdx = start;
  const p = $("#present");
  p.hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
  drawPresent();
}
function drawPresent() {
  const k = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  const st = $("#present-stage");
  st.style.width = 1280 * k + "px";
  st.innerHTML = "";
  st.appendChild(scaled(slideHTML(pIdx, { noGhost: true })));
  $("#present-hud").textContent = `${pIdx + 1} / ${deck.slides.length}   ← → 이동 · N 메모 · Esc 종료`;
  const notes = deck.slides[pIdx].notes;
  $("#present-notes").textContent = notes || "(메모 없음)";
}
function endPresent() {
  $("#present").hidden = true;
  $("#present-notes").hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  select(pIdx);
}
document.addEventListener("keydown", (e) => {
  if ($("#present").hidden) {
    if (e.key === "Escape" && !$("#modal").hidden) closeModal();
    if (e.key === "F5") { e.preventDefault(); present(e.shiftKey ? cur : 0); }
    return;
  }
  const n = deck.slides.length;
  if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) pIdx = Math.min(n - 1, pIdx + 1);
  else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) pIdx = Math.max(0, pIdx - 1);
  else if (e.key === "Home") pIdx = 0;
  else if (e.key === "End") pIdx = n - 1;
  else if (e.key === "n" || e.key === "N" || e.key === "ㅜ") { $("#present-notes").hidden = !$("#present-notes").hidden; return; }
  else if (e.key === "Escape") return endPresent();
  else return;
  e.preventDefault();
  drawPresent();
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && !$("#present").hidden) endPresent();
});
$("#present").addEventListener("click", (e) => {
  if (e.target.closest(".present-notes")) return;
  pIdx = e.clientX < window.innerWidth / 3 ? Math.max(0, pIdx - 1) : Math.min(deck.slides.length - 1, pIdx + 1);
  drawPresent();
});
let cursorT;
$("#present").addEventListener("mousemove", () => {
  $("#present").classList.add("show-cursor");
  clearTimeout(cursorT);
  cursorT = setTimeout(() => $("#present").classList.remove("show-cursor"), 1500);
});
window.addEventListener("resize", () => { if (!$("#present").hidden) drawPresent(); });

// ======================================================= 이벤트 연결
for (const [id, key] of [["#m-title", "title"], ["#m-presenter", "presenter"], ["#m-date", "date"], ["#m-session", "session"]]) {
  $(id).addEventListener("input", (e) => {
    deck.meta[key] = e.target.value;
    if (key === "title") document.title = (e.target.value ? e.target.value + " · " : "") + "발표 표준화";
    softUpdateAll();
  });
}
const softUpdateAll = debounce(() => { renderList(); renderStage(); persist(); }, 200);
$("#m-theme").innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("");
$("#m-theme").addEventListener("change", (e) => { deck.meta.theme = e.target.value; renderList(); renderStage(); persist(); });

$("#notes").addEventListener("input", (e) => { curSlide().notes = e.target.value; persist(); });
$("#b-add").onclick = openLibrary;
$("#b-draft").onclick = openMemo;
$("#b-memo-out").onclick = downloadMemo;
$("#b-new").onclick = () => openPresets(false);
$("#b-open").onclick = openDecks;
$("#b-save").onclick = () => save(false);
$("#b-present").onclick = () => present(cur);
$("#b-ai-fill").onclick = aiFill;
$("#b-sample").onclick = () => {
  const s = curSlide();
  if (!isEmpty(s) && !confirm("지금 입력한 내용을 예시로 덮어쓸까요?")) return;
  s.values = { ...defaults(s.type), ...clone(TYPE_MAP[s.type].sample) };
  renderAll();
};
$("#b-clear").onclick = () => {
  const s = curSlide();
  if (!isEmpty(s) && !confirm("이 슬라이드의 내용을 모두 비울까요?")) return;
  s.values = defaults(s.type);
  renderAll();
};

const menu = $(".menu-list");
$("#b-more").onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
document.addEventListener("click", () => (menu.hidden = true));
$("#b-saveas").onclick = () => save(true);
$("#b-export").onclick = exportJSON;
$("#b-import").onclick = () => $("#file-import").click();
$("#b-pdf").onclick = printPDF;
$("#b-html").onclick = exportHTML;

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(false); }
});

// ======================================================= 시작
(async function init() {
  try {
    aiInfo = await api("GET", "/api/ai/status");
  } catch { /* 서버 미응답 */ }
  // AI 는 선택 기능: 설정했을 때만 보인다
  $("#ai-box").hidden = !aiInfo.enabled;
  $("#ai-status").textContent = `AI 연결됨 (${aiInfo.provider} · ${aiInfo.model}). 로컬 모델은 한 장에 1분 넘게 걸릴 수 있어요. 결과는 꼭 확인하세요.`;
  if (restore()) {
    renderAll();
  } else {
    deck = newDeck(PRESETS.find((p) => p.id === "weekly"));
    renderAll();
    openPresets(true);
  }
})();
