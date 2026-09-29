"use strict";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const BIG_DAY = 10;       // a day with this many alarms or more counts as a Großlage (e.g. storm)
const DAY_START = 6;      // "tagsüber" = 06:00–21:59, "nachts" = 22:00–05:59
const NIGHT_START = 22;

let ALL = [];             // cleaned alarms
let KW = { groups: {}, codes: {} }; // keyword names, from data/keywords.json
let GEO = {};             // "street|district" -> [lat, lon], from data/geo.json
let WEATHER = {};         // "YYYY-MM-DD" -> {tmax, tmin, rain, gust}, from data/weather.json
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
// A manual entry (admin page) is dropped once the website lists the same alarm: same day and
// keyword, time within an hour. Until then it fills the gap.
function mergeManual(scraped, manual) {
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const base = (k) => k.split("/")[0].trim().toLowerCase();
  const pending = manual.filter((m) => !scraped.some((r) =>
    r.date === m.date && base(r.keyword) === base(m.keyword) && Math.abs(minutes(r.time) - minutes(m.time)) <= 60));
  return [...scraped, ...pending.map((m) => ({ ...m, manual: true }))]
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

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
    const info = KW.codes[base] || {};
    out.push({
      ...r, base, standby: base === "vs", hour: Number(r.time.slice(0, 2)),
      name: info.name || base, group: KW.groups[info.group] || "Unbekannt",
    });
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
function barList(el, items, { labelWidth = 170 } = {}) {
  const W = el.clientWidth || 1000, row = 26, L = Math.min(labelWidth, W * 0.5), R = 40;
  const H = items.length * row + 4;
  const max = Math.max(1, ...items.map((d) => d.value));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  items.forEach((d, i) => {
    const y = i * row + 4, w = ((W - L - R) * d.value) / max;
    s += `<text x="${L - 8}" y="${y + 15}" text-anchor="end">${esc(d.label)}</text>`;
    s += `<path class="bar" d="${roundRight(L, y + 3, w, row - 8, 4)}"/>`;
    s += `<text x="${L + w + 6}" y="${y + 15}">${d.display ?? d.value}</text>`;
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
  barList($("#c-groups"), topCounts(rows, (r) => r.group).map(([g, list]) => {
    const codes = topCounts(list, (r) => r.base, 4).map(([c, l]) => `${esc(c)} ${esc(l[0].name)} (${l.length})`).join("<br>");
    return { label: g, value: list.length, tip: `<b>${esc(g)}</b> · ${list.length} Einsätze<br>${codes}` };
  }));
  barList($("#c-keywords"), topCounts(rows, (r) => r.base).map(([k, list]) => {
    const events = topCounts(list, (r) => r.event, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: `${k} · ${list[0].name}`, value: list.length, tip: `<b>${esc(k)}</b> ${esc(list[0].name)} · ${list.length} Einsätze<br>${events}` };
  }), { labelWidth: 330 });
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
    `<tr><td>${fmtDate(r.date)}</td><td>${r.timeUnknown ? "?" : esc(r.time)}</td><td title="${esc(r.name)}">${esc(r.keyword)}</td><td>${esc(r.event)}</td><td>${esc(r.street)}</td><td>${esc(r.district)}</td></tr>`).join("");
}

// ---------- "Einsatz heute?" ----------
// Share of comparable past days (same weekday, month within ±1) that had at least one alarm
// in the window. Deliberately simple so anyone can check it by hand.
const MIN_DAYS = 20;
const PRIOR = 10;
const monthDist = (a, b) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));

function alarmWindows() {
  const inDay = new Set(), inNight = new Set();
  for (const r of ALL) {
    if (r.standby) continue;
    if (r.timeUnknown || (r.hour >= DAY_START && r.hour < NIGHT_START)) inDay.add(r.date);
    else if (r.hour >= NIGHT_START) inNight.add(r.date);
    else inNight.add(isoDate(addDays(parseDate(r.date), -1))); // 00:00–05:59 belongs to the previous evening's night
  }
  return { inDay, inNight };
}

