export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const uid = () => Math.random().toString(36).slice(2, 10);

export const clone = (o) => JSON.parse(JSON.stringify(o));

export const num = (v) => {
  if (v === "" || v == null) return NaN;
  const n = Number(String(v).replace(/[,\s%]/g, ""));
  return isFinite(n) ? n : NaN;
};

export const splitComma = (s) =>
  String(s ?? "")
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
