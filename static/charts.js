// 간단한 SVG 차트 (외부 라이브러리 없이 오프라인에서도 동작)
import { esc } from "./util.js";

const GRID = "#E3E7EE";
const AXIS = "#8A93A3";

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function fmt(n) {
  if (!isFinite(n)) return "";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k";
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 1 ? 2 : 1);
}

function legend(series, colors, x, y) {
  if (series.length < 2) return "";
  let out = "", cx = x;
  series.forEach((s, i) => {
    out += `<rect x="${cx}" y="${y - 11}" width="14" height="14" rx="3" fill="${colors[i]}"/>`;
    out += `<text x="${cx + 20}" y="${y}" font-size="17" fill="#444">${esc(s.name)}</text>`;
    cx += 40 + s.name.length * 16;
  });
  return out;
}

function axes(W, H, pad, max, unit) {
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1.5"/>`;
    g += `<text x="${pad.l - 12}" y="${y + 6}" font-size="16" fill="${AXIS}" text-anchor="end">${fmt((max * i) / 4)}</text>`;
  }
  if (unit) g += `<text x="${pad.l - 12}" y="${pad.t - 16}" font-size="15" fill="${AXIS}" text-anchor="end">(${esc(unit)})</text>`;
  return g;
}

export function chartSVG({ kind, labels, series, unit, colors, W = 760, H = 470 }) {
  series = series.filter((s) => s.values.some((v) => isFinite(v)));
  if (!labels.length || !series.length) {
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="#F6F8FB" stroke="${GRID}" stroke-dasharray="8 6"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="20" fill="${AXIS}">데이터를 입력하면 차트가 그려집니다</text></svg>`;
  }
  if (kind === "pie") return pie({ labels, s: series[0], colors, W, H });

  const pad = { t: series.length > 1 ? 70 : 44, r: 20, b: 56, l: 70 };
  const all = series.flatMap((s) => s.values.filter((v) => isFinite(v)));
  const max = niceMax(Math.max(...all, 0));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const yOf = (v) => pad.t + ih * (1 - Math.max(0, v) / max);
  let g = axes(W, H, pad, max, unit);
  const n = labels.length;
  const slot = iw / n;

  if (kind === "line") {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (isFinite(v) ? [pad.l + slot * (i + 0.5), yOf(v)] : null)).filter(Boolean);
      g += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${colors[si]}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
      s.values.forEach((v, i) => {
        if (!isFinite(v)) return;
        const x = pad.l + slot * (i + 0.5), y = yOf(v);
        g += `<circle cx="${x}" cy="${y}" r="6" fill="#fff" stroke="${colors[si]}" stroke-width="3.5"/>`;
        if (series.length === 1) g += `<text x="${x}" y="${y - 16}" font-size="17" font-weight="700" fill="#333" text-anchor="middle">${fmt(v)}</text>`;
      });
    });
  } else {
    const gw = slot * 0.7, bw = gw / series.length;
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (!isFinite(v)) return;
        const x = pad.l + slot * i + (slot - gw) / 2 + bw * si;
        const y = yOf(v), h = pad.t + ih - y;
        g += `<rect x="${x + 2}" y="${y}" width="${bw - 4}" height="${Math.max(h, 0)}" rx="5" fill="${colors[si]}"/>`;
        g += `<text x="${x + bw / 2}" y="${y - 10}" font-size="${series.length > 2 ? 14 : 17}" font-weight="700" fill="#333" text-anchor="middle">${fmt(v)}</text>`;
      });
    });
  }
  labels.forEach((l, i) => {
    g += `<text x="${pad.l + slot * (i + 0.5)}" y="${H - pad.b + 30}" font-size="17" fill="#444" text-anchor="middle">${esc(l)}</text>`;
  });
  g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="${AXIS}" stroke-width="2"/>`;
  g += legend(series, colors, pad.l, 26);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="inherit">${g}</svg>`;
}

function pie({ labels, s, colors, W, H }) {
  const vals = s.values.map((v) => (isFinite(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = H / 2, cy = H / 2, R = H / 2 - 20, r = R * 0.58;
  const pal = [...colors, "#5FB49C", "#E07A5F", "#81B1D5", "#B8A1D9", "#C9CED6"];
  let a0 = -Math.PI / 2, g = "";
  vals.forEach((v, i) => {
    if (!v) return;
    const a1 = a0 + (v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rad) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    if (v === total) {
      g += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${pal[i]}" stroke-width="${R - r}"/>`;
    } else {
      g += `<path d="M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z" fill="${pal[i]}" stroke="#fff" stroke-width="3"/>`;
    }
    a0 = a1;
  });
  g += `<text x="${cx}" y="${cy + 4}" font-size="34" font-weight="800" text-anchor="middle" fill="#222">${fmt(total)}</text>`;
  g += `<text x="${cx}" y="${cy + 32}" font-size="16" text-anchor="middle" fill="${AXIS}">합계</text>`;
  let ly = Math.max(40, cy - labels.length * 24);
  labels.forEach((l, i) => {
    const pct = Math.round((vals[i] / total) * 100);
    g += `<rect x="${H + 20}" y="${ly - 15}" width="18" height="18" rx="4" fill="${pal[i]}"/>`;
    g += `<text x="${H + 48}" y="${ly}" font-size="19" fill="#333">${esc(l)}</text>`;
    g += `<text x="${W - 10}" y="${ly}" font-size="19" font-weight="700" text-anchor="end" fill="#222">${pct}%</text>`;
    ly += 48;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="inherit">${g}</svg>`;
}