// Uses only days from `first` to `last`, so the backtest can hide the future from itself.
function estimate(target, first, last, win) {
  const pick = (strict) => {
    const days = [];
    // walk back from `last` to the newest same weekday, then in weekly steps
    let d = addDays(last, -((weekday(last) - weekday(target) + 7) % 7));
    for (; d >= first; d = addDays(d, -7)) {
      if (!strict || monthDist(d.getMonth(), target.getMonth()) <= 1) days.push(isoDate(d));
    }
    return days;
  };
  let strict = true, days = pick(true);
  if (days.length < MIN_DAYS) { strict = false; days = pick(false); }
  // With only ~30 comparable days a single lucky week swings the result a lot, so blend in the
  // rate over all days (as if we had seen PRIOR extra average days). The backtest showed this helps.
  let total = 0, totDay = 0, totNight = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const k = isoDate(d);
    total++; totDay += win.inDay.has(k); totNight += win.inNight.has(k);
  }
  const blend = (hits, base) => (days.length + PRIOR ? (hits + PRIOR * base) / (days.length + PRIOR) : 0);
  const day = days.filter((d) => win.inDay.has(d)).length;
  const night = days.filter((d) => win.inNight.has(d)).length;
  return {
    strict, n: days.length, day, night,
    pDay: blend(day, totDay / total), pNight: blend(night, totNight / total),
  };
}

// Would the page have been right? Replays the estimate for every past day using only older data.
function backtest(first, last, win) {
  const bins = [[0, 10], [10, 20], [20, 30], [30, 40], [40, 101]].map(([lo, hi]) => ({ lo, hi, n: 0, hit: 0, sum: 0 }));
  let n = 0;
  for (let t = addDays(first, 182); t <= last; t = addDays(t, 1)) {
    const e = estimate(t, first, addDays(t, -2), win);
    if (!e.n) continue;
    for (const [k, set, day] of [["day", win.inDay, isoDate(t)], ["night", win.inNight, isoDate(t)]]) {
      const p = 100 * e[k === "day" ? "pDay" : "pNight"];
      const b = bins.find((b) => p >= b.lo && p < b.hi);
      b.n++; b.sum += p; if (set.has(day)) b.hit++;
      n++;
    }
  }
  return { bins: bins.filter((b) => b.n), n };
}

function renderChance() {
  const win = alarmWindows();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = parseDate(ALL[ALL.length - 1].date);
  // Only count days the data fully covers: yesterday's night ends this morning, and days after the
  // last scrape would otherwise look alarm-free.
  const scraped = new Date(UPDATED); scraped.setHours(0, 0, 0, 0);
  const last = addDays(scraped < today ? scraped : today, -2);

  const est = estimate(today, first, last, win);
  const scope = est.strict
    ? `${WEEKDAYS_LONG[weekday(today)]}e im ${MONTHS[(today.getMonth() + 11) % 12]}–${MONTHS[(today.getMonth() + 1) % 12]}`
    : `alle ${WEEKDAYS_LONG[weekday(today)]}e`;
  $("#chance").innerHTML = [
    ["Heute tagsüber", "06–22 Uhr", est.day, est.pDay],
    ["Heute Nacht", "22–6 Uhr", est.night, est.pNight],
  ].map(([l, w, k, p]) => `<div class="tile"><div class="l">${l} (${w})</div><div class="v">~${Math.round(100 * p)} %</div><div class="d">an ${k} von ${est.n} vergleichbaren Tagen gab es mindestens einen Einsatz</div></div>`).join("");
  $("#chance-method").textContent =
    `So wird gerechnet: Vergleichbare Tage sind ${scope} seit ${fmtDate(isoDate(first))}. ` +
    `Gezählt wird, an wie vielen davon im jeweiligen Zeitfenster mindestens ein Einsatz war. ` +
    `Weil das nur wenige Tage sind, wird der Wert etwas zum Durchschnitt aller Tage hin ausgeglichen ` +
    `(so, als kämen ${PRIOR} durchschnittliche Tage dazu). Wachbesetzungen zählen nicht.`;

  const w = WEATHER[isoDate(today)];
  const warn = w && (w.gust >= 60 || w.rain >= 20);
  $("#chance-weather").hidden = !warn;
  if (warn) {
    $("#chance-weather").textContent = `Wetter heute laut Vorhersage: Böen bis ${Math.round(w.gust)} km/h, ${w.rain.toFixed(1).replace(".", ",")} mm Regen. ` +
      `Bei solchem Wetter gab es bisher deutlich mehr Einsätze als sonst (siehe Ansicht „Wetter“). Die Zahlen oben berücksichtigen das nicht.`;
  }

  const bt = backtest(first, last, win);
  $("#t-backtest tbody").innerHTML = bt.bins.map((b) =>
    `<tr><td>${b.hi > 100 ? `ab ${b.lo}` : `${b.lo}–${b.hi}`} %</td><td>${b.n}</td><td>${Math.round((100 * b.hit) / b.n)} %</td></tr>`).join("");
  $("#backtest-note").textContent =
    `Für jeden Tag und jede Nacht ab ${fmtDate(isoDate(addDays(first, 182)))} wurde nachgerechnet, was die Seite ` +
    `damals nur mit älteren Daten geschätzt hätte (${bt.n} Schätzungen). Eine gute Schätzung liegt in jeder Zeile ` +
    `ungefähr im Bereich der linken Spalte.`;
}

