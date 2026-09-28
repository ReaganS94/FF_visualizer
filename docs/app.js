"use strict";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const BIG_DAY = 10;       // a day with this many alarms or more counts as a Großlage (e.g. storm)
const DAY_START = 6;      // "tagsüber" = 06:00–21:59, "nachts" = 22:00–05:59
const NIGHT_START = 22;

let ALL = [];             // cleaned alarms
let UPDATED = new Date(); // when the data was last scraped
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- dates (all local time, data is Hannover time) ----------
const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
const weekday = (dt) => (dt.getDay() + 6) % 7; // Monday = 0
const fmtDate = (iso) => iso.split("-").reverse().join(".");

// ---------- load & clean ----------
function clean(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r.category !== "Einsatz") continue;
    // The site sometimes lists one alarm twice with slightly different remarks.
    const k = [r.date, r.time, r.keyword, r.street].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    const base = r.keyword.split("/")[0].trim().toLowerCase() || "?";
    out.push({ ...r, base, standby: base === "vs", hour: Number(r.time.slice(0, 2)) });
  }
  const perDay = {};
  for (const r of out) if (!r.standby) perDay[r.date] = (perDay[r.date] || 0) + 1;
  for (const r of out) {
    r.bigDay = perDay[r.date] >= BIG_DAY;
    r.timeUnknown = r.bigDay && r.time === "00:00"; // bulk-entered with a placeholder time
  }
  return out;
}

function selection() {
  const year = $("#f-year").value;
  const standby = $("#f-standby").checked;
  const storm = $("#f-storm").checked;
  return ALL.filter((r) =>
    (!year || r.date.startsWith(year)) && (standby || !r.standby) && (storm || !r.bigDay));
}

// ---------- tooltip ----------
const tip = $("#tip");
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.dataset.tip;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 14 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
});

