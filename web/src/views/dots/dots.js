// Punktewand: every alarm is one dot, coloured by its type. Switching the grouping moves each dot to its
// new place. Which colour and which group a dot gets: dotKind and dotGroups in lib/places.js.

import { WEEKDAYS, WEEKDAYS_LONG, parseDate, weekday, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze } from "../../lib/text.js";
import { dotKind, dotGroups, DOT_ORDER } from "../../lib/places.js";
import { $ } from "../../dom.js";
import "./dots.css";

let dotsBy = "month";
let dotsRows = [];     // the alarms currently drawn, in dot order
let dotsPicked = null; // the tapped alarm

// Where each dot goes: columns for month and hour (time runs left to right), rows for type and district.
function dotLayout(rows, by, W) {
  const s = W < 600 ? 7 : 9;
  const groups = dotGroups(rows, by);
  for (const g of groups) g.rows.sort((a, b) => DOT_ORDER.indexOf(dotKind(a)) - DOT_ORDER.indexOf(dotKind(b)) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const pos = new Map();
  let labels = "", H;
  if (by === "month" || by === "hour") {
    const cw = W / groups.length, per = Math.max(1, Math.floor((cw - 3) / s)), T = 18, B = 22;
    const high = Math.max(1, ...groups.map((g) => Math.ceil(g.rows.length / per)));
    H = T + high * s + B;
    groups.forEach((g, k) => {
      const x0 = k * cw + (cw - per * s) / 2;
      g.rows.forEach((r, j) => pos.set(r, [x0 + (j % per) * s + s / 2, T + (high - Math.floor(j / per) - 1) * s + s / 2]));
      const top = T + (high - Math.ceil(g.rows.length / per)) * s - 5;
      if (g.rows.length && cw >= 22) labels += `<text x="${(k + 0.5) * cw}" y="${top}" text-anchor="middle" class="count">${g.rows.length}</text>`; // narrow columns: in the tooltip only
      if (by === "month" || W >= 600 || k % 3 === 0 || g.label === "?") labels += `<text x="${(k + 0.5) * cw}" y="${H - 5}" text-anchor="middle">${g.label}</text>`;
    });
  } else {
    const Lw = Math.min(180, Math.round(W * 0.36)), R = 34, per = Math.max(1, Math.floor((W - Lw - R) / s)), gap = 10;
    let y = 4;
    for (const g of groups) {
      g.rows.forEach((r, j) => pos.set(r, [Lw + (j % per) * s + s / 2, y + Math.floor(j / per) * s + s / 2]));
      labels += `<text x="${Lw - 8}" y="${y + s / 2 + 4}" text-anchor="end">${esc(g.label)}</text>` +
        `<text x="${Lw + Math.min(g.rows.length, per) * s + 6}" y="${y + s / 2 + 4}" class="count">${g.rows.length}</text>`;
      y += Math.max(1, Math.ceil(g.rows.length / per)) * s + gap;
    }
    H = y;
  }
  return { pos, labels, H, r: s * 0.38 };
}

export function renderDots(rows) {
  const el = $("#c-dots");
  if (!el.offsetWidth) return; // drawn when the view opens
  const W = el.clientWidth;
  const { pos, labels, H, r } = dotLayout(rows, dotsBy, W);
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${einsaetze(rows.length)} als Punkte"><g class="dot-labels">${labels}</g><g class="dots">`;
  rows.forEach((a, i) => {
    const [x, y] = pos.get(a);
    const tip = `<b>${WEEKDAYS[weekday(parseDate(a.date))]}, ${fmtDate(a.date)}</b>${a.timeUnknown ? "" : `, ${esc(a.time)} Uhr`}<br>` +
      `${esc(a.keyword)} · ${esc(a.name)}<br>${esc(a.event)}<br>${esc([a.street, a.district].filter(Boolean).join(", "))}`;
    svg += `<circle class="dot ${dotKind(a)}${a === dotsPicked ? " on" : ""}" r="${r.toFixed(1)}" data-i="${i}" style="transform:translate(${x.toFixed(1)}px,${y.toFixed(1)}px);--d:${(i * 37) % 400}ms" data-tip="${esc(tip)}"/>`;
  });
  el.innerHTML = svg + "</g></svg>";
  dotsRows = rows;
  if (!rows.includes(dotsPicked)) dotsPicked = null;
  dotsDetail();
}

// Regroup without redrawing, so each dot moves from its old place to the new one.
function regroupDots(by) {
  dotsBy = by;
  document.querySelectorAll("#dots-by button").forEach((b) => b.classList.toggle("active", b.dataset.by === by));
  const el = $("#c-dots"), svg = el.querySelector("svg");
  if (!svg) return;
  const W = el.clientWidth;
  const { pos, labels, H } = dotLayout(dotsRows, by, W);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  svg.querySelector(".dot-labels").innerHTML = labels;
  svg.querySelectorAll(".dot").forEach((c) => {
    const [x, y] = pos.get(dotsRows[c.dataset.i]);
    c.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  });
}

function dotsDetail() {
  const a = dotsPicked;
  $("#dots-detail").innerHTML = a
    ? `<b>${WEEKDAYS_LONG[weekday(parseDate(a.date))]}, ${fmtDate(a.date)}${a.timeUnknown ? "" : `, ${esc(a.time)} Uhr`}</b> · ` +
      `${esc(a.keyword)} ${esc(a.name)} · ${esc(a.event)} · ${esc([a.street, a.district].filter(Boolean).join(", "))}`
    : "Einen Punkt antippen, um den Einsatz zu sehen.";
}

$("#dots-by").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) regroupDots(b.dataset.by); });
$("#c-dots").addEventListener("click", (e) => {
  const c = e.target.closest(".dot");
  $("#c-dots").querySelectorAll(".dot.on").forEach((d) => d.classList.remove("on"));
  dotsPicked = c ? dotsRows[c.dataset.i] : null;
  if (c) c.classList.add("on");
  dotsDetail();
});