// ---------- Jahresrückblick ----------
// Keywords worth listing individually in the annual report.
const NOTABLE = /^(b2|b3|ob|ba2|bg2|abc2|hm2|hm3|hw\d|hu\d|manv\d*)$/;

function renderYear() {
  const year = $("#y-year").value;
  const alarms = ALL.filter((r) => !r.standby);
  const rows = alarms.filter((r) => r.date.startsWith(year));
  const prev = alarms.filter((r) => r.date.startsWith(String(year - 1)));
  const lastDate = rows.length ? rows[0].date : "";
  const partial = lastDate && lastDate < `${year}-12-01`;
  // Compare a running year with the same period of the previous year.
  const prevSame = partial ? prev.filter((r) => r.date.slice(5) <= lastDate.slice(5)) : prev;

  const byDay = topCounts(rows, (r) => r.date, 1)[0];
  const byMonth = topCounts(rows, (r) => r.date.slice(5, 7), 1)[0];
  const known = rows.filter((r) => !r.timeUnknown);
  const night = known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length;
  const delta = prevSame.length ? Math.round((100 * (rows.length - prevSame.length)) / prevSame.length) : null;
  const tiles = [
    ["Einsätze", rows.length, prevSame.length ? `${delta >= 0 ? "+" : ""}${delta} % gegenüber ${year - 1}${partial ? " (gleicher Zeitraum)" : ""}` : ""],
    ["Stärkster Tag", byDay ? fmtDate(byDay[0]) : "–", byDay ? `${byDay[1].length} Einsätze` : ""],
    ["Stärkster Monat", byMonth ? MONTHS[Number(byMonth[0]) - 1] : "–", byMonth ? `${byMonth[1].length} Einsätze` : ""],
    ["Nachts", known.length ? Math.round((100 * night) / known.length) + " %" : "–", "zwischen 22 und 6 Uhr"],
  ];
  $("#y-tiles").innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");
  $("#y-partial").textContent = partial ? `Das Jahr ${year} läuft noch: Daten bis ${fmtDate(lastDate)}.` : "";

  const months = Array(12).fill(0);
  for (const r of rows) months[Number(r.date.slice(5, 7)) - 1]++;
  columnChart($("#y-months"), months.map((n, m) => ({ value: n, tip: `${MONTHS[m]} ${year}: <b>${n}</b> Einsätze`, tick: MONTHS[m] })), { height: 180 });

  const prevGroups = {};
  for (const r of prevSame) prevGroups[r.group] = (prevGroups[r.group] || 0) + 1;
  barList($("#y-groups"), topCounts(rows, (r) => r.group).map(([g, list]) => ({
    label: g, value: list.length, tip: `<b>${esc(g)}</b>: ${list.length} Einsätze<br>${year - 1}${partial ? " (gleicher Zeitraum)" : ""}: ${prevGroups[g] || 0}`,
  })));

  const notable = rows.filter((r) => NOTABLE.test(r.base) || /presseportal/.test(r.remarks));
  $("#y-notable tbody").innerHTML = notable.map((r) =>
    `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.name)}</td><td>${esc(r.event)}</td><td>${esc(r.street)}, ${esc(r.district)}</td></tr>`).join("")
    || `<tr><td colspan="4">Keine</td></tr>`;
}

// ---------- Karte ----------
let map, heat;

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}

