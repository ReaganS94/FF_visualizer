// Charts several tabs draw, as SVG into the element they get: vertical bars (columnChart), ranked
// horizontal bars (barList), and the blue heat colours with their legend.
import { esc } from "../lib/text.js";
import { niceMax } from "../lib/count.js";

// Vertical bars. items: [{label, value, tip, tick, hi}]; hi: false greys a bar out next to the highlighted ones.
export function columnChart(el, items, { height = 220 } = {}) {
  const W = el.clientWidth || 1000, H = height, L = 34, B = 24, T = 8;
  const max = niceMax(Math.max(1, ...items.map((d) => d.value)));
  const bw = (W - L) / items.length;
  const gap = Math.min(2, bw * 0.2);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  const steps = max % 4 === 0 ? 4 : 5; // keep tick labels whole numbers
  for (let i = 0; i <= steps; i++) {
    const v = (max / steps) * i;
    s += `<line class="grid" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
  }
  items.forEach((d, i) => {
    const x = L + i * bw;
    const top = y(d.value), h = H - B - top;
    if (d.value > 0) s += `<path class="bar${d.hi === false ? " lo" : ""}" d="${roundTop(x + gap / 2, top, bw - gap, h, Math.min(4, (bw - gap) / 2))}"/>`;
    s += `<rect class="hit" x="${x}" y="${T}" width="${bw}" height="${H - T - B}" data-tip="${esc(d.tip)}"/>`;
    if (d.tick) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.tick)}</text>`;
  });
  el.innerHTML = s + "</svg>";
}

// Horizontal ranked bars with the value at the end (hi: false greys a bar out, as above).
// scaleTo keeps the scale fixed while the values grow (the Einsatzradius playback).
export function barList(el, items, { labelWidth = 170, scaleTo = 1 } = {}) {
  const W = el.clientWidth || 1000, R = 40;
  const max = Math.max(scaleTo, ...items.map((d) => d.value));
  // Labels left of the bars; if one doesn't fit (long keyword names on a phone), each label goes above its bar.
  const draw = (stacked) => {
    const row = stacked ? 38 : 26, L = stacked ? 0 : Math.min(labelWidth, W * 0.5), top = stacked ? 18 : 3;
    const H = items.length * row + 4;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    items.forEach((d, i) => {
      const y = i * row + 4, w = ((W - L - R) * d.value) / max;
      s += stacked ? `<text class="lbl" x="0" y="${y + 12}">${esc(d.label)}</text>`
        : `<text class="lbl" x="${L - 8}" y="${y + 15}" text-anchor="end">${esc(d.label)}</text>`;
      s += `<path class="bar${d.hi === false ? " lo" : ""}" d="${roundRight(L, y + top, w, stacked ? 14 : row - 8, 4)}"/>`;
      s += `<text x="${L + w + 6}" y="${y + top + (stacked ? 11 : 12)}">${d.display ?? d.value}</text>`;
      s += `<rect class="hit" x="0" y="${y}" width="${W}" height="${row}" data-tip="${esc(d.tip)}"/>`;
    });
    el.innerHTML = s + "</svg>";
    return L;
  };
  const L = draw(false);
  const scale = el.querySelector("svg").getBoundingClientRect().width / W || 1;
  if ([...el.querySelectorAll(".lbl")].some((t) => t.getBoundingClientRect().width / scale > L - 10)) draw(true);
}

function roundTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function roundRight(x, y, w, h, r) {
  r = Math.min(r, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

// Sequential blue ramp, light to dark (dark mode flips so "more" stays more visible).
// Darker = more in both modes, like the ring on "Einsatz heute?" (Reagan's choice).
export function rampColors() {
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  return dark
    ? ["var(--empty)", "#cde2fb", "#86b6ef", "#3987e5", "#256abf", "#184f95"]
    : ["var(--empty)", "#b7d3f6", "#6da7ec", "#2a78d6", "#1c5cab", "#0d366b"];
}
// The colour key under a heat chart (components/Legend.jsx draws the same in the tabs that are React components).
export function legend(labels, colors) {
  return `<div class="legend">${labels.map((l, i) => `<i style="background:${colors[i]}"></i>${esc(l)}`).join(" ")}</div>`;
}