// ---------- chart helpers ----------
function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// Vertical bars. items: [{label, value, tip, tick}]
function columnChart(el, items, { height = 220 } = {}) {
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
    if (d.value > 0) s += `<path class="bar" d="${roundTop(x + gap / 2, top, bw - gap, h, Math.min(4, (bw - gap) / 2))}"/>`;
    s += `<rect class="hit" x="${x}" y="${T}" width="${bw}" height="${H - T - B}" data-tip="${esc(d.tip)}"/>`;
    if (d.tick) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.tick)}</text>`;
  });
  el.innerHTML = s + "</svg>";
}

// Horizontal ranked bars with the value at the end.
function barList(el, items) {
  const W = el.clientWidth || 1000, row = 26, L = Math.min(170, W * 0.38), R = 40;
  const H = items.length * row + 4;
  const max = Math.max(1, ...items.map((d) => d.value));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  items.forEach((d, i) => {
    const y = i * row + 4, w = ((W - L - R) * d.value) / max;
    s += `<text x="${L - 8}" y="${y + 15}" text-anchor="end">${esc(d.label)}</text>`;
    s += `<path class="bar" d="${roundRight(L, y + 3, w, row - 8, 4)}"/>`;
    s += `<text x="${L + w + 6}" y="${y + 15}">${d.value}</text>`;
    s += `<rect class="hit" x="0" y="${y}" width="${W}" height="${row}" data-tip="${esc(d.tip)}"/>`;
  });
  el.innerHTML = s + "</svg>";
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
function rampColors() {
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  return dark
    ? ["var(--empty)", "#184f95", "#256abf", "#3987e5", "#86b6ef", "#cde2fb"]
    : ["var(--empty)", "#b7d3f6", "#6da7ec", "#2a78d6", "#1c5cab", "#0d366b"];
}
function legend(labels, colors) {
  return `<div class="legend">${labels.map((l, i) => `<i style="background:${colors[i]}"></i>${esc(l)}`).join(" ")}</div>`;
}

// ---------- views ----------
function renderOverview(rows) {
  const tiles = [];
  const days = rows.length ? (parseDate(rows[0].date) - parseDate(rows[rows.length - 1].date)) / 864e5 + 1 : 0;
  const night = rows.filter((r) => !r.timeUnknown && (r.hour >= NIGHT_START || r.hour < DAY_START)).length;
  const known = rows.filter((r) => !r.timeUnknown).length;
  tiles.push(["Einsätze", rows.length, "in der Auswahl"]);
  tiles.push(["Ø pro Woche", days ? (rows.length / (days / 7)).toFixed(1).replace(".", ",") : "–", "über den gewählten Zeitraum"]);
  tiles.push(["Nachts", known ? Math.round((100 * night) / known) + " %" : "–", "zwischen 22 und 6 Uhr"]);
  tiles.push(["Letzter Einsatz", rows.length ? fmtDate(rows[0].date) : "–", rows.length ? esc(rows[0].event) : ""]);
  $("#tiles").innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");

  if (!rows.length) { $("#c-months").innerHTML = ""; return; }
  const counts = {};
  for (const r of rows) counts[r.date.slice(0, 7)] = (counts[r.date.slice(0, 7)] || 0) + 1;
  const first = parseDate(rows[rows.length - 1].date), last = parseDate(rows[0].date);
  const items = [];
  const narrow = $("#c-months").clientWidth < 600;
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const k = isoDate(d).slice(0, 7), m = d.getMonth();
    const n = counts[k] || 0;
    const tick = narrow ? (m === 0 ? String(d.getFullYear()) : "")
      : m === 0 || items.length === 0 ? `${MONTHS[m]} ${d.getFullYear()}` : m % 3 === 0 ? MONTHS[m] : "";
    items.push({ value: n, tip: `${MONTHS[m]} ${d.getFullYear()}: <b>${n}</b> Einsätze`, tick });
  }
  columnChart($("#c-months"), items);
}

function renderCalendar(rows) {
  const colors = rampColors();
  const bin = (n) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : n < BIG_DAY ? 4 : 5);
  const perDay = {};
  for (const r of rows) (perDay[r.date] ||= []).push(r);
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const C = 18, G = 3, L = 26, T = 16;
  let html = "";
  for (const y of years) {
    const jan1 = new Date(Number(y), 0, 1);
    const off = weekday(jan1);
    let s = `<svg viewBox="0 0 ${L + 54 * (C + G)} ${T + 7 * (C + G)}" role="img">`;
    WEEKDAYS.forEach((w, i) => { if (i % 2 === 0) s += `<text x="0" y="${T + i * (C + G) + 13}">${w}</text>`; });
    for (let d = jan1; d.getFullYear() === Number(y); d = addDays(d, 1)) {
      const doy = Math.round((d - jan1) / 864e5);
      const col = Math.floor((doy + off) / 7), row = weekday(d);
      if (d.getDate() === 1) s += `<text x="${L + col * (C + G)}" y="11">${MONTHS[d.getMonth()]}</text>`;
      const list = perDay[isoDate(d)] || [];
      const tipText = `<b>${fmtDate(isoDate(d))}</b> · ${list.length} Einsätze` +
        list.slice(0, 6).map((r) => `<br>${esc(r.time)} ${esc(r.keyword)} – ${esc(r.event)}`).join("") +
        (list.length > 6 ? `<br>… und ${list.length - 6} weitere` : "");
      s += `<rect class="cell" x="${L + col * (C + G)}" y="${T + row * (C + G)}" width="${C}" height="${C}" rx="3" fill="${colors[bin(list.length)]}" data-tip="${tipText}"/>`;
    }
    html += `<div class="year-label">${y}</div>${s}</svg>`;
  }
  html += legend(["0", "1", "2", "3–4", `5–${BIG_DAY - 1}`, `${BIG_DAY}+ (Großlage)`], colors);
  $("#c-calendar").innerHTML = html;
}

function renderHours(rows) {
  const known = rows.filter((r) => !r.timeUnknown);
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of known) grid[weekday(parseDate(r.date))][r.hour]++;
  const max = Math.max(1, ...grid.flat());
  const colors = rampColors();
  const level = (n) => (n === 0 ? 0 : 1 + Math.min(4, Math.floor((n / max) * 5 - 1e-9)));
  const C = 36, G = 3, L = 30, T = 18;
  let s = `<svg viewBox="0 0 ${L + 24 * (C + G)} ${T + 7 * (C + G)}" role="img">`;
  for (let h = 0; h < 24; h += 3) s += `<text x="${L + h * (C + G) + C / 2}" y="12" text-anchor="middle">${h} Uhr</text>`;
  grid.forEach((line, w) => {
    s += `<text x="0" y="${T + w * (C + G) + C / 2 + 4}">${WEEKDAYS[w]}</text>`;
    line.forEach((n, h) => {
      s += `<rect class="cell" x="${L + h * (C + G)}" y="${T + w * (C + G)}" width="${C}" height="${C}" rx="3" fill="${colors[level(n)]}" data-tip="${WEEKDAYS_LONG[w]}, ${h}–${h + 1} Uhr: <b>${n}</b> Einsätze"/>`;
    });
  });
  $("#c-heat").innerHTML = s + "</svg>" + legend(["0", "", "", "", "", `${max} (Maximum)`], colors);

  const hours = Array(24).fill(0);
  for (const r of known) hours[r.hour]++;
  columnChart($("#c-hours"), hours.map((n, h) => ({ value: n, tip: `${h}–${h + 1} Uhr: <b>${n}</b> Einsätze`, tick: h % 3 === 0 ? `${h}` : "" })), { height: 180 });
}

function topCounts(rows, key, n = 15) {
  const c = {};
  for (const r of rows) { const k = key(r) || "unbekannt"; (c[k] ||= []).push(r); }
  return Object.entries(c).sort((a, b) => b[1].length - a[1].length).slice(0, n);
}

function renderKeywords(rows) {
  barList($("#c-keywords"), topCounts(rows, (r) => r.base).map(([k, list]) => {
    const events = topCounts(list, (r) => r.event, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: k, value: list.length, tip: `<b>${esc(k)}</b> · ${list.length} Einsätze<br>${events}` };
  }));
}

function renderDistricts(rows) {
  barList($("#c-districts"), topCounts(rows, (r) => r.district, 20).map(([k, list]) => {
    const streets = topCounts(list, (r) => r.street, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: k, value: list.length, tip: `<b>${esc(k)}</b> · ${list.length} Einsätze<br>${streets}` };
  }));
}

function renderList(rows) {
  const q = $("#q").value.trim().toLowerCase();
  const hits = q ? rows.filter((r) => [r.keyword, r.event, r.street, r.district, r.remarks].join(" ").toLowerCase().includes(q)) : rows;
  $("#list-count").textContent = `${hits.length} Einsätze`;
  $("#t-list tbody").innerHTML = hits.map((r) =>
    `<tr><td>${fmtDate(r.date)}</td><td>${r.timeUnknown ? "?" : esc(r.time)}</td><td>${esc(r.keyword)}</td><td>${esc(r.event)}</td><td>${esc(r.street)}</td><td>${esc(r.district)}</td></tr>`).join("");
}

// ---------- "Einsatz heute?" ----------
// Share of comparable past days (same weekday, month within ±1) that had at least one alarm
// in the window. Deliberately simple so anyone can check it by hand.
function renderChance() {
  const alarms = ALL.filter((r) => !r.standby);
  const inDay = new Set(), inNight = new Set();
  for (const r of alarms) {
    const d = parseDate(r.date);
    if (r.timeUnknown || (r.hour >= DAY_START && r.hour < NIGHT_START)) inDay.add(r.date);
    else if (r.hour >= NIGHT_START) inNight.add(r.date);
    else inNight.add(isoDate(addDays(d, -1))); // 00:00–05:59 belongs to the previous evening's night
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = parseDate(alarms[alarms.length - 1].date);
  // Only count days the data fully covers: yesterday's night ends this morning, and days after the
  // last scrape would otherwise look alarm-free.
  const scraped = new Date(UPDATED); scraped.setHours(0, 0, 0, 0);
  const lastComplete = addDays(scraped < today ? scraped : today, -2);
  const monthDist = (a, b) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));

  function estimate(strict) {
    const days = [];
    for (let d = first; d <= lastComplete; d = addDays(d, 1)) {
      if (weekday(d) !== weekday(today)) continue;
      if (strict && monthDist(d.getMonth(), today.getMonth()) > 1) continue;
      days.push(isoDate(d));
    }
    return {
      n: days.length,
      day: days.filter((d) => inDay.has(d)).length,
      night: days.filter((d) => inNight.has(d)).length,
    };
  }
  let est = estimate(true), scope = `${WEEKDAYS_LONG[weekday(today)]}e im ${MONTHS[(today.getMonth() + 11) % 12]}–${MONTHS[(today.getMonth() + 1) % 12]}`;
  if (est.n < 20) { est = estimate(false); scope = `alle ${WEEKDAYS_LONG[weekday(today)]}e`; }
  const pct = (k) => (est.n ? Math.round((100 * k) / est.n) : 0);

  $("#chance").innerHTML = [
    ["Heute tagsüber", "06–22 Uhr", est.day],
    ["Heute Nacht", "22–6 Uhr", est.night],
  ].map(([l, w, k]) => `<div class="tile"><div class="l">${l} (${w})</div><div class="v">~${pct(k)} %</div><div class="d">an ${k} von ${est.n} vergleichbaren Tagen gab es mindestens einen Einsatz</div></div>`).join("");
  $("#chance-method").textContent =
    `So wird gerechnet: Vergleichbare Tage sind ${scope} seit ${fmtDate(isoDate(first))}. ` +
    `Gezählt wird, an wie vielen davon im jeweiligen Zeitfenster mindestens ein Einsatz war. ` +
    `Wachbesetzungen zählen nicht. Mit nur wenigen Jahren Daten schwankt diese Zahl stark.`;
}

// ---------- wiring ----------
function render() {
  const rows = selection();
  renderOverview(rows);
  renderCalendar(rows);
  renderHours(rows);
  renderKeywords(rows);
  renderDistricts(rows);
  renderList(rows);
}

function showView(v) {
  document.querySelectorAll("[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
  $("#filters").style.display = v === "chance" ? "none" : "";
  try { localStorage.setItem("view", v); } catch {}
  if (ALL.length) render(); // hidden sections have no width, so draw charts once visible
}

fetch("data/alarms.json")
  .then((r) => r.json())
  .then((data) => {
    ALL = clean(data.rows);
    UPDATED = new Date(data.updated);
    $("#updated").textContent = new Date(data.updated).toLocaleDateString("de-DE");
    const years = [...new Set(ALL.map((r) => r.date.slice(0, 4)))].sort().reverse();
    $("#f-year").innerHTML += years.map((y) => `<option>${y}</option>`).join("");
    document.querySelectorAll("#filters input, #filters select").forEach((el) => el.addEventListener("change", render));
    $("#q").addEventListener("input", () => renderList(selection()));
    document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
    let v = "overview";
    try { v = localStorage.getItem("view") || v; } catch {}
    showView(v);
    render();
    renderChance();
    let resize;
    window.addEventListener("resize", () => { clearTimeout(resize); resize = setTimeout(render, 150); });
  });