async function renderMap(rows) {
  const el = $("#c-map");
  const points = [];
  let missing = 0;
  for (const r of rows) {
    const p = GEO[`${r.street}|${r.district}`];
    if (p) points.push([p[0], p[1], 1]); else missing++;
  }
  $("#map-note").textContent = Object.keys(GEO).length
    ? `${points.length} Einsätze auf der Karte. ${missing} ohne bekannte Adresse (z. B. Autobahn) fehlen.`
    : "Die Adressen werden beim nächsten täglichen Update-Lauf nachgeschlagen, danach erscheint hier die Karte.";
  el.hidden = !points.length;
  if (!points.length || !el.offsetWidth) {
    // A heat layer on a hidden map has zero size and throws on redraw, so drop it until visible.
    if (heat) { map.removeLayer(heat); heat = null; }
    return;
  }
  if (!window.L) {
    await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    await loadScript("https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js");
  }
  if (!map) {
    map = L.map(el).setView([52.37, 9.73], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  map.invalidateSize();
  if (heat) map.removeLayer(heat);
  // One warm hue from faint to strong; brighter = more alarms nearby.
  heat = L.heatLayer(points, {
    radius: 22, blur: 18, minOpacity: 0.25, max: 4,
    gradient: { 0.2: "#fde2c4", 0.45: "#f7a35c", 0.7: "#e4572e", 1: "#a3160d" },
  }).addTo(map);
}

// ---------- Wetter ----------
const WEATHER_BUCKETS = [
  ["Windböen", "gust", [[0, 40, "unter 40 km/h"], [40, 60, "40–60 km/h"], [60, 80, "60–80 km/h"], [80, 999, "ab 80 km/h"]]],
  ["Niederschlag", "rain", [[0, 0.1, "trocken"], [0.1, 5, "bis 5 mm"], [5, 20, "5–20 mm"], [20, 999, "über 20 mm"]]],
  ["Höchsttemperatur", "tmax", [[-99, 0, "unter 0 °C"], [0, 10, "0–10 °C"], [10, 20, "10–20 °C"], [20, 30, "20–30 °C"], [30, 99, "ab 30 °C"]]],
];

function renderWeather(rows) {
  const box = $("#c-weather");
  const days = Object.keys(WEATHER);
  if (!days.length) {
    box.innerHTML = `<p class="note">Die Wetterdaten werden beim nächsten täglichen Update-Lauf geladen.</p>`;
    return;
  }
  const perDay = {};
  for (const r of rows) perDay[r.date] = (perDay[r.date] || 0) + 1;
  const first = rows.length ? rows[rows.length - 1].date : "";
  const last = isoDate(addDays(UPDATED, -1));
  const covered = days.filter((d) => d >= first && d <= last);
  box.innerHTML = WEATHER_BUCKETS.map(([title, , ], i) => `<h2>${title}</h2><div class="chart" id="c-weather-${i}"></div>`).join("");
  WEATHER_BUCKETS.forEach(([title, field, buckets], i) => {
    barList($(`#c-weather-${i}`), buckets.map(([lo, hi, label]) => {
      const ds = covered.filter((d) => WEATHER[d][field] >= lo && WEATHER[d][field] < hi);
      const n = ds.reduce((a, d) => a + (perDay[d] || 0), 0);
      const avg = ds.length ? n / ds.length : 0;
      return {
        label, value: Math.round(avg * 100) / 100, display: ds.length ? avg.toFixed(2).replace(".", ",") : "keine Tage",
        tip: `<b>${label}</b><br>${ds.length} Tage, ${n} Einsätze<br>Ø ${avg.toFixed(2).replace(".", ",")} pro Tag`,
      };
    }));
  });
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
  renderYear();
  renderMap(rows);
  renderWeather(rows.filter((r) => !r.standby));
}

function showView(v) {
  document.querySelectorAll("[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
  $("#filters").style.display = v === "chance" || v === "year" ? "none" : "";
  try { localStorage.setItem("view", v); } catch {}
  if (ALL.length) render(); // hidden sections have no width, so draw charts once visible
}

const getJSON = (u, fallback) => fetch(u).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);

Promise.all([
  getJSON("data/alarms.json"), getJSON("data/keywords.json", KW), getJSON("data/manual.json", { rows: [] }),
  getJSON("data/geo.json", {}), getJSON("data/weather.json", { days: {} }),
])
  .then(([data, kw, manual, geo, weather]) => {
    KW = kw;
    GEO = geo;
    WEATHER = weather.days;
    ALL = clean(mergeManual(data.rows, manual.rows));
    UPDATED = new Date(data.updated);
    $("#updated").textContent = new Date(data.updated).toLocaleDateString("de-DE");
    const years = [...new Set(ALL.map((r) => r.date.slice(0, 4)))].sort().reverse();
    $("#f-year").innerHTML += years.map((y) => `<option>${y}</option>`).join("");
    $("#y-year").innerHTML = years.map((y) => `<option>${y}</option>`).join("");
    $("#y-year").addEventListener("change", renderYear);
    $("#y-print").addEventListener("click", () => window.print());
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
