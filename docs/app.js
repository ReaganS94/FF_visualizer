"use strict";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const BIG_DAY = 10;       // a day with this many alarms or more counts as a Großlage (e.g. storm), except 01.01
const DAY_START = 6;      // "tagsüber" = 06:00–21:59, "nachts" = 22:00–05:59
const NIGHT_START = 22;

let ALL = [];             // cleaned alarms
let KW = { groups: {}, codes: {} }; // keyword names, from data/keywords.json
let GEO = {};             // "street|district" -> [lat, lon], from data/geo.json
let WEATHER = {};         // "YYYY-MM-DD" -> {tmax, tmin, rain, gust}, from data/weather.json
let UPDATED = new Date(); // when the data was last scraped
// The website's list isn't always current (in September 2026 it stopped at 13.09. for weeks). Days
// after its newest entry would look alarm-free, so counts of empty days end the day before it.
let LISTED = new Date();  // newest date on the website's list
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- dates (all local time, data is Hannover time) ----------
const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
const weekday = (dt) => (dt.getDay() + 6) % 7; // Monday = 0
const fmtDate = (iso) => iso.split("-").reverse().join(".");
const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);
// "1 Einsatz", "2 Einsätze" (German numbers with a thousands dot)
const einsaetze = (n, dative = false) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Einsatz" : dative ? "Einsätzen" : "Einsätze"}`;
const weitere = (n) => `${n} ${n === 1 ? "weiterer" : "weitere"}`;
const listBehind = () => addDays(LISTED, 2) < UPDATED; // the website hasn't listed anything for days

// ---------- load & clean ----------
// The website writes "Straße"; entries typed by hand may say "Strasse" or "Str.". One spelling keeps
// the street lists and the search together.
const tidyStreet = (s) => (s || "")
  .replace(/strasse/g, "straße").replace(/Strasse/g, "Straße")
  .replace(/(^|[\s-])Str\.?(?=$|[\s/])/g, "$1Straße")
  .replace(/([a-zäöüß])str\.?(?=$|[\s/])/g, "$1straße");

// A manual entry (admin page) is dropped once the website lists the same alarm: same keyword,
// time within an hour. Until then it fills the gap.
// Full timestamps, so 23:50 and 00:10 the next day still match.
const stamp = (r) => new Date(`${r.date}T${r.time}`).getTime();
function sameAlarm(a, b) {
  const base = (k) => k.split("/")[0].trim().toLowerCase();
  return base(a.keyword) === base(b.keyword) && Math.abs(stamp(a) - stamp(b)) <= 60 * 60 * 1000;
}

// Each website alarm stands in for at most one hand entry (closest in time first): two "th" alarms
// 40 minutes apart both stay until the website lists both. Same copy in admin.js.
function matchedManual(scraped, manual) {
  const seen = new Set();
  const web = scraped.filter((r) => {
    const k = [r.date, r.time, r.keyword, tidyStreet(r.street)].join("|");
    if (r.category !== "Einsatz" || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const pairs = [];
  web.forEach((r, i) => manual.forEach((m, j) => { if (sameAlarm(r, m)) pairs.push([Math.abs(stamp(r) - stamp(m)), i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const usedWeb = new Set(), matched = new Set();
  for (const [, i, j] of pairs) {
    if (usedWeb.has(i) || matched.has(manual[j])) continue;
    usedWeb.add(i);
    matched.add(manual[j]);
  }
  return matched;
}

function mergeManual(scraped, manual) {
  const matched = matchedManual(scraped, manual);
  const pending = manual.filter((m) => !matched.has(m));
  return [...scraped, ...pending.map((m) => ({ ...m, manual: true }))]
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

function clean(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r.category !== "Einsatz") continue;
    // The site sometimes lists one alarm twice with slightly different remarks.
    const street = tidyStreet(r.street);
    const k = [r.date, r.time, r.keyword, street].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    const base = r.keyword.split("/")[0].trim().toLowerCase() || "?";
    const info = KW.codes[base] || {};
    out.push({
      ...r, street, geoKey: `${r.street}|${r.district}`, base, standby: base === "vs", hour: Number(r.time.slice(0, 2)),
      name: info.name || base, group: KW.groups[info.group] || "Unbekannt",
    });
  }
  const perDay = {};
  for (const r of out) if (!r.standby) perDay[r.date] = (perDay[r.date] || 0) + 1;
  for (const r of out) {
    // Silvester fills 01.01 every year; that's part of a normal year, not an outlier like a storm.
    r.bigDay = perDay[r.date] >= BIG_DAY && r.date.slice(5) !== "01-01";
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
function placeTip(html, cx, cy) {
  tip.innerHTML = html;
  tip.hidden = false;
  const x = Math.min(cx + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = cy + 14 + tip.offsetHeight > window.innerHeight ? cy - tip.offsetHeight - 10 : cy + 14;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  placeTip(t.dataset.tip, e.clientX, e.clientY);
});

// ---------- chart helpers ----------
function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// Vertical bars. items: [{label, value, tip, tick, hi}]; hi: false greys a bar out next to the highlighted ones.
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
    if (d.value > 0) s += `<path class="bar${d.hi === false ? " lo" : ""}" d="${roundTop(x + gap / 2, top, bw - gap, h, Math.min(4, (bw - gap) / 2))}"/>`;
    s += `<rect class="hit" x="${x}" y="${T}" width="${bw}" height="${H - T - B}" data-tip="${esc(d.tip)}"/>`;
    if (d.tick) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.tick)}</text>`;
  });
  el.innerHTML = s + "</svg>";
}

// Horizontal ranked bars with the value at the end (hi: false greys a bar out, as above).
// scaleTo keeps the scale fixed while the values grow (the Einsatzradius playback).
function barList(el, items, { labelWidth = 170, scaleTo = 1 } = {}) {
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
function rampColors() {
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  return dark
    ? ["var(--empty)", "#cde2fb", "#86b6ef", "#3987e5", "#256abf", "#184f95"]
    : ["var(--empty)", "#b7d3f6", "#6da7ec", "#2a78d6", "#1c5cab", "#0d366b"];
}
function legend(labels, colors) {
  return `<div class="legend">${labels.map((l, i) => `<i style="background:${colors[i]}"></i>${esc(l)}`).join(" ")}</div>`;
}

// ---------- views ----------
function renderOverview(rows) {
  const tiles = [];
  // Weekly average only over days the website covers (from 01.01. or the first alarm to its newest alarm),
  // the same rule as the story; days after that hold only hand entries so far.
  const year = $("#f-year").value, listed = isoDate(LISTED);
  const from = year ? `${year}-01-01` : rows.at(-1)?.date;
  const to = !rows.length ? "" : year && listed > `${year}-12-31` ? `${year}-12-31` : minDate(rows[0].date, listed);
  const covered = rows.filter((r) => r.date <= to).length;
  const days = rows.length && to >= from ? (parseDate(to) - parseDate(from)) / 864e5 + 1 : 0;
  const night = rows.filter((r) => !r.timeUnknown && (r.hour >= NIGHT_START || r.hour < DAY_START)).length;
  const known = rows.filter((r) => !r.timeUnknown).length;
  tiles.push(["Einsätze", rows.length, "in der Auswahl"]);
  tiles.push(["Ø pro Woche", days ? (covered / (days / 7)).toFixed(1).replace(".", ",") : "–", days && to < rows[0].date ? `bis ${fmtDate(to)}` : "über den gewählten Zeitraum"]);
  tiles.push(["Nachts", known ? Math.round((100 * night) / known) + " %" : "–", "zwischen 22 und 6 Uhr"]);
  tiles.push(["Letzter Einsatz", rows.length ? fmtDate(rows[0].date) : "–",
    rows.length ? esc(rows[0].event) + (rows[0].manual ? ' <span class="tag">vorläufig</span>' : "") : ""]);
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
    items.push({ value: n, tip: `${MONTHS[m]} ${d.getFullYear()}: <b>${einsaetze(n)}</b>`, tick });
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
  const today = isoDate(new Date()), listed = isoDate(LISTED);
  // Like the spiral: say so on hidden Großlage days and on days the website hasn't reached, instead of just "0".
  const hiddenBig = {};
  if (!$("#f-storm").checked) for (const r of ALL) if (r.bigDay && !r.standby) hiddenBig[r.date] = (hiddenBig[r.date] || 0) + 1;
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
      const date = isoDate(d);
      if (date > today) continue;
      const list = perDay[date] || [];
      const tipText = `<b>${fmtDate(date)}</b> · ${einsaetze(list.length)}` +
        list.slice(0, 6).map((r) => `<br>${r.timeUnknown ? "" : `${esc(r.time)} `}${esc(r.keyword)} – ${esc(r.event)}`).join("") +
        (list.length > 6 ? `<br>… und ${weitere(list.length - 6)}` : "") +
        (hiddenBig[date] ? `<br>Großlage mit ${einsaetze(hiddenBig[date], true)}, nicht mitgezählt` : "") +
        (date > listed ? "<br>Noch nicht auf der Website" : "");
      s += `<rect class="cell${date > listed ? " unlisted" : ""}" x="${L + col * (C + G)}" y="${T + row * (C + G)}" width="${C}" height="${C}" rx="3" fill="${colors[bin(list.length)]}" data-tip="${esc(tipText)}"/>`;
    }
    html += `<div class="year-label">${y}</div>${s}</svg>`;
  }
  html += legend(["0", "1", "2", "3–4", `5–${BIG_DAY - 1}`, `${BIG_DAY}+`], colors);
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
      s += `<rect class="cell" x="${L + h * (C + G)}" y="${T + w * (C + G)}" width="${C}" height="${C}" rx="3" fill="${colors[level(n)]}" data-tip="${WEEKDAYS_LONG[w]}, ${h}–${h + 1} Uhr: <b>${einsaetze(n)}</b>"/>`;
    });
  });
  $("#c-heat").innerHTML = s + "</svg>" + legend(["0", "", "", "", "", `${max} (Maximum)`], colors);

  const hours = Array(24).fill(0);
  for (const r of known) hours[r.hour]++;
  columnChart($("#c-hours"), hours.map((n, h) => ({ value: n, tip: `${h}–${h + 1} Uhr: <b>${einsaetze(n)}</b>`, tick: h % 3 === 0 ? `${h}` : "" })), { height: 180 });
}

function topCounts(rows, key, n = 15) {
  const c = {};
  for (const r of rows) { const k = key(r) || "unbekannt"; (c[k] ||= []).push(r); }
  return Object.entries(c).sort((a, b) => b[1].length - a[1].length).slice(0, n);
}

function renderKeywords(rows) {
  barList($("#c-groups"), topCounts(rows, (r) => r.group).map(([g, list]) => {
    const codes = topCounts(list, (r) => r.base, 4).map(([c, l]) => `${esc(c)} ${esc(l[0].name)} (${l.length})`).join("<br>");
    return { label: g, value: list.length, tip: `<b>${esc(g)}</b> · ${einsaetze(list.length)}<br>${codes}` };
  }));
  barList($("#c-keywords"), topCounts(rows, (r) => r.base).map(([k, list]) => {
    const events = topCounts(list, (r) => r.event, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: `${k} · ${list[0].name}`, value: list.length, tip: `<b>${esc(k)}</b> ${esc(list[0].name)} · ${einsaetze(list.length)}<br>${events}` };
  }), { labelWidth: 330 });
}

function renderDistricts(rows) {
  barList($("#c-districts"), topCounts(rows, (r) => r.district, 20).map(([k, list]) => {
    const streets = topCounts(list, (r) => r.street, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: k, value: list.length, tip: `<b>${esc(k)}</b> · ${einsaetze(list.length)}<br>${streets}` };
  }));
}

function renderList(rows) {
  const q = $("#q").value.trim().toLowerCase();
  const hits = q ? rows.filter((r) => [r.keyword, r.event, r.street, r.district, r.remarks].join(" ").toLowerCase().includes(q)) : rows;
  // Hand entries fill the gap until the website lists the same alarm, which then replaces them.
  const pending = hits.some((r) => r.manual);
  $("#list-count").textContent = `${einsaetze(hits.length)}.` + (pending
    ? " Einträge mit „vorläufig“ stehen noch nicht auf der Website der Feuerwehr. Sobald sie dort stehen, ersetzt der offizielle Eintrag sie."
    : "");
  // in the date column, which stays on screen when the table scrolls sideways on a phone
  const tag = '<span class="tag" data-tip="Noch nicht auf der Website der Feuerwehr. Wird durch den offiziellen Eintrag ersetzt, sobald er dort steht.">vorläufig</span>';
  $("#t-list tbody").innerHTML = hits.map((r) =>
    `<tr><td>${fmtDate(r.date)}${r.manual ? `<br>${tag}` : ""}</td><td>${r.timeUnknown ? "?" : esc(r.time)}</td><td title="${esc(r.name)}">${esc(r.keyword)}</td><td>${esc(r.event)}</td><td>${esc(r.street)}</td><td>${esc(r.district)}</td></tr>`).join("");
}

// ---------- Stammadressen ----------
// Streets and places with repeated alarms. Grouped by street alone, since a street can cross a district border.
const isBMA = (r) => r.base === "o" || /\bBMA\b|Brandmeldeanlage|Brandmelder/i.test(r.event);
const isRWM = (r) => /RWM|Rauchwarnmelder|Rauchmelder/i.test(r.event);

function addressGroups(rows, min) {
  const by = {};
  for (const r of rows) if (r.street) (by[r.street] ||= []).push(r);
  return Object.entries(by).filter(([, l]) => l.length >= min)
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b, "de"));
}

function addressList(el, groups, empty) {
  if (!groups.length) { el.innerHTML = `<p class="note">${empty}</p>`; return; }
  const open = new Set([...el.querySelectorAll("details[open]")].map((d) => d.dataset.k)); // stays open across redraws
  const max = groups[0][1].length;
  el.innerHTML = groups.map(([street, list]) => {
    const districts = [...new Set(list.map((r) => r.district).filter(Boolean))].map((d) => `<span>${esc(d)}</span>`).join(", ");
    // What usually happens there: alarm systems and smoke alarms by the event text, the rest by keyword.
    const kind = (r) => (isBMA(r) ? "Brandmeldeanlage" : isRWM(r) ? "Rauchwarnmelder" : r.name.replace(/\s*\(.*\)$/, ""));
    // Types with at least two alarms by name (at most three), the rest summed up, so the line adds up to the total.
    const kinds = topCounts(list, kind, 99);
    const named = kinds.filter(([, l]) => l.length >= 2).slice(0, 3), rest = kinds.slice(named.length);
    const restN = rest.reduce((a, [, l]) => a + l.length, 0);
    const what = [...named, ...(rest.length === 1 ? rest : [])].map(([k, l]) => `${l.length}× ${esc(k)}`)
      .concat(rest.length > 1 ? [named.length ? `${restN}× andere` : `${restN} verschiedene Einsatzarten`] : []).join(" · ");
    const alarms = list.map((r) => `<tr><td>${fmtDate(r.date)}${r.manual ? ' <span class="tag">vorläufig</span>' : ""}</td>` +
      `<td>${r.timeUnknown ? "?" : esc(r.time)}</td><td title="${esc(r.name)}">${esc(r.keyword)}</td><td>${esc(r.event)}</td></tr>`).join("");
    return `<details class="addr" data-k="${esc(street)}"${open.has(street) ? " open" : ""}><summary>` +
      `<span class="addr-name"><b>${esc(street)}</b> <small>${districts}</small></span>` +
      `<span class="addr-bar"><i style="width:${((100 * list.length) / max).toFixed(1)}%"></i></span>` +
      `<span class="addr-n">${list.length}</span>` +
      `<span class="addr-what">${what} · zuletzt ${fmtDate(list[0].date)}</span></summary>` +
      `<div class="table-wrap"><table><tbody>${alarms}</tbody></table></div></details>`;
  }).join("");
}

function renderAddresses(rows) {
  addressList($("#c-addresses"), addressGroups(rows, 3).slice(0, 25), "In der Auswahl gibt es keinen Ort mit drei oder mehr Einsätzen.");
  addressList($("#c-bma"), addressGroups(rows.filter(isBMA), 2), "In der Auswahl hat keine Brandmeldeanlage mehr als einmal ausgelöst.");
}

// ---------- Punktewand ----------
// Every alarm is one dot, coloured by its type. Switching the grouping moves each dot to its new place.
// Three colours at most stay tellable apart for everyone; the rarer types share grey.
const DOT_KINDS = [["brand", "Brand"], ["hilfe", "Technische Hilfe"], ["unwetter", "Unwetter"]];
const dotKind = (r) => (DOT_KINDS.find(([, g]) => g === r.group) || ["other"])[0];
const DOT_ORDER = ["brand", "hilfe", "unwetter", "other"];
const DOT_TOP_DISTRICTS = 12;
let dotsBy = "month";
let dotsRows = [];     // the alarms currently drawn, in dot order
let dotsPicked = null; // the tapped alarm

function dotGroups(rows, by) {
  if (by === "month") return MONTHS.map((m, i) => ({ label: m, rows: rows.filter((r) => Number(r.date.slice(5, 7)) === i + 1) }));
  if (by === "hour") {
    const g = Array.from({ length: 24 }, (_, h) => ({ label: String(h), rows: rows.filter((r) => !r.timeUnknown && r.hour === h) }));
    const unknown = rows.filter((r) => r.timeUnknown);
    return unknown.length ? [...g, { label: "?", rows: unknown }] : g;
  }
  if (by === "type") return topCounts(rows, (r) => r.group, 99).map(([g, l]) => ({ label: g, rows: l }));
  const all = topCounts(rows, (r) => r.district, 999);
  const rest = all.slice(DOT_TOP_DISTRICTS).flatMap(([, l]) => l);
  return [...all.slice(0, DOT_TOP_DISTRICTS).map(([d, l]) => ({ label: d, rows: l })),
    ...(rest.length ? [{ label: weitere(all.length - DOT_TOP_DISTRICTS), rows: rest }] : [])];
}

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

function renderDots(rows) {
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

// ---------- Jahresspirale ----------
// One turn per year, one piece per day, from the inside out. Every date sits at the same angle in every
// year, so the seasons line up. A gap at the top holds the year labels.
function renderSpiral(rows) {
  const el = $("#c-spiral");
  if (!rows.length) { el.innerHTML = ""; $("#spiral-note").textContent = ""; return; }
  const perDay = {};
  for (const r of rows) (perDay[r.date] ||= []).push(r);
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort();
  const listed = isoDate(LISTED);
  // A past year runs to 31.12.; the current one to its newest alarm (entered by hand or on the website).
  const lastYear = years.at(-1);
  const end = lastYear < String(new Date().getFullYear()) ? `${lastYear}-12-31` : maxDate(rows[0].date, minDate(listed, `${lastYear}-12-31`));
  const R0 = 96, W = 46, T = 34, GAP = 16; // inner radius, distance between turns, band width, gap in degrees
  const outer = R0 + years.length * W + T / 2;
  const C = outer + 34;
  const f = (n) => n.toFixed(1);
  const deg = (i) => GAP / 2 + ((360 - GAP) * i) / 366;
  const xy = (a, r) => { const t = ((a - 90) * Math.PI) / 180; return [C + r * Math.cos(t), C + r * Math.sin(t)]; };
  const pt = (a, r) => xy(a, r).map(f).join(",");
  const rad = (k, i) => R0 + (k + i / 366) * W;
  const step = (n) => (n === 0 ? "var(--empty)" : `var(--heat-${n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4})`);
  // With "Großlagen mitzählen" off, say so on those days instead of just showing 0.
  const hiddenBig = {};
  if (!$("#f-storm").checked) for (const r of ALL) if (r.bigDay && !r.standby) hiddenBig[r.date] = (hiddenBig[r.date] || 0) + 1;
  let s = `<svg viewBox="0 0 ${2 * C} ${2 * C}" role="img" aria-label="Einsätze pro Tag als Spirale, ${years[0]} bis ${years.at(-1)}">`;
  // month boundaries, visible between the turns
  const monthStart = (m) => DAY_SLOTS.indexOf(`${String(m + 1).padStart(2, "0")}-01`);
  MONTHS.forEach((name, m) => {
    const a = deg(monthStart(m)), mid = deg((monthStart(m) + (m === 11 ? 366 : monthStart(m + 1))) / 2);
    const [x1, y1] = xy(a, R0 - T / 2), [x2, y2] = xy(a, outer), [lx, ly] = xy(mid, outer + 16);
    s += `<line class="grid" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/><text x="${f(lx)}" y="${f(ly + 4)}" text-anchor="middle">${name}</text>`;
  });
  years.forEach((y, k) => {
    DAY_SLOTS.forEach((d, i) => {
      const date = `${y}-${d}`;
      if (d === "02-29" && new Date(Number(y), 1, 29).getMonth() !== 1) return; // no 29.02. this year
      if (date > end) return;
      const list = perDay[date] || [];
      const a0 = deg(i), a1 = deg(i + 1), r0 = rad(k, i), r1 = rad(k, i + 1);
      const fill = step(list.length);
      const tip = `<b>${WEEKDAYS[weekday(parseDate(date))]}, ${fmtDate(date)}</b> · ${einsaetze(list.length)}` +
        list.slice(0, 6).map((r) => `<br>${r.timeUnknown ? "" : `${esc(r.time)} `}${esc(r.keyword)} – ${esc(r.event)}`).join("") +
        (list.length > 6 ? `<br>… und ${weitere(list.length - 6)}` : "") +
        (hiddenBig[date] ? `<br>Großlage mit ${einsaetze(hiddenBig[date], true)}, nicht mitgezählt` : "") +
        (date > listed ? "<br>Noch nicht auf der Website" : "");
      s += `<path class="day-seg${date > listed ? " unlisted" : ""}" d="M${pt(a0, r0 + T / 2)}L${pt(a1, r1 + T / 2)}L${pt(a1, r1 - T / 2)}L${pt(a0, r0 - T / 2)}Z" ` +
        `fill="${fill}" stroke="${fill}" data-tip="${esc(tip)}"/>`;
    });
    const [yx, yy] = xy(0, rad(k, 0));
    s += `<text class="year-mark" x="${f(yx)}" y="${f(yy + 4)}" text-anchor="middle">${y}</text>`;
  });
  s += `<text x="${C}" y="${C - 4}" text-anchor="middle" class="center">${years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0]}</text>`;
  s += `<text x="${C}" y="${C + 14}" text-anchor="middle">${years.length > 1 ? "von innen nach außen" : "ein Jahr, eine Runde"}</text>`;
  el.innerHTML = s + "</svg>" + legend(["0", "1", "2", "3–4", "5+"], ["var(--empty)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"]);
  $("#spiral-note").textContent = "Jede Runde ist ein Jahr, jedes Stück ein Tag. Derselbe Tag liegt in jedem Jahr an derselben Stelle, " +
    "so stehen die Jahreszeiten übereinander. Je dunkler, desto mehr Einsätze an diesem Tag." +
    (end > listed ? ` Tage nach dem ${fmtDate(listed)} sind blasser: Die Website listet sie noch nicht, an diesen Tagen zählen nur vorläufige Einträge.` : "");
}

// ---------- "Einsatz heute?" ----------
// Day (6–22 Uhr): share of past days with the same weekday that had at least one alarm, blended with
// the rate over all days, and on a day forecast at 30 °C or more blended again with the past hot days.
// Night (22–6 Uhr): the share of all past nights. Replaying every day since July 2024 picked this over
// the earlier weekday-and-month version: at night no weekday or month pattern held from one year to
// the next, and by day the month added nothing once the weekday was known. Deliberately simple so
// anyone can check it by hand.
const PRIOR = 10;
const HOT = 30; // °C, the heat rule
// Nights that are busy every year whatever the weekday (Silvester: 20 alarms in 2024, 14 in 2025).
// They get no percentage: the page shows the same night of earlier years instead, and they are
// left out when estimating ordinary nights.
const SPECIAL_NIGHTS = { "12-31": ["Silvesternacht", "Silvesternächten"] };
const specialNight = (iso) => SPECIAL_NIGHTS[iso.slice(5)];

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
  // the same weekday, walking back from `last` in weekly steps
  const days = [];
  for (let d = addDays(last, -((weekday(last) - weekday(target) + 7) % 7)); d >= first; d = addDays(d, -7)) days.push(isoDate(d));
  let total = 0, totDay = 0, nights = 0, night = 0, hot = 0, hotDay = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const k = isoDate(d);
    total++; totDay += win.inDay.has(k);
    if (!specialNight(k)) { nights++; night += win.inNight.has(k); }
    if (WEATHER[k]?.tmax >= HOT) { hot++; hotDay += win.inDay.has(k); }
  }
  // About 30 to 140 same weekdays: a single lucky week still moves the share, so blend in the rate
  // over all days (as if we had seen PRIOR extra average days).
  const blend = (hits, n, base) => (hits + PRIOR * base) / (n + PRIOR);
  const day = days.filter((d) => win.inDay.has(d)).length;
  const weekdayP = blend(day, days.length, total ? totDay / total : 0);
  const tmax = WEATHER[isoDate(target)]?.tmax, heat = tmax >= HOT;
  return {
    n: days.length, day, weekdayP, heat, tmax, hot, hotDay, nights, night,
    pDay: heat ? blend(hotDay, hot, weekdayP) : weekdayP, pNight: nights ? night / nights : 0,
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
      if (k === "night" && specialNight(day)) continue; // the page shows no percentage for these
      const p = 100 * e[k === "day" ? "pDay" : "pNight"];
      const b = bins.find((b) => p >= b.lo && p < b.hi);
      b.n++; b.sum += p; if (set.has(day)) b.hit++;
      n++;
    }
  }
  return { bins: bins.filter((b) => b.n), n };
}

// 24-hour ring: one segment per hour, darker = more alarms at that time of day since the data
// starts. The centre shows the estimate for the window we're in, a pointer marks the current time.
function drawRing() {
  const m = chanceModel;
  if (!m) return;
  const hours = Array(24).fill(0);
  for (const r of ALL) if (!r.standby && !r.timeUnknown) hours[r.hour]++;
  const max = Math.max(1, ...hours);
  const C = 190, R0 = 88, R1 = 138, RB = 146;
  const pt = (deg, r) => { const a = ((deg - 90) * Math.PI) / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const f = (n) => n.toFixed(1);
  const arc = (a0, a1, r0, r1) => {
    const [x0, y0] = pt(a0, r1), [x1, y1] = pt(a1, r1), [x2, y2] = pt(a1, r0), [x3, y3] = pt(a0, r0);
    const big = a1 - a0 > 180 ? 1 : 0;
    return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${big} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${big} 0 ${f(x3)} ${f(y3)}Z`;
  };
  const since = m.first.getFullYear();
  const now = new Date(), t = now.getHours() + now.getMinutes() / 60, a = t * 15;
  const text = (x, y, str, cls = "", size = 11, anchor = "middle") =>
    `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" style="font-size:${size}px" class="${cls}">${str}</text>`;
  let s = `<svg viewBox="0 0 380 380" role="img" aria-label="Einsätze je Uhrzeit. ${esc(m.cur.label)}: ${esc(m.cur.v)}">`;
  hours.forEach((n, h) => {
    const step = Math.min(4, Math.floor((n / max) * 5));
    s += `<path class="seg" d="${arc(h * 15, h * 15 + 15, R0, R1)}" fill="var(--heat-${step})" data-tip="${h}–${h + 1} Uhr: <b>${einsaetze(n)}</b> seit ${since}"/>`;
  });
  s += `<path d="${arc(DAY_START * 15, NIGHT_START * 15, RB, RB + 5)}" fill="var(--band-day)"/>`;
  s += `<path d="${arc(NIGHT_START * 15, (24 + DAY_START) * 15, RB, RB + 5)}" fill="var(--band-night)"/>`;
  for (const h of [0, 6, 12, 18]) { const [x, y] = pt(h * 15, R0 - 12); s += text(x, y + 4, String(h).padStart(2, "0"), "muted"); }
  // "jetzt": a hand across the ring plus a marker outside it
  const [nx0, ny0] = pt(a, R0 - 2), [nx1, ny1] = pt(a, R1 + 2);
  const [tx, ty] = pt(a, RB + 7), [lx, ly] = pt(a - 5, RB + 20), [rx, ry] = pt(a + 5, RB + 20), [jx, jy] = pt(a, RB + 30);
  s += `<line class="hand" x1="${f(nx0)}" y1="${f(ny0)}" x2="${f(nx1)}" y2="${f(ny1)}"/>`;
  s += `<path class="hand-mark" d="M${f(tx)} ${f(ty)}L${f(lx)} ${f(ly)}L${f(rx)} ${f(ry)}Z"/>` + text(jx, jy + 4, "jetzt", "strong");
  // centre
  s += text(C, C - 30, esc(m.cur.label), "", 12);
  if (/\d/.test(m.cur.v)) s += text(C, C + 12, esc(m.cur.v), "big", 34);
  else m.cur.v.split(" ").forEach((w, i, all) => { s += text(C, C + 6 + (i - (all.length - 1) / 2) * 20, esc(w), "big", 16); });
  if (m.other) s += text(C, C + 38, `${m.other.short}: ${esc(m.other.v)}`, "", 11);
  $("#chance-ring").innerHTML = s + "</svg>";
  $("#ring-legend").innerHTML = `<div class="legend">weniger ${[0, 1, 2, 3, 4].map((i) => `<i style="background:var(--heat-${i})"></i>`).join("")} mehr</div>` +
    `<div class="legend"><i class="band" style="background:var(--band-day)"></i>Tag 6–22 Uhr <i class="band" style="background:var(--band-night)"></i>Nacht 22–6 Uhr</div>` +
    `<p class="note">Jedes Stück ist eine Stunde. Je dunkler, desto mehr Einsätze gab es seit ${since} zu dieser Uhrzeit.</p>`;
}

// Keep the "jetzt" hand moving; a new window (6 or 22 Uhr) or a new day needs the full update.
setInterval(() => {
  if (!chanceModel) return;
  const now = new Date(), h = now.getHours();
  const key = `${isoDate(now)}-${h >= DAY_START && h < NIGHT_START}`;
  if (key !== chanceModel.key) renderChance(); else drawRing();
}, 60 * 1000);

// Alarms in a day (06–22) or night (22–06, into the next morning) window of `iso`.
function alarmsIn(iso, night) {
  const next = isoDate(addDays(parseDate(iso), 1));
  return ALL.filter((r) => !r.standby && (night
    ? !r.timeUnknown && ((r.date === iso && r.hour >= NIGHT_START) || (r.date === next && r.hour < DAY_START))
    : r.date === iso && (r.timeUnknown || (r.hour >= DAY_START && r.hour < NIGHT_START)))).length;
}

// What the page says about the night of `date`: a percentage, or for a special night the same
// night in earlier years.
function nightInfo(date, est, first, last) {
  const pct = { v: `~${Math.round(100 * est.pNight)} %`, d: `in ${est.night} von ${est.nights} bisherigen Nächten gab es mindestens einen Einsatz` };
  const special = specialNight(isoDate(date));
  if (!special) return pct;
  const [name, plural] = special;
  const past = [];
  for (let y = first.getFullYear(); y < date.getFullYear(); y++) {
    const d = new Date(y, date.getMonth(), date.getDate());
    if (d >= first && d <= last) past.push([y, alarmsIn(isoDate(d), true)]); // only nights the data fully covers
  }
  if (!past.length) return pct;
  const hits = past.filter(([, n]) => n > 0).length;
  const which = hits === past.length ? (past.length === 1 ? "in der letzten" : past.length === 2 ? "in beiden bisherigen" : `in allen ${past.length} bisherigen`)
    : `in ${hits} von ${past.length} bisherigen`;
  return {
    name, v: hits === past.length ? "bisher jedes Jahr" : `${hits} von ${past.length}`,
    d: `${which} ${past.length === 1 ? name : plural} gab es Einsätze (${past.map(([y, n]) => `${y}: ${n}`).join(", ")})`,
  };
}

// ---------- Die nächsten 7 Tage ----------
// Today and the next six days from the weather forecast, each with the day estimate (weekday plus the
// heat rule, so only the temperature changes it). Hot, stormy and thunder days are tinted, and days
// further ahead fade because the forecast gets less sure.
const GUST = 60; // km/h, Sturmböen
const isHot = (w) => w.tmax >= HOT, isStorm = (w) => w.gust >= GUST, isThunder = (w) => w.code >= 95;
// weather code (WMO, from Open-Meteo) -> symbol and word
const WX = [
  [(c) => c >= 95, "thunder", "Gewitter"],
  [(c) => (c >= 71 && c <= 77) || c === 85 || c === 86, "snow", "Schnee"],
  [(c) => c >= 51 && c <= 82, "rain", "Regen"],
  [(c) => c === 45 || c === 48, "fog", "Nebel"],
  [(c) => c === 3, "cloud", "bewölkt"],
  [(c) => c === 1 || c === 2, "part", "teils sonnig"],
  [() => true, "sun", "sonnig"],
];
// Without a code (weather saved before the symbols were added) only rain can be told.
const wxKind = (w) => (w.code == null ? (w.rain >= 1 ? ["rain", "Regen"] : null) : WX.find(([is]) => is(w.code)).slice(1));

// How often past days with this weather had an alarm during the day, against the other days.
function weatherFacts(first, last, win, is) {
  const f = { on: 0, onHit: 0, off: 0, offHit: 0 };
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const k = isoDate(d), w = WEATHER[k];
    if (!w) continue;
    const hit = win.inDay.has(k);
    if (is(w)) { f.on++; f.onHit += hit; } else { f.off++; f.offHit += hit; }
  }
  return f;
}
// [nominative, dative], e.g. ["Gewittertage", "Gewittertagen"]
const factsText = (f, [nom, dat]) => !f.on ? "" : f.on < 10 ? `Bisher gab es erst ${f.on} ${nom}, zu wenige für einen Vergleich.`
  : `An bisherigen ${dat} gab es tagsüber an ${f.onHit} von ${f.on} mindestens einen Einsatz (${pct(f.onHit, f.on)}\u00a0%), an den anderen Tagen in ${pct(f.offHit, f.off)}\u00a0%.`;

function renderOutlook(ahead, first, last, win) {
  $("#outlook").hidden = !ahead.length;
  if (!ahead.length) return;
  $("#outlook-title").textContent = ahead.length > 1 ? `Die nächsten ${ahead.length} Tage` : "Das Wetter heute";
  const name = (i) => (i === 0 ? "heute" : i === 1 ? "morgen" : WEEKDAYS_LONG[weekday(ahead[i].d)]);
  const list = (is, what) => ahead.map((a, i) => (is(a.w) ? `${name(i)}${what ? ` ${what(a.w)}` : ""}` : "")).filter(Boolean).join(", ");
  const notes = [];
  const hot = list(isHot, (w) => `bis ${Math.round(w.tmax)}\u00a0°C`);
  if (hot) {
    notes.push(`<div class="wx-note hot"><b>Hitze angesagt:</b> ${hot}. ` +
      `${factsText(weatherFacts(first, last, win, isHot), [`Tage ab ${HOT}\u00a0°C`, `Tagen ab ${HOT}\u00a0°C`])} Die Schätzung für diese Tage ist deshalb höher.</div>`);
  }
  // A thunderstorm is only a rough hint after tomorrow.
  const near = (w) => isThunder(w) && ahead.findIndex((a) => a.w === w) < 2, far = (w) => isThunder(w) && !near(w);
  const storm = list(isStorm, (w) => `bis ${Math.round(w.gust)} km/h`), tNear = list(near), tFar = list(far);
  if (storm || tNear || tFar) {
    notes.push(`<div class="wx-note storm">` +
      (storm ? `<b>Sturmböen angesagt:</b> ${storm}. ` : "") + (tNear ? `<b>Gewitter angesagt:</b> ${tNear}. ` : "") + (tFar ? `<b>Gewitter möglich:</b> ${tFar}. ` : "") +
      (storm ? factsText(weatherFacts(first, last, win, isStorm), ["Tage mit Sturmböen", "Tagen mit Sturmböen"]) + " " : "") +
      (tNear || tFar ? factsText(weatherFacts(first, last, win, isThunder), ["Gewittertage", "Gewittertagen"]) + " " : "") +
      `In die Schätzung geht nur die Temperatur ein.</div>`);
  }
  if (!notes.length) notes.push(`<p class="note">In diesen Tagen sind weder ${HOT}\u00a0°C noch Sturmböen oder Gewitter angesagt.</p>`);
  $("#outlook-notes").innerHTML = notes.join("");
  // Großlagen so far: how much wind the weather data showed on those days.
  const big = [...new Set(ALL.filter((r) => r.bigDay).map((r) => r.date))].filter((d) => WEATHER[d]).sort();
  const calm = big.length && big.every((d) => WEATHER[d].gust < GUST);
  $("#outlook-note").textContent = `Wettervorhersage für Hannover (Daten: Open-Meteo). Je weiter ein Tag weg ist, desto blasser: ` +
    `Temperaturen stimmen meist für etwa fünf Tage, Sturm und Gewitter nur für ein bis zwei Tage.` +
    (calm ? ` Großlagen kündigen sich hier oft nicht an: ${big.length === 1 ? "am" : "an den Tagen"} ${big.map(fmtDate).join(" und ")} ` +
      `zeigten die Wetterdaten nur Böen bis ${Math.round(Math.max(...big.map((d) => WEATHER[d].gust)))} km/h.` : "");
  drawOutlook();
}

function wxIcon(kind, x, y) {
  const g = (body) => `<g transform="translate(${x.toFixed(1)} ${y})">${body}</g>`;
  const rays = (r0, r1) => Array.from({ length: 8 }, (_, i) => {
    const c = Math.cos((i * Math.PI) / 4), s = Math.sin((i * Math.PI) / 4);
    return `<line x1="${(r0 * c).toFixed(1)}" y1="${(r0 * s).toFixed(1)}" x2="${(r1 * c).toFixed(1)}" y2="${(r1 * s).toFixed(1)}"/>`;
  }).join("");
  // the inner group turns on hot days, so its own transform stays free for the animation
  const sun = (dx, dy, k) => `<g transform="translate(${dx} ${dy}) scale(${k})"><g class="wx-sun"><circle r="7"/>${rays(10, 13.5)}</g></g>`;
  const cloud = (dx, dy, cls = "wx-cloud") => `<g class="${cls}" transform="translate(${dx} ${dy})"><circle cx="-6" cy="2" r="6.5"/>` +
    `<circle cx="2" cy="-3" r="8.5"/><circle cx="9" cy="2.5" r="6"/><rect x="-12.5" y="2" width="27.5" height="7" rx="3.5"/></g>`;
  const drops = (cls, mark) => `<g class="${cls}">${[-7, 0, 7].map(mark).join("")}</g>`;
  switch (kind) {
    case "sun": return g(sun(0, 0, 1));
    case "part": return g(sun(-5, -5, 0.8) + cloud(3, 4));
    case "cloud": return g(cloud(0, 0));
    case "rain": return g(cloud(0, -4) + drops("wx-rain", (dx) => `<line x1="${dx + 1}" y1="9" x2="${dx - 2}" y2="16"/>`));
    case "snow": return g(cloud(0, -4) + drops("wx-snow", (dx, i) => `<circle cx="${dx}" cy="${12 + (i % 2) * 3}" r="1.8"/>`));
    case "fog": return g(`<g class="wx-fog">${[-6, 0, 6].map((dy, i) => `<line x1="${-13 + i * 3}" y1="${dy}" x2="${13 - i * 3}" y2="${dy}"/>`).join("")}</g>`);
    case "thunder": return g(cloud(0, -6, "wx-cloud dark") + `<path class="wx-bolt" d="M1 1L-5 11H0L-3 20L6 7H1L4 1Z"/>`);
  }
  return "";
}

const WIND_PATH = "M0 -4H9a2.5 2.5 0 1 0-2.5-2.5M0 1H13a2.5 2.5 0 1 1-2.5 2.5";

// Catmull-Rom through the points, as cubic curves.
function smoothPath(pts, move = "M") {
  const f = (n) => n.toFixed(1);
  return pts.map(([x, y], i) => {
    if (!i) return `${move}${f(x)} ${f(y)}`;
    const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || [x, y];
    return `C${f(p1[0] + (x - p0[0]) / 6)} ${f(p1[1] + (y - p0[1]) / 6)} ${f(x - (p3[0] - p1[0]) / 6)} ${f(y - (p3[1] - p1[1]) / 6)} ${f(x)} ${f(y)}`;
  }).join("");
}

// Colours of the temperature band, hottest first.
const TEMP_STOPS = [[36, "#a3160d"], [30, "#e0542c"], [25, "#f2994a"], [18, "#f2c94c"], [10, "#7cc6c0"], [0, "#5aa0e0"], [-10, "#3d6fd1"]];

function drawOutlook() {
  const el = $("#outlook-chart"), ahead = chanceModel?.ahead;
  if (!el || !ahead?.length || !el.clientWidth) return;
  const n = ahead.length, W = el.clientWidth, cw = Math.min(140, W / n), x0 = (W - cw * n) / 2, H = 278;
  const narrow = cw < 84, f = (v) => v.toFixed(1);
  const cx = (i) => x0 + cw * (i + 0.5);
  const T0 = 172, T1 = 90; // temperature band from bottom to top
  const maxT = Math.max(...ahead.map((a) => a.w.tmax)), minT = Math.min(...ahead.map((a) => a.w.tmin));
  // The 30 °C line only shows once it gets warm; otherwise it would squeeze the band.
  const heatLine = maxT >= HOT - 5;
  const hi = Math.max(heatLine ? HOT + 2 : maxT + 2, maxT + 1), lo = Math.min(minT - 1, hi - 10);
  const ty = (t) => T0 - ((t - lo) / (hi - lo)) * (T0 - T1);
  const off = (t) => Math.min(1, Math.max(0, (hi - t) / (hi - lo)));
  const fade = n > 2 ? `<linearGradient id="wx-fade" gradientUnits="userSpaceOnUse" x1="${f(cx(1))}" x2="${f(cx(n - 1))}" y1="0" y2="0">` +
    `<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#6a6a6a"/></linearGradient>` +
    `<mask id="wx-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#wx-fade)"/></mask>` : "";
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Wetter und Schätzung für die nächsten ${n} Tage"><defs>` +
    `<linearGradient id="wx-temp" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${f(ty(hi))}" y2="${f(ty(lo))}">` +
    TEMP_STOPS.map(([t, c]) => `<stop offset="${off(t).toFixed(3)}" stop-color="${c}"/>`).join("") + `</linearGradient>` +
    `<linearGradient id="wx-hot" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--wx-hot)" stop-opacity=".38"/><stop offset=".75" stop-color="var(--wx-hot)" stop-opacity=".06"/></linearGradient>` +
    `<linearGradient id="wx-storm" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--wx-storm)" stop-opacity=".34"/><stop offset=".75" stop-color="var(--wx-storm)" stop-opacity=".06"/></linearGradient>` +
    fade + `</defs>`;
  // columns
  ahead.forEach((a, i) => {
    const x = x0 + cw * i + 2, w = cw - 4, cls = [isHot(a.w) && "hot", (isStorm(a.w) || isThunder(a.w)) && "storm", i === 0 && "now"].filter(Boolean).join(" ");
    s += `<g class="wx-col ${cls}"><rect class="wx-card" x="${f(x)}" y="0" width="${f(w)}" height="${H}" rx="10"/>`;
    if (isHot(a.w)) s += `<rect class="wx-hotbg" x="${f(x)}" y="0" width="${f(w)}" height="${H}" rx="10" fill="url(#wx-hot)"/>`;
    if (isStorm(a.w) || isThunder(a.w)) s += `<rect class="wx-stormbg${isThunder(a.w) ? " thunder" : ""}" x="${f(x)}" y="0" width="${f(w)}" height="${H}" rx="10" fill="url(#wx-storm)"/>`;
    const day = i === 0 ? "Heute" : i === 1 ? "Morgen" : (narrow ? WEEKDAYS : WEEKDAYS_LONG)[weekday(a.d)];
    s += `<text x="${f(cx(i))}" y="20" class="wx-day" style="font-size:${narrow ? 12 : 13}px">${day}</text>`;
    s += `<text x="${f(cx(i))}" y="35" class="wx-date">${fmtDate(isoDate(a.d)).slice(0, 6)}</text></g>`;
  });
  // the forecast itself, fading with distance
  s += `<g class="wx-fc"${fade ? ' mask="url(#wx-mask)"' : ""}>`;
  ahead.forEach((a, i) => { const k = wxKind(a.w); if (k) s += `<g class="wx-icon${isHot(a.w) ? " hot" : ""}">${wxIcon(k[0], cx(i), 60)}</g>`; });
  if (heatLine) {
    // the label goes to the end where it is furthest from that day's temperature
    const gap = (i) => Math.abs(ty(ahead[i].w.tmax) - 9 - (ty(HOT) - 4));
    const right = n > 1 && gap(n - 1) > gap(0);
    s += `<line class="wx-heatline" x1="${f(x0 + 4)}" x2="${f(x0 + cw * n - 4)}" y1="${f(ty(HOT))}" y2="${f(ty(HOT))}"/>` +
      `<text class="wx-heatlabel" x="${f(right ? x0 + cw * n - 8 : x0 + 8)}" y="${f(ty(HOT) - 4)}" style="text-anchor:${right ? "end" : "start"}">${HOT}\u00a0°C</text>`;
  }
  const top = ahead.map((a, i) => [cx(i), ty(a.w.tmax)]), bottom = ahead.map((a, i) => [cx(i), ty(a.w.tmin)]);
  if (n > 1) {
    s += `<path class="wx-band" d="${smoothPath(top)}${smoothPath([...bottom].reverse(), "L")}Z"/>`;
    s += `<path class="wx-tmax" d="${smoothPath(top)}"/><path class="wx-tmin" d="${smoothPath(bottom)}"/>`;
  } else {
    s += `<line class="wx-tmax" x1="${f(top[0][0])}" x2="${f(top[0][0])}" y1="${f(top[0][1])}" y2="${f(bottom[0][1])}"/>`;
  }
  ahead.forEach((a, i) => {
    const [x, y] = top[i], [, yb] = bottom[i];
    s += `<circle class="wx-dot" cx="${f(x)}" cy="${f(y)}" r="3.5"/>` +
      `<text x="${f(x)}" y="${f(y - 9)}" class="wx-tmaxlabel${isHot(a.w) ? " hot" : ""}">${Math.round(a.w.tmax)}°</text>` +
      `<text x="${f(x)}" y="${f(yb + 15)}" class="wx-tminlabel">${Math.round(a.w.tmin)}°</text>`;
  });
  ahead.forEach((a, i) => {
    const x = cx(i), st = isStorm(a.w);
    s += `<g class="wx-wind${st ? " storm" : ""}" transform="translate(${f(x - 17)} 210)"><path d="${WIND_PATH}"/></g>` +
      `<text x="${f(x + 7)}" y="214" class="wx-gust${st ? " storm" : ""}">${Math.round(a.w.gust)}</text>`;
  });
  s += `</g>`;
  // the day estimate as a small ring: darker = more, like the ring above
  const R = 17, C = 2 * Math.PI * R, RY = 250;
  ahead.forEach((a, i) => {
    const p = a.est.pDay, step = p < 0.15 ? 1 : p < 0.25 ? 2 : p < 0.4 ? 3 : 4, x = cx(i);
    s += `<circle class="wx-ring" cx="${f(x)}" cy="${RY}" r="${R}"/>` +
      `<circle cx="${f(x)}" cy="${RY}" r="${R}" fill="none" stroke="var(--heat-${step})" stroke-width="6" stroke-dasharray="${f(p * C)} ${f(C)}" transform="rotate(-90 ${f(x)} ${RY})"/>` +
      `<text x="${f(x)}" y="${RY + 4}" class="wx-pct">${Math.round(100 * p)}<tspan dx="1" style="font-size:8px">%</tspan></text>`;
  });
  // one invisible target per column for the tooltip
  ahead.forEach((a, i) => {
    const k = wxKind(a.w), e = a.est, wd = WEEKDAYS_LONG[weekday(a.d)];
    const why = e.heat ? `an ${e.hotDay} von ${e.hot} Tagen ab ${HOT}\u00a0°C und an ${e.day} von ${e.n} ${wd}en gab es mindestens einen Einsatz`
      : `an ${e.day} von ${e.n} ${wd}en gab es mindestens einen Einsatz`;
    const tip = `<b>${wd}, ${fmtDate(isoDate(a.d))}</b><br>` +
      [k && k[1], `${Math.round(a.w.tmin)} bis ${Math.round(a.w.tmax)}\u00a0°C`, `Böen bis ${Math.round(a.w.gust)} km/h`].filter(Boolean).join(" · ") +
      (isStorm(a.w) ? "<br>Sturmböen" : "") + (isThunder(a.w) ? `<br>Gewitter ${i < 2 ? "angesagt" : "möglich"}` : "") +
      `<br>Schätzung tagsüber: <b>~${Math.round(100 * e.pDay)}\u00a0%</b><br>${why}`;
    s += `<rect class="wx-hit" x="${f(x0 + cw * i)}" y="0" width="${f(cw)}" height="${H}" data-tip="${esc(tip)}"/>`;
  });
  el.innerHTML = s + `</svg>`;
  const icon = (body) => `<svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">${body}</svg>`;
  $("#outlook-legend").innerHTML =
    `<span>${icon(`<g class="wx-wind" transform="translate(-7 1)"><path d="${WIND_PATH}"/></g>`)} Windböen in km/h</span>` +
    `<span>${icon(`<circle class="wx-ring" r="6.5" style="stroke-width:3"/><circle r="6.5" fill="none" stroke="var(--heat-3)" stroke-width="3" stroke-dasharray="16 41" transform="rotate(-90)"/>`)} ` +
    `Schätzung: mindestens ein Einsatz tagsüber</span>` +
    `<span><i class="wx-key hot"></i>ab ${HOT}\u00a0°C</span><span><i class="wx-key storm"></i>Sturmböen ab ${GUST} km/h oder Gewitter</span>`;
}

let chanceModel = null;

function renderChance() {
  const win = alarmWindows();
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = addDays(today, -1);
  const first = parseDate(ALL[ALL.length - 1].date);
  // Only count days the data fully covers: yesterday's night ends this morning, and days after the
  // last scrape or after the website's newest entry would otherwise look alarm-free.
  const scraped = new Date(UPDATED); scraped.setHours(0, 0, 0, 0);
  const lastFor = (d) => minDate(addDays(minDate(scraped, d), -2), addDays(LISTED, -1));
  const last = lastFor(today);

  const est = estimate(today, first, last, win);
  const estY = estimate(yesterday, first, lastFor(yesterday), win); // what the page said yesterday
  const wd = WEEKDAYS_LONG[weekday(today)];
  const sameDays = `an ${est.day} von ${est.n} ${wd}en`;
  const day = { short: "Tag", label: "Heute tagsüber", time: "6–22 Uhr", v: `~${Math.round(100 * est.pDay)} %`, d: est.heat
    ? `heute bis ${Math.round(est.tmax)} °C angesagt: an ${est.hotDay} von ${est.hot} so heißen Tagen gab es mindestens einen Einsatz, ${sameDays}`
    : `${sameDays} gab es mindestens einen Einsatz` };
  const ni = nightInfo(today, est, first, last);
  const night = { short: "Nacht", label: ni.name ? `Heute: ${ni.name}` : "Heute Nacht", time: "22–6 Uhr", v: ni.v, d: ni.d };
  const niY = nightInfo(yesterday, estY, first, lastFor(yesterday));
  const running = { short: "Nacht", label: niY.name ? `Diese ${niY.name}` : "Diese Nacht", time: "seit 22 Uhr", v: niY.v, d: niY.d };

  // The window we're in right now: before 6 it's still last night.
  const h = now.getHours();
  const cur = h < DAY_START ? running : h < NIGHT_START ? day : night;
  // the percentage shown for the window we're in, if it is one (special nights show past years instead)
  const pNow = h < DAY_START ? (niY.name ? null : estY.pNight) : h < NIGHT_START ? est.pDay : (ni.name ? null : est.pNight);
  const other = h < DAY_START ? day : h < NIGHT_START ? night : null;
  chanceModel = { key: `${isoDate(today)}-${cur === day}`, cur, other, first };
  drawRing();

  const tile = (w, active) => `<div class="tile${active ? " now" : ""}"><div class="l">${w.label} (${w.time})${active ? " · jetzt" : ""}</div>` +
    `<div class="v${/\d/.test(w.v) ? "" : " word"}">${w.v}</div><div class="d">${w.d}</div></div>`;
  $("#chance").innerHTML = tile(day, cur === day) + tile(night, cur === night);

  // Yesterday: what the page estimated against what has been entered since.
  const count = (n) => (n ? `${n} ${n === 1 ? "Einsatz" : "Einsätze"}` : "keiner");
  const iy = isoDate(yesterday);
  const rows = [["Gestern tagsüber", `~${Math.round(100 * estY.pDay)} %`, count(alarmsIn(iy, false))]];
  rows.push(h < DAY_START
    ? ["Diese Nacht", niY.v, "läuft noch"]
    : ["Letzte Nacht", niY.v, count(alarmsIn(iy, true))]);
  $("#t-yesterday tbody").innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("");
  // Last night reaches past midnight, which the website may not have reached yet.
  $("#yesterday-listed").textContent = yesterday > LISTED
    ? `Die Website hat bisher nur Einsätze bis ${fmtDate(isoDate(LISTED))} eingetragen. Hier zählen deshalb nur vorläufige Einträge.`
    : h >= DAY_START && isoDate(LISTED) === iy
      ? "Die Website hat bisher Einsätze bis gestern eingetragen. Einsätze nach Mitternacht fehlen in der letzten Zeile deshalb vielleicht noch."
      : "";

  $("#chance-method").textContent =
    (ni.name ? `Die ${ni.name} wird nicht mit anderen Nächten verglichen, sondern nur mit derselben Nacht in den Vorjahren. ` : "") +
    `So wird gerechnet: Für den Tag zählt, an wie vielen ${wd}en vom ${fmtDate(isoDate(first))} bis ${fmtDate(isoDate(last))} ` +
    `zwischen 6 und 22 Uhr mindestens ein Einsatz war. Weil das nur wenige Tage sind, wird der Wert etwas zum Durchschnitt ` +
    `aller Tage hin ausgeglichen (so, als kämen ${PRIOR} durchschnittliche Tage dazu). Sind ${HOT} °C oder mehr angesagt, ` +
    `werden zusätzlich die bisherigen so heißen Tage verglichen. Für die Nacht zählt der Anteil aller bisherigen Nächte mit Einsatz: ` +
    `Nachts hat sich kein Muster nach Wochentag oder Jahreszeit von einem Jahr aufs nächste gehalten. ` +
    `Wachbesetzungen zählen nicht, die Silvesternacht zählt nicht als vergleichbare Nacht.`;

  // The next days from the weather forecast, each with its day estimate.
  const ahead = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i), w = WEATHER[isoDate(d)];
    if (!w) break;
    ahead.push({ d, w, est: i ? estimate(d, first, last, win) : est });
  }
  chanceModel.ahead = ahead;
  renderOutlook(ahead, first, last, win);

  const bt = backtest(first, last, win);
  const num = (x) => x.toLocaleString("de-DE");
  const btRows = bt.bins.map((b) => {
    const range = b.hi > 100 ? `ab ${b.lo} %` : `${b.lo}–${b.hi} %`, rate = Math.round((100 * b.hit) / b.n);
    return { b, range, rate, fit: backtestFit(b, rate) };
  });
  $("#t-backtest tbody").innerHTML = btRows.map(({ b, range, rate, fit }) =>
    `<tr><td style="white-space:nowrap">${range}</td><td>${num(b.n)}-mal</td><td>${num(b.hit)} von ${num(b.n)} <span style="white-space:nowrap">(${rate} %)</span></td><td>${fit}</td></tr>`).join("");
  // Read one row out loud: the one with the most estimates.
  const ex = btRows.reduce((a, r) => (!a || r.b.n > a.b.n ? r : a), null); // null with under half a year of data
  $("#backtest-example").textContent = !ex ? "" :
    `So liest man eine Zeile: ${num(ex.b.n)}-mal sagte die Schätzung ${ex.range}. In ${num(ex.b.hit)} dieser Fälle gab es wirklich einen Einsatz, ` +
    `das sind ${ex.rate} %. ` + {
      "Ja": "Das liegt im geschätzten Bereich, die Schätzung passt also.",
      "Nein, zu niedrig": "Das liegt über dem geschätzten Bereich, hier lag die Schätzung also zu niedrig.",
      "Nein, zu hoch": "Das liegt unter dem geschätzten Bereich, hier lag die Schätzung also zu hoch.",
      "Zu wenige Fälle": "Das sind noch zu wenige Fälle, um es zu beurteilen.",
    }[ex.fit];

  // The short version: low, middle and high estimates, each as 100 dots with the ones that had an alarm filled in.
  const groups = BACKTEST_GROUPS.map(([lo, hi, label]) => {
    const bins = bt.bins.filter((b) => b.lo >= lo && b.lo < hi);
    const n = bins.reduce((a, b) => a + b.n, 0), hit = bins.reduce((a, b) => a + b.hit, 0);
    const rate = n ? Math.round((100 * hit) / n) : 0;
    return { lo, hi, label, n, hit, rate, fit: backtestFit({ lo, hi, n }, rate) };
  }).filter((g) => g.n);
  // Rounded first, so "jetzt ~10 %" never sits under "unter 10 %".
  const nowPct = pNow == null ? null : Math.round(100 * pNow);
  $("#backtest-note").textContent =
    `Für jeden Tag und jede Nacht ab ${fmtDate(isoDate(addDays(first, 182)))} wurde nachgerechnet, was die Schätzung damals gesagt hätte, ` +
    `und nachgesehen, ob es dann wirklich einen Einsatz gab (${num(bt.n)} Schätzungen). Jedes Bild zeigt das umgerechnet auf 100 solche Tage oder Nächte.`;
  const isNow = (g) => nowPct != null && nowPct >= g.lo && nowPct < g.hi;
  // A group with only a few estimates would fill a whole picture from a handful of days, so it is only
  // drawn when today's estimate falls into it ("Genaue Zahlen" still lists it), and it never decides the verdict.
  const sized = groups.filter((g) => g.n >= 50);
  const shown = groups.filter((g) => g.n >= 50 || isNow(g));
  const anyNow = shown.some(isNow);
  $("#backtest-odds").innerHTML = shown.map((g) => {
    const now = isNow(g);
    // the others keep an invisible tag so the dots of all three line up
    const tag = now ? `<span class="tag">jetzt ~${nowPct} %</span>` : anyNow ? '<span class="tag ghost">jetzt</span>' : "";
    return `<figure class="odd${now ? " now" : ""}" data-tip="Die Schätzung sagte ${g.label}: bei ${num(g.hit)} von ${num(g.n)} Schätzungen gab es wirklich einen Einsatz (${g.rate} %).">` +
      `<figcaption>Die Schätzung sagte<br><b>${g.label}</b>${tag}</figcaption>` +
      hundredDots(g.rate) +
      `<div class="odd-v"><b>${g.rate}</b> von 100</div><div class="odd-d">hatten einen Einsatz<br>${num(g.n)} Schätzungen${g.n < 50 ? ", noch zu wenige" : ""}</div></figure>`;
  }).join("");
  const low = sized[0], high = sized.at(-1), most = groups.reduce((a, g) => (!a || g.n > a.n ? g : a), null);
  const off = groups.filter((g) => g.fit.startsWith("Nein"));
  $("#backtest-verdict").textContent = !most ? "" : [
    sized.length > 1 && high.rate >= low.rate + 10 ? "Je höher die Schätzung, desto öfter gab es wirklich einen Einsatz."
      : sized.length > 1 ? "Nach hohen und niedrigen Schätzungen gab es bisher etwa gleich oft einen Einsatz." : "",
    off.length ? off.map((g) => `Im Bereich ${g.label} lag die Schätzung etwas zu ${g.fit === "Nein, zu niedrig" ? "niedrig" : "hoch"}: Es waren ${g.rate} von 100.`).join(" ")
      : "Die Zahlen passen ungefähr zu dem, was die Schätzung gesagt hat.",
    `Die meisten Schätzungen (${num(most.n)} von ${num(bt.n)}) lagen bei ${most.label}.` +
      (most !== low && most !== high ? " Die Schätzung unterscheidet also nur grob zwischen ruhigeren und unruhigeren Tagen." : ""),
  ].filter(Boolean).join(" ");
}

// Low, middle and high estimates for the short version of the check (percent from, to, label).
const BACKTEST_GROUPS = [[0, 10, "unter 10\u00a0%"], [10, 30, "10–30\u00a0%"], [30, 101, "ab 30\u00a0%"]];

// 10 × 10 dots, the first `k` filled: "k of 100".
function hundredDots(k) {
  let s = `<svg viewBox="0 0 100 100" class="dots100" role="img" aria-label="${k} von 100">`;
  for (let i = 0; i < 100; i++) {
    s += `<circle cx="${5 + (i % 10) * 10}" cy="${5 + Math.floor(i / 10) * 10}" r="3.8"${i < k ? ' class="on"' : ""}/>`;
  }
  return s + "</svg>";
}

// A row fits when the share that really had an alarm lies in the range the page said. Fewer than
// 50 estimates are too few to tell: one alarm more or less moves the share by several points.
function backtestFit(b, rate) {
  if (b.n < 50) return "Zu wenige Fälle";
  if (rate < b.lo) return "Nein, zu hoch";
  if (b.hi <= 100 && rate > b.hi) return "Nein, zu niedrig";
  return "Ja";
}

// ---------- Warnungen ----------
// Current official warnings, loaded in the browser when "Einsatz heute?" opens and every 5 minutes while it
// stays open. Weather warnings of the Deutscher Wetterdienst for the city come through Bright Sky, which
// lets any website load them. NINA adds the other warnings for the Region Hannover (civil protection,
// floods, police) where the browser may load them; its weather warnings are the same as the DWD's, so they
// are left out. Nothing is stored.
const WARN_EVERY = 5 * 60 * 1000;
const warn = { at: 0, busy: false, body: null };
const NINA_ARS = "032410000000"; // Region Hannover: NINA lists warnings per district, the last 7 digits are 0
const WARN_LEVEL = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
const NINA_KIND = { MOWAS: "Bevölkerungsschutz", LHP: "Hochwasser", POLICE: "Polizei", KATWARN: "Katwarn", BIWAPP: "Biwapp" };

function fetchJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  return fetch(url, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).finally(() => clearTimeout(t));
}

async function loadWarnings() {
  if (warn.busy) return;
  warn.busy = true;
  const [dwd, nina] = await Promise.all([
    fetchJSON(`https://api.brightsky.dev/alerts?lat=${WACHE[0]}&lon=${WACHE[1]}&tz=Europe/Berlin`).catch(() => null),
    fetchJSON(`https://warnung.bund.de/api31/dashboard/${NINA_ARS}.json`).catch(() => null),
  ]);
  Object.assign(warn, { busy: false, at: Date.now() });
  renderWarnings(dwd && Array.isArray(dwd.alerts) ? dwd.alerts : null, Array.isArray(nina) ? nina : null);
}

// "heute 14:00 bis 20:00 Uhr", "bis morgen 06:00 Uhr", "ab Fr 09.10. 18:00 Uhr"
function warnSpan(onset, expires, now) {
  const at = (d) => {
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    const day = days === 0 ? "heute" : days === 1 ? "morgen" : days === -1 ? "gestern" : `${WEEKDAYS[weekday(d)]} ${fmtDate(isoDate(d)).slice(0, 6)}`;
    return { day, hm: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
  };
  const a = onset && at(onset), b = expires && at(expires);
  if (!a) return b ? `bis ${b.day} ${b.hm} Uhr` : "";
  if (onset <= now) return b ? `bis ${b.day} ${b.hm} Uhr` : `seit ${a.day} ${a.hm} Uhr`;
  if (!b) return `ab ${a.day} ${a.hm} Uhr`;
  return a.day === b.day ? `${a.day} ${a.hm} bis ${b.hm} Uhr` : `${a.day} ${a.hm} bis ${b.day} ${b.hm} Uhr`;
}

// dwd, nina: the loaded lists, or null when they couldn't be loaded.
function renderWarnings(dwd, nina) {
  const now = new Date(), when = (s) => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d : null; };
  const items = [];
  for (const a of dwd || []) {
    const expires = when(a.expires);
    if (a.status !== "actual" || a.response_type === "allclear" || (expires && expires <= now)) continue;
    const level = WARN_LEVEL[a.severity] || 1;
    items.push({ level, tag: `${a.category === "health" ? "Hitze" : "Wetter"} · Stufe ${level} von 4`, title: a.headline_de || a.event_de || "",
      onset: when(a.onset), expires, text: a.description_de, todo: a.instruction_de });
  }
  for (const w of nina || []) {
    // NINA's weather warnings only stand in when the DWD's own list couldn't be loaded.
    const d = (w.payload && w.payload.data) || {}, expires = when(w.expires);
    if ((dwd && d.provider === "DWD") || d.msgType === "Cancel" || (expires && expires <= now)) continue;
    const level = WARN_LEVEL[String(d.severity).toLowerCase()] || 1;
    items.push({ level, tag: d.provider === "DWD" ? `Wetter · Stufe ${level} von 4` : NINA_KIND[d.provider] || "Warnung",
      title: (w.i18nTitle && w.i18nTitle.de) || d.headline || "", onset: when(w.onset || w.effective || w.sent), expires, nina: true });
  }
  items.sort((a, b) => b.level - a.level || (a.onset || 0) - (b.onset || 0));

  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const dwdLink = (text) => link("https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html", text);
  const ninaLink = link("https://warnung.bund.de/meldungen", "NINA");
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const sources = (dwd && nina ? `Wetterwarnungen für die Stadt Hannover: ${dwdLink("Deutscher Wetterdienst")}. Andere Warnungen für die Region Hannover: ${ninaLink}, die Warn-App des Bundes.`
    : dwd ? `Wetterwarnungen für die Stadt Hannover: ${dwdLink("Deutscher Wetterdienst")}. Andere Warnungen, etwa zu Bränden mit starkem Rauch oder zu Evakuierungen, stehen in der Warn-App ${ninaLink}.`
    : nina ? `Warnungen für die Region Hannover: ${ninaLink}, die Warn-App des Bundes, mit den Wetterwarnungen des ${dwdLink("Deutschen Wetterdienstes")}.`
    : `Die Warnungen konnten gerade nicht geladen werden. Sie stehen beim ${dwdLink("Deutschen Wetterdienst")} und in der Warn-App ${ninaLink}.`) +
    (dwd || nina ? ` Stand: ${hm} Uhr.` : "");
  const body = items.length
    ? `<h2>${items.length === 1 ? "Warnung" : "Warnungen"} für Hannover</h2>` + items.map((w) =>
      `<div class="warn l${w.level}"><div class="warn-meta"><span class="warn-tag">${esc(w.tag)}</span><span>${warnSpan(w.onset, w.expires, now)}</span></div>` +
      `<div class="warn-title">${esc(w.title)}</div>` +
      (w.text ? `<p class="warn-text">${esc(w.text)}</p>` : "") +
      (w.todo ? `<details class="warn-todo"><summary>Was tun?</summary><p>${esc(w.todo)}</p></details>` : "") +
      (w.nina ? `<p class="warn-text">Mehr dazu in ${ninaLink}.</p>` : "") + `</div>`).join("")
    : dwd || nina ? `<p class="warn-none"><span class="warn-ok" aria-hidden="true">✓</span>Für Hannover gibt es gerade keine ${nina ? "amtlichen Warnungen" : "Wetterwarnungen"}.</p>` : "";
  const el = $("#warnings");
  el.hidden = false;
  // Only redraw the list when it changed, so an opened "Was tun?" stays open over the refresh.
  if (body !== warn.body) {
    warn.body = body;
    el.innerHTML = `${body}<p class="note"></p>`;
  }
  el.lastElementChild.innerHTML = sources;
}

// While the view stays open, and when the page comes back after a while in the background.
const warnStale = () => Date.now() - warn.at > WARN_EVERY;
const warnShown = () => !document.hidden && $("section[data-view=chance]").classList.contains("active");
setInterval(() => { if (warnShown()) loadWarnings(); }, WARN_EVERY);
document.addEventListener("visibilitychange", () => { if (warnShown() && warnStale()) loadWarnings(); });

// ---------- Jahresrückblick ----------
// Keywords worth listing individually in the annual report.
const NOTABLE = /^(b2|b3|ob|ba2|bg2|abc2|hm2|hm3|hw\d|hu\d|manv.*)$/;

// What the annual report and the year story compare: a running year only up to the website's newest
// entry (later alarms exist only where they were entered by hand), against the same period a year earlier.
function yearInfo(year, storm) {
  const alarms = ALL.filter((r) => !r.standby && (storm || !r.bigDay));
  const rows = alarms.filter((r) => r.date.startsWith(year));
  const prev = alarms.filter((r) => r.date.startsWith(String(year - 1)));
  const lastDate = rows.length ? rows[0].date : "";
  const listed = isoDate(LISTED);
  // Not complete while the year runs, nor in January while the website still catches up on December.
  const running = Number(year) >= new Date().getFullYear();
  const partial = Boolean(lastDate) && (running || listed < `${year}-12-31`);
  const cutDate = partial ? minDate(lastDate, listed) : `${year}-12-31`;
  const cut = cutDate.startsWith(year) ? cutDate.slice(5) : "";
  const cmpRows = rows.filter((r) => r.date.slice(5) <= cut);
  const prevSame = partial ? prev.filter((r) => r.date.slice(5) <= cut) : prev;
  const delta = prevSame.length && cut ? Math.round((100 * (cmpRows.length - prevSame.length)) / prevSame.length) : null;
  return { alarms, rows, prev, lastDate, running, partial, listed, cutDate, cut, cmpRows, prevSame, delta };
}

// The days of a leap year, so every date sits at the same place in every year.
const DAY_SLOTS = Array.from({ length: 366 }, (_, i) => isoDate(addDays(new Date(2024, 0, 1), i)).slice(5));

// Alarms from 01.01. added up day by day; null after `until` (MM-DD), so the line stops there.
function runningTotal(rows, until) {
  const per = {};
  for (const r of rows) per[r.date.slice(5)] = (per[r.date.slice(5)] || 0) + 1;
  let sum = 0;
  return DAY_SLOTS.map((d) => (d > until ? null : (sum += per[d] || 0)));
}

// One line per year. The chosen year is coloured, the others grey, each with its total at the end.
// series: [{label, values, sel}], marks: [{i, text}] notes on the chosen line.
function raceChart(el, series, { height = 260, hover = true, marks = [] } = {}) {
  const W = el.clientWidth || 1000, H = height, L = 34, R = 72, T = 10, B = 24;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v !== null))));
  const x = (i) => L + ((W - L - R) * i) / 365;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const f = (n) => n.toFixed(1);
  const ends = series.map((s) => { const i = s.values.findLastIndex((v) => v !== null); return { s, i, v: s.values[i] }; });
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Einsätze seit 1. Januar: ${esc(ends.map((e) => `${e.s.label} ${e.v}`).join(", "))}">`;
  const steps = max % 4 === 0 ? 4 : 5;
  for (let k = 0; k <= steps; k++) {
    const v = (max / steps) * k;
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${f(y(v))}" y2="${f(y(v))}"/><text x="${L - 6}" y="${f(y(v) + 4)}" text-anchor="end">${Math.round(v)}</text>`;
  }
  const narrow = W < 600;
  MONTHS.forEach((m, k) => {
    if (!narrow || k % 3 === 0) svg += `<text x="${f(x(DAY_SLOTS.indexOf(`${String(k + 1).padStart(2, "0")}-15`)))}" y="${H - 6}" text-anchor="middle">${m}</text>`;
  });
  for (const e of [...ends].sort((a, b) => a.s.sel - b.s.sel)) { // chosen year last, on top
    const pts = e.s.values.slice(0, e.i + 1).map((v, i) => `${f(x(i))},${f(y(v))}`).join(" ");
    svg += `<polyline class="race${e.s.sel ? " sel" : ""}" pathLength="1" points="${pts}"/>`;
  }
  const sel = ends.find((e) => e.s.sel);
  for (const m of marks) svg += `<text class="anno" x="${f(x(m.i) - 6)}" y="${f(y(sel.s.values[m.i]) + 4)}" text-anchor="end">${esc(m.text)}</text>`;
  if (sel) svg += `<circle class="race-dot" cx="${f(x(sel.i))}" cy="${f(y(sel.v))}" r="4"/>`;
  // Totals at the line ends. Lines reaching 31.12. share the right margin; where they end close
  // together the labels are pushed apart and a short connector leads back to the line.
  const right = ends.filter((e) => x(e.i) > W - R - 60).map((e) => ({ ...e, ly: y(e.v) + 4 })).sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < right.length; k++) right[k].ly = Math.max(right[k].ly, right[k - 1].ly + 14);
  const over = right.length ? right[right.length - 1].ly - (H - B) : 0;
  if (over > 0) for (const e of right) e.ly -= over;
  for (const e of ends) {
    const r = right.find((o) => o.s === e.s);
    const cls = `end${e.s.sel ? " sel" : ""}`;
    if (!r) { svg += `<text class="${cls}" x="${f(x(e.i) + 8)}" y="${f(y(e.v) + 4)}">${esc(e.s.label)}: ${e.v}</text>`; continue; }
    if (Math.abs(r.ly - 4 - y(e.v)) > 2) svg += `<line class="leader" x1="${f(x(e.i) + 2)}" y1="${f(y(e.v))}" x2="${W - R + 5}" y2="${f(r.ly - 4)}"/>`;
    svg += `<text class="${cls}" x="${W - R + 8}" y="${f(r.ly)}">${esc(e.s.label)}: ${e.v}</text>`;
  }
  if (hover) {
    const bw = (W - L - R) / 365;
    DAY_SLOTS.forEach((d, i) => {
      const vals = ends.filter((e) => i <= e.i).sort((a, b) => b.s.label.localeCompare(a.s.label))
        .map((e) => `${e.s.label}: <b>${e.s.values[i]}</b>`).join("<br>");
      if (!vals) return;
      svg += `<g class="day"><line class="guide" x1="${f(x(i))}" x2="${f(x(i))}" y1="${T}" y2="${H - B}"/>` +
        `<rect class="hit" x="${f(x(i) - bw / 2)}" y="${T}" width="${f(bw)}" height="${H - T - B}" data-tip="${esc(`<b>${fmtDate(`2024-${d}`).slice(0, 6)}</b><br>${vals}`)}"/></g>`;
    });
  }
  el.innerHTML = svg + "</svg>" + (hover && sel && series.length > 1
    ? `<div class="legend"><i class="key sel"></i>${esc(sel.s.label)} <i class="key"></i>andere Jahre</div>` : "");
}

function renderYear() {
  const year = $("#y-year").value;
  const storm = $("#y-storm").checked;
  const info = yearInfo(year, storm);
  const { rows, prevSame, running, partial, lastDate, listed, cutDate, cut, delta } = info;

  const byDay = topCounts(rows, (r) => r.date, 1)[0];
  const byMonth = topCounts(rows, (r) => r.date.slice(5, 7), 1)[0];
  const known = rows.filter((r) => !r.timeUnknown);
  const night = known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length;
  const period = partial ? ` (jeweils bis ${fmtDate(cutDate).slice(0, 6)})` : "";
  const tiles = [
    ["Einsätze", rows.length, delta !== null ? `${delta >= 0 ? "+" : ""}${delta} % gegenüber ${year - 1}${period}` : ""],
    ["Stärkster Tag", byDay ? fmtDate(byDay[0]) : "–", byDay ? einsaetze(byDay[1].length) : ""],
    ["Stärkster Monat", byMonth ? MONTHS[Number(byMonth[0]) - 1] : "–", byMonth ? einsaetze(byMonth[1].length) : ""],
    ["Nachts", known.length ? Math.round((100 * night) / known.length) + " %" : "–", "zwischen 22 und 6 Uhr"],
  ];
  $("#y-tiles").innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");
  const byHand = rows.filter((r) => r.date > listed).length;
  const listNote = byHand ? `Die Website listet Einsätze bis ${fmtDate(listed)}, ${byHand === 1 ? "1 späterer ist" : `${byHand} spätere sind`} vorläufig eingetragen.`
    : `Die Website listet bisher Einsätze bis ${fmtDate(listed)}.`;
  $("#y-partial").textContent = !partial ? ""
    : running && !byHand ? `Das Jahr ${year} läuft noch: Daten bis ${fmtDate(lastDate)}.`
    : `${running ? `Das Jahr ${year} läuft noch. ` : ""}${listNote}`;
  // Named on screen and on the printout, so a reader knows whether the storm is in the numbers.
  const inView = (r) => r.date.startsWith(year) || (r.date.startsWith(String(year - 1)) && r.date.slice(5) <= cut);
  const big = topCounts(ALL.filter((r) => !r.standby && r.bigDay && inView(r)), (r) => r.date)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, l]) => `${fmtDate(d)} (${einsaetze(l.length)}${d.startsWith(year) ? "" : `, im Vergleich mit ${year - 1}`})`);
  $("#y-storm-note").textContent = big.length ? `Großlagen ${storm ? "mitgezählt" : "nicht mitgezählt"}: ${big.join(", ")}.` : "";

  // Every year's running total; a running year's line stops where its data does.
  const years = [...new Set(info.alarms.map((r) => r.date.slice(0, 4)))].sort();
  const series = years.map((y) => {
    const own = y === year ? info : yearInfo(y, storm);
    return { label: y, sel: y === year, values: runningTotal(own.rows, own.cut), own };
  }).filter((s) => s.values[0] !== null);
  const marks = storm ? topCounts(rows.filter((r) => r.bigDay && r.date.slice(5) <= cut), (r) => r.date)
    .map(([d]) => ({ i: DAY_SLOTS.indexOf(d.slice(5)), text: `Großlage ${fmtDate(d).slice(0, 6)}` })) : [];
  $("#y-race-note").textContent = "Einsätze ab dem 1. Januar, Tag für Tag zusammengezählt. Je steiler die Linie, desto mehr Einsätze in dieser Zeit." +
    series.filter((s) => s.own.partial).map((s) => ` Die Linie für ${s.label} endet am ${fmtDate(s.own.cutDate).slice(0, 6)}` +
      `${s.own.cutDate === s.own.listed ? ", dem Tag des neuesten Einsatzes auf der Website" : ""}.`).join("") +
    (series.some((s) => s.sel) ? "" : ` Für ${year} listet die Website noch keine Einsätze, deshalb fehlt diese Linie noch.`);
  raceChart($("#y-race"), series, { marks: series.some((s) => s.sel) ? marks : [] });

  const months = Array(12).fill(0);
  for (const r of rows) months[Number(r.date.slice(5, 7)) - 1]++;
  columnChart($("#y-months"), months.map((n, m) => ({ value: n, tip: `${MONTHS[m]} ${year}: <b>${einsaetze(n)}</b>`, tick: MONTHS[m] })), { height: 180 });

  const prevGroups = {};
  for (const r of prevSame) prevGroups[r.group] = (prevGroups[r.group] || 0) + 1;
  barList($("#y-groups"), topCounts(rows, (r) => r.group).map(([g, list]) => ({
    label: g, value: list.length, tip: `<b>${esc(g)}</b>: ${einsaetze(list.length)}<br>${year - 1}${partial ? ` bis ${fmtDate(cutDate).slice(0, 6)}` : ""}: ${prevGroups[g] || 0}`,
  })));

  const notable = rows.filter((r) => NOTABLE.test(r.base) || /presseportal/.test(r.remarks));
  $("#y-notable tbody").innerHTML = notable.map((r) =>
    `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.name)}</td><td>${esc(r.event)}</td><td>${esc(r.street)}, ${esc(r.district)}</td></tr>`).join("")
    || `<tr><td colspan="4">Keine</td></tr>`;
}

// ---------- Jahr als Story ----------
// Full-screen cards to tap or swipe through, one fact each, sized for a phone screenshot.
// Uses the year and the "Großlagen mitzählen" choice of the Jahresrückblick.
function storyCards(year, storm) {
  const info = yearInfo(year, storm);
  const { rows } = info;
  if (!rows.length) return [];
  const cards = [];
  const add = (theme, html, after) => cards.push({ theme, html, after });
  const num = (n, extra = "") => `<span data-to="${n}"${extra}>${n}</span>`;
  const dm = (iso) => fmtDate(iso).slice(0, 6);
  // big words shrink with their length so they stay on one line
  const fit = (text, max = 26) => `style="font-size:min(${max}cqw, ${(120 / text.length).toFixed(1)}cqw, 16cqh)"`;
  const pct = (n, of) => Math.round((100 * n) / of);
  const times = (n) => `<span class="st-nw">${n}-mal</span>`;

  add("red", `<div class="st-kicker">Freiwillige Feuerwehr Hannover-Linden</div><div class="st-title">Das Einsatzjahr ${year}</div>` +
    (info.partial ? `<div class="st-text">${info.running ? "Das Jahr läuft noch. " : ""}Gezählt ist alles bis zum ${fmtDate(info.lastDate)}.</div>` : "") +
    `<div class="st-small">Zum Weiterblättern tippen oder wischen.</div>`);

  // Average per week only over days the data fully covers.
  const covered = info.partial ? info.cmpRows : rows;
  const weeks = ((parseDate(info.cutDate) - parseDate(`${year}-01-01`)) / 864e5 + 1) / 7;
  const big = topCounts(ALL.filter((r) => !r.standby && r.bigDay && r.date.startsWith(year)), (r) => r.date)
    .sort(([a], [b]) => a.localeCompare(b));
  const bigText = big.length === 1 ? `die Großlage am ${dm(big[0][0])} mit ${einsaetze(big[0][1].length, true)}`
    : `die Großlagen am ${big.map(([d, l]) => `${dm(d)} (${einsaetze(l.length)})`).join(" und ")}`;
  add("dark", `<div class="st-kicker">Einsätze</div><div class="st-hero">${num(rows.length)}</div>` +
    // No average while the website hasn't reached the year yet (hand entries only, e.g. on 01.01.)
    (info.cut ? `<div class="st-text">Im Schnitt ${(covered.length / weeks).toFixed(1).replace(".", ",")} pro Woche.</div>` : "") +
    (big.length ? `<div class="st-small">${storm ? "Mitgezählt" : "Nicht mitgezählt"}: ${bigText}.</div>` : ""));

  const [bd, bl] = topCounts(rows, (r) => r.date, 1)[0];
  const [ev, evl] = topCounts(bl, (r) => r.event, 1)[0];
  const silvester = bd.slice(5) === "01-01" ? bl.filter((r) => !r.timeUnknown && r.hour < DAY_START).length : 0;
  add("amber", `<div class="st-kicker">Der stärkste Tag</div><div class="st-date">${WEEKDAYS_LONG[weekday(parseDate(bd))]}, ${fmtDate(bd)}</div>` +
    `<div class="st-hero">${num(bl.length)}</div>` +
    `<div class="st-text">Einsätze an einem Tag${silvester === bl.length ? ", alle in der Silvesternacht" : silvester ? `, ${silvester} davon in der Silvesternacht` : ""}.</div>` +
    (evl.length > 1 ? `<div class="st-small">Am häufigsten: „${esc(ev)}“ (${times(evl.length)})</div>` : ""));

  // Placeholder times (bulk-entered Großlagen) say nothing about the hour.
  const known = rows.filter((r) => !r.timeUnknown);
  const nightShare = known.length ? pct(known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length, known.length) : null;
  if (known.length) {
    const hours = Array(24).fill(0);
    for (const r of known) hours[r.hour]++;
    const top = Math.max(...hours), h = hours.indexOf(top);
    const same = hours.map((n, k) => (n === top && k !== h ? `${k}–${k + 1} Uhr` : "")).filter(Boolean);
    const word = h === 0 ? "Mitternacht" : `${h} Uhr`;
    add("navy", `<div class="st-kicker">Die häufigste Uhrzeit</div><div class="st-hero" ${fit(word)}>${word}</div>` +
      `<div class="st-text">Zwischen ${h} und ${h + 1} Uhr wurde am häufigsten alarmiert: ${times(top)}.</div>` +
      `<div class="st-hours"><div class="bars">${hours.map((n, k) => `<i class="${k === h ? "hi" : ""}" style="height:${Math.max(2, (100 * n) / top)}%;--k:${k}"></i>`).join("")}</div>` +
      `<div class="ticks"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 Uhr</span></div></div>` +
      (same.length ? `<div class="st-small">Genauso oft: ${same.join(", ")}.</div>` : ""));

    add("dark", `<div class="st-kicker">Nachts</div><div class="st-hero" ${fit(`${nightShare} %`)}>${num(nightShare)} %</div>` +
      `<div class="st-text">der Einsätze kamen zwischen 22 und 6 Uhr, also in 8 von 24 Stunden.</div>` +
      `<div class="st-split"><i style="flex-grow:${100 - nightShare}"></i><i class="hi" style="flex-grow:${nightShare}"></i></div>` +
      `<div class="st-legend"><span>Tag ${100 - nightShare} %</span><span>Nacht ${nightShare} %</span></div>`);
  }

  const kws = topCounts(rows, (r) => r.base, 3);
  const [kb, kl] = kws[0];
  add("red", `<div class="st-kicker">Das häufigste Stichwort</div><div class="st-hero" ${fit(kb, 30)}>${esc(kb)}</div>` +
    `<div class="st-text"><b>${esc(kl[0].name)}</b></div>` +
    `<div class="st-text">${times(num(kl.length))}, das sind ${pct(kl.length, rows.length)} % aller Einsätze.</div>` +
    (kws.length > 1 ? `<div class="st-small">Danach: ${kws.slice(1).map(([k, l]) => `${esc(k)} ${esc(l[0].name)} (${l.length})`).join(", ")}</div>` : ""));

  // Top three places, plus anything tied with the third, at most five.
  const places = topCounts(rows.filter((r) => r.street), (r) => r.street, 999);
  if (places.length) {
    const third = places[Math.min(2, places.length - 1)][1].length;
    const tied = places.filter(([, l]) => l.length >= third);
    const shown = tied.slice(0, 5), more = tied.length - shown.length;
    const most = shown[0][1].length;
    add("navy", `<div class="st-kicker">Die häufigsten Einsatzorte</div><ol class="st-rank">` +
      shown.map(([st, l], k) => `<li style="--k:${k}"><span>${esc(st)}<small>${esc(topCounts(l, (r) => r.district, 1)[0][0].replace("unbekannt", ""))}</small></span>` +
        `<span class="n">${l.length}</span><i style="width:${(100 * l.length) / most}%"></i></li>`).join("") + `</ol>` +
      (more ? `<div class="st-small">Und ${more === 1 ? "ein weiterer Ort" : `${more} weitere`} mit ${more === 1 ? "" : "je "}${third} ${third === 1 ? "Einsatz" : "Einsätzen"}.</div>` : ""));
  }

  // Longest run of days without any alarm (Großlagen always count here: a storm day is never quiet),
  // only up to the website's newest entry.
  const busy = new Set(ALL.filter((r) => !r.standby).map((r) => r.date));
  const quietEnd = info.partial ? info.listed : `${year}-12-31`;
  let quiet = null, from = null;
  for (let d = parseDate(`${year}-01-01`); isoDate(d) <= quietEnd; d = addDays(d, 1)) {
    const k = isoDate(d);
    if (busy.has(k)) { from = null; continue; }
    from ||= k;
    const len = Math.round((d - parseDate(from)) / 864e5) + 1;
    if (!quiet || len > quiet.len) quiet = { len, from, to: k };
  }
  if (quiet && quiet.len > 1) {
    add("amber", `<div class="st-kicker">Die längste Pause</div><div class="st-hero">${num(quiet.len)} <span class="st-unit">Tage</span></div>` +
      `<div class="st-text">ohne einen einzigen Einsatz, vom ${dm(quiet.from)} bis ${fmtDate(quiet.to)}.</div>`);
  }

  if (info.delta !== null) {
    const prevYear = String(year - 1);
    const period = info.partial ? ` (jeweils bis ${dm(info.cutDate)})` : "";
    const sign = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;
    const withBig = storm && [...info.cmpRows, ...info.prevSame].some((r) => r.bigDay);
    const without = withBig ? yearInfo(year, false).delta : null;
    add("navy", `<div class="st-kicker">Im Vergleich zu ${prevYear}</div>` +
      `<div class="st-hero" ${fit(`${sign(info.delta)} %`)}><span data-to="${info.delta}" data-sign="1">${sign(info.delta)}</span> %</div>` +
      `<div class="st-text">${einsaetze(info.cmpRows.length)} im Jahr ${year}, ${info.prevSame.length} im Jahr ${prevYear}${period}.</div>` +
      `<div class="st-chart"></div>` +
      (without !== null ? `<div class="st-small">Ohne Großlagen: ${sign(without)} %</div>` : ""),
      (root) => raceChart(root.querySelector(".st-chart"), [
        { label: prevYear, values: runningTotal(info.prevSame, info.cut) },
        { label: year, sel: true, values: runningTotal(info.cmpRows, info.cut) },
      ], { height: 180, hover: false }));
  }

  const facts = [
    ["Einsätze", rows.length],
    ["Nachts", nightShare === null ? "–" : `${nightShare} %`],
    ["Stärkster Tag", `${dm(bd)}<small>${einsaetze(bl.length)}</small>`],
    ["Längste Pause", quiet && quiet.len > 1 ? `${quiet.len} Tage` : "–"],
    ["Häufigstes Stichwort", esc(kb)],
    ["Häufigster Ort", places.length ? esc(places[0][0]) : "–"],
  ];
  add("red", `<div class="st-kicker">${year} in Zahlen</div>` +
    `<dl class="st-grid">${facts.map(([l, v]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join("")}</dl>` +
    `<div class="st-actions"><button type="button" data-story="restart">Von vorn</button><button type="button" data-story="close">Schließen</button></div>`);

  const foot = [storm ? "" : "Ohne Großlagen", info.partial ? `Stand ${fmtDate(info.lastDate)}` : ""].filter(Boolean).join(" · ");
  return cards.map((c, i) => ({
    ...c, html: `<div class="st-head">${i ? `FF Linden · Einsatzjahr ${year}` : ""}</div><div class="st-body">${c.html}</div><div class="st-foot">${foot}</div>`,
  }));
}

const story = { cards: [], i: 0 };
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Numbers count up from 0 when their card appears.
function countUp(el) {
  const to = Number(el.dataset.to);
  const show = (v) => { el.textContent = el.dataset.sign ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}` : String(v); };
  if (calm()) return show(to);
  const t0 = performance.now(), dur = 900 + Math.min(700, Math.abs(to) * 4);
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    show(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  show(0);
  requestAnimationFrame(tick);
}

function storyShow(i) {
  story.i = Math.max(0, Math.min(story.cards.length - 1, i));
  const c = story.cards[story.i], box = $("#story-card");
  $("#story-frame").className = `story-frame st-${c.theme}`;
  $("#story-bar").innerHTML = story.cards.map((_, k) => `<i class="${k < story.i ? "done" : k === story.i ? "now" : ""}"></i>`).join("");
  box.innerHTML = c.html;
  box.querySelectorAll(".st-body > *").forEach((el, k) => el.style.setProperty("--i", k));
  box.querySelectorAll("[data-to]").forEach(countUp);
  if (c.after) c.after(box);
  $("#story-prev").disabled = story.i === 0;
  $("#story-next").disabled = story.i === story.cards.length - 1;
}

function storyOpen() {
  story.cards = storyCards($("#y-year").value, $("#y-storm").checked);
  if (!story.cards.length) return;
  $("#story").hidden = false;
  document.body.classList.add("story-open");
  // The phone's back button closes the story instead of leaving the page.
  history.pushState({ story: true }, "");
  storyShow(0);
  $("#story-close").focus();
}

function storyHide() {
  $("#story").hidden = true;
  document.body.classList.remove("story-open");
  $("#story-card").innerHTML = "";
  $("#y-story").focus();
}
const storyClose = () => (history.state?.story ? history.back() : storyHide());

window.addEventListener("popstate", () => { if (!$("#story").hidden) storyHide(); });
$("#y-story").addEventListener("click", storyOpen);
$("#story-close").addEventListener("click", storyClose);
$("#story-prev").addEventListener("click", () => storyShow(story.i - 1));
$("#story-next").addEventListener("click", () => storyShow(story.i + 1));
// Tap the left third to go back, anywhere else to go on; or swipe.
let storyDown = null;
$("#story-card").addEventListener("pointerdown", (e) => { storyDown = e.clientX; });
$("#story-card").addEventListener("pointerup", (e) => {
  if (storyDown === null || e.target.closest("button")) { storyDown = null; return; }
  const dx = e.clientX - storyDown, box = e.currentTarget.getBoundingClientRect();
  storyDown = null;
  if (Math.abs(dx) > 40) storyShow(story.i + (dx < 0 ? 1 : -1));
  else storyShow(story.i + (e.clientX < box.left + box.width / 3 ? -1 : 1));
});
$("#story-card").addEventListener("pointercancel", () => { storyDown = null; });
$("#story-card").addEventListener("click", (e) => {
  const act = e.target.closest("[data-story]");
  if (act) { if (act.dataset.story === "restart") storyShow(0); else storyClose(); }
});
document.addEventListener("keydown", (e) => {
  if ($("#story").hidden) return;
  if (e.key === "Escape") storyClose();
  else if (e.key === "ArrowRight" || (e.key === " " && !e.target.closest("button"))) { e.preventDefault(); storyShow(story.i + 1); }
  else if (e.key === "ArrowLeft") storyShow(story.i - 1);
});

// ---------- Karte ----------
let map, heat;

// Each script loads once, however many views ask for it (the Karte and the Einsatzradius both use Leaflet).
const scripts = {};
function loadScript(src) {
  return (scripts[src] ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok;
    s.onerror = (e) => { delete scripts[src]; fail(e); };
    document.head.appendChild(s);
  }));
}
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

async function renderMap(rows) {
  const el = $("#c-map");
  const points = [];
  const located = [];
  let missing = 0;
  for (const r of rows) {
    // Positions are stored under the spelling as entered; a new spelling of a known street isn't looked up yet.
    const p = GEO[r.geoKey] || GEO[`${r.street}|${r.district}`];
    if (p) { points.push([p[0], p[1], 1]); located.push({ p, date: r.date }); } else missing++;
  }
  // Only a new selection resets a running time-lapse, not a redraw (a phone's toolbar hiding resizes the window).
  located.reverse(); // oldest first
  const key = located.map((l) => l.date + l.p).join("|");
  if (key !== replay.key || !el.offsetWidth) {
    replaySetup(located);
    replay.key = key;
  }
  $("#map-note").textContent = Object.keys(GEO).length
    ? `${einsaetze(points.length)} auf der Karte.` +
      (missing ? ` ${missing} ohne bekannte Adresse (z. B. Autobahn) ${missing === 1 ? "fehlt" : "fehlen"}.` : "")
    : "Die Karte erscheint nach der nächsten täglichen Aktualisierung.";
  el.hidden = !points.length;
  if (!points.length || !el.offsetWidth) {
    // A heat layer on a hidden map has zero size and throws on redraw, so drop it until visible.
    if (heat) { map.removeLayer(heat); heat = null; }
    return;
  }
  await loadScript(LEAFLET);
  await loadScript("https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js");
  if (!map) {
    map = L.map(el).setView([52.37, 9.73], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const Clock = L.Control.extend({ options: { position: "topright" }, onAdd: () => L.DomUtil.create("div", "rp-clock") });
    replay.clock = new Clock().addTo(map).getContainer();
    replay.clock.hidden = true;
  }
  map.invalidateSize();
  if (heat) map.removeLayer(heat);
  // One warm hue from faint to strong; brighter = more alarms nearby.
  heat = L.heatLayer(points, {
    radius: 22, blur: 18, minOpacity: 0.25, max: 4,
    gradient: { 0.2: "#fde2c4", 0.45: "#f7a35c", 0.7: "#e4572e", 1: "#a3160d" },
  }).addTo(map);
}

// ---------- Zeitraffer ----------
// Plays the selected alarms on the map in date order: each one flashes where it happened and stays
// as a faint dot, so busy places build up. `pos` counts days since the first alarm.
const replay = { rows: [], key: "", first: null, days: 0, pos: 0, shown: 0, layer: null, clock: null, raf: 0 };

function replayStop() {
  cancelAnimationFrame(replay.raf);
  replay.raf = 0;
  $("#rp-play").textContent = replay.pos >= replay.days && replay.layer ? "▶ Nochmal abspielen"
    : replay.layer ? "▶ Weiter" : "▶ Zeitraffer abspielen";
}

function replayClear() {
  if (map && replay.layer) map.removeLayer(replay.layer);
  replay.layer = null;
  replay.pos = 0;
  replay.shown = 0;
  replayStop();
  if (replay.clock) replay.clock.hidden = true;
  $("#rp-pos").value = 0;
  $("#rp-reset").hidden = true;
}

function replaySetup(rows) {
  replayClear();
  replay.rows = rows;
  replay.first = rows.length ? parseDate(rows[0].date) : null;
  replay.days = rows.length ? Math.round((parseDate(rows[rows.length - 1].date) - replay.first) / 864e5) : 0;
  $("#rp-pos").max = replay.days;
  $("#rp-play").disabled = !rows.length;
}

// Show every alarm up to day `pos`; new ones flash only while playing, not when jumping with the slider.
function replayShow(pos, flash) {
  if (pos < replay.pos || !replay.layer) {
    if (replay.layer) map.removeLayer(replay.layer);
    replay.layer = L.layerGroup().addTo(map);
    replay.shown = 0;
  }
  const until = isoDate(addDays(replay.first, Math.floor(pos)));
  let n = replay.shown;
  for (; n < replay.rows.length && replay.rows[n].date <= until; n++) {
    L.circleMarker(replay.rows[n].p, { radius: 6, stroke: false, interactive: false, className: flash ? "rp-dot rp-flash" : "rp-dot" })
      .addTo(replay.layer);
  }
  replay.shown = n;
  replay.pos = pos;
  replay.clock.hidden = false;
  replay.clock.innerHTML = `<b>${fmtDate(until)}</b>${n} ${n === 1 ? "Einsatz" : "Einsätze"}`;
  $("#rp-pos").value = Math.floor(pos);
  $("#rp-reset").hidden = false;
  if (heat && map.hasLayer(heat)) map.removeLayer(heat);
}

function replayPlay() {
  if (!map || !replay.rows.length) return;
  if (replay.raf) { replayStop(); return; } // the button doubles as pause
  if (replay.pos >= replay.days) replayClear(); // finished: start over
  if (!replay.layer) replayShow(0, true);
  $("#c-map").scrollIntoView({ block: "nearest", behavior: "smooth" }); // on phones the map sits below the controls
  $("#rp-play").textContent = "❚❚ Pause";
  let last = performance.now();
  const step = (now) => {
    // at most 0.1 s per frame, so a tab left in the background doesn't jump ahead
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const pos = Math.min(replay.days, replay.pos + dt * Number($("#rp-speed").value));
    replayShow(pos, true);
    if (pos >= replay.days) { replay.raf = 0; replayStop(); return; }
    replay.raf = requestAnimationFrame(step);
  };
  replay.raf = requestAnimationFrame(step);
}

$("#rp-play").addEventListener("click", replayPlay);
$("#rp-pos").addEventListener("input", (e) => {
  if (!map || !replay.rows.length) return;
  replayStop();
  replayShow(Number(e.target.value), false);
  replayStop(); // relabel the button now that there is something on the map
});
$("#rp-reset").addEventListener("click", () => {
  replayClear();
  if (heat) heat.addTo(map);
});

// ---------- Einsatzradius ----------
// A line from the Wache to every alarm, over a grey map; "Abspielen" sends the lines out in date order.
// Distances are straight lines on a flat grid around the Wache, which is close enough within a city.
const WACHE = [52.36847, 9.71195]; // Teichstraße 8 (two map services agree to within 25 m)
const KM_X = 111.32 * Math.cos((WACHE[0] * Math.PI) / 180), KM_Y = 110.57;
const RADIUS_BINS = [[0, 0.5, "bis 500 m"], [0.5, 1, "0,5–1 km"], [1, 2, "1–2 km"], [2, 3, "2–3 km"], [3, 5, "3–5 km"], [5, Infinity, "über 5 km"]];
const FLY = 900, FADE = 900; // ms a line takes to reach its alarm, and to fade out after it lands
const radius = { map: null, canvas: null, clock: null, dpr: 1, pts: [], key: "", first: null, days: 0,
  shown: null, queue: [], flights: [], playing: false, day: 0, t: 0, raf: 0 };

function fmtKm(k) {
  const m = Math.round(k * 100) * 10;
  return m < 1000 ? `${m} m` : `${k.toFixed(1).replace(".", ",")} km`;
}

// The located alarms, oldest first, with their distance and the day since the first one.
function radiusPoints(rows) {
  const pts = [];
  for (const r of rows) {
    const ll = GEO[r.geoKey] || GEO[`${r.street}|${r.district}`];
    if (!ll) continue;
    const km = Math.hypot((ll[1] - WACHE[1]) * KM_X, (ll[0] - WACHE[0]) * KM_Y);
    pts.push({ r, ll, km, kind: dotKind(r) });
  }
  pts.reverse();
  const first = pts.length ? parseDate(pts[0].r.date) : null;
  for (const p of pts) p.day = Math.round((parseDate(p.r.date) - first) / 864e5);
  return pts;
}

async function renderRadius(rows) {
  const el = $("#c-radius");
  const pts = radiusPoints(rows);
  // Only a new selection resets a running playback, not a redraw.
  const key = pts.map((p) => p.r.date + p.r.time + p.ll).join("|");
  if (key !== radius.key) {
    radiusReset();
    Object.assign(radius, { pts, key, first: pts.length ? parseDate(pts[0].r.date) : null, days: pts.length ? pts.at(-1).day : 0 });
  }
  const missing = rows.length - pts.length;
  $("#radius-note").textContent = !Object.keys(GEO).length ? "Die Karte erscheint nach der nächsten täglichen Aktualisierung."
    : missing ? `${missing} ${missing === 1 ? "Einsatz" : "Einsätze"} ohne bekannte Adresse (z. B. Autobahn) ${missing === 1 ? "fehlt" : "fehlen"}.` : "";
  radiusStats();
  $("#ra-play").disabled = !pts.length;
  el.hidden = !pts.length;
  if (!el.offsetWidth) {
    if (radius.playing) radiusPause(); // leaving the view pauses it
    return;
  }
  await loadScript(LEAFLET);
  if (!radius.map) radiusMap(el);
  radius.map.invalidateSize();
  radiusSize();
  radiusDraw();
  radiusOutside();
}

function radiusMap(el) {
  // All alarms lie within about 11 km, so the map stays around the region: zoomed out no further than
  // zoom 9, and no further away than 150 km.
  const map = (radius.map = L.map(el, { zoomSnap: 0.25, minZoom: 9, maxBounds: L.latLng(WACHE).toBounds(300000) }));
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const Clock = L.Control.extend({ options: { position: "topright" }, onAdd: () => L.DomUtil.create("div", "rp-clock") });
  radius.clock = new Clock().addTo(map).getContainer();
  radius.clock.hidden = true;
  // The lines go on a canvas over the map and under its buttons, redrawn whenever the map moves.
  radius.canvas = L.DomUtil.create("canvas", "ra-canvas", el);
  radiusFit("near");
  map.on("resize", () => { radiusSize(); radiusDraw(); });
  map.on("move", () => radiusDraw());
  map.on("moveend", radiusOutside);
  // The canvas can't follow Leaflet's zoom animation, so it steps aside until the zoom ends.
  map.on("zoomanim", () => { radius.canvas.style.visibility = "hidden"; });
  map.on("zoomend", () => { radius.canvas.style.visibility = ""; radiusDraw(); });
  // The page's tooltip shows whatever data-tip the pointer is over, so the map carries the nearest alarm's.
  map.on("mousemove", (e) => {
    const g = radiusNear(e.containerPoint);
    if (g) el.dataset.tip = radiusTip(g); else delete el.dataset.tip;
  });
  map.on("mouseout", () => { delete el.dataset.tip; });
  map.on("click", (e) => {
    const g = radiusNear(e.containerPoint);
    if (g) placeTip(radiusTip(g), e.originalEvent.clientX, e.originalEvent.clientY); else tip.hidden = true;
  });
}

function radiusSize() {
  const { canvas } = radius, el = $("#c-radius"), dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = el.clientWidth * dpr;
  canvas.height = el.clientHeight * dpr;
  canvas.style.width = el.clientWidth + "px";
  canvas.style.height = el.clientHeight + "px";
  radius.dpr = dpr;
}

// "near": Linden, 3 km around the Wache; "all": every alarm of the selection.
function radiusFit(which) {
  const { map, pts } = radius;
  if (!map) return;
  if (which === "all" && pts.length) map.fitBounds(L.latLngBounds([WACHE, ...pts.map((p) => p.ll)]), { padding: [24, 24] });
  else map.fitBounds(L.latLng(WACHE).toBounds(6000));
}

function radiusOutside() {
  if (!radius.map) return;
  const b = radius.map.getBounds(), out = radius.pts.filter((p) => !b.contains(p.ll)).length;
  $("#radius-outside").textContent = out ? `${out} ${out === 1 ? "Einsatz liegt" : "Einsätze liegen"} außerhalb des Ausschnitts.` : "";
}

// Tiles and distance bars count what's on the map: every alarm, or the ones sent out so far while playing.
function radiusStats() {
  const list = radius.shown || radius.pts;
  const km = list.map((p) => p.km).sort((a, b) => a - b);
  const far = list.reduce((m, p) => (!m || p.km > m.km ? p : m), null);
  $("#radius-tiles").innerHTML = [
    [km.length ? fmtKm(km[Math.floor(km.length / 2)]) : "–", "Die Hälfte der Einsätze liegt näher als das"],
    [km.length ? `${pct(km.filter((k) => k <= 2).length, km.length)} %` : "–", "im Umkreis von 2 km"],
    [far ? fmtKm(far.km) : "–", "am weitesten weg", far ? `${esc(far.r.street)}, ${esc(far.r.district)}, ${fmtDate(far.r.date)}` : ""],
  ].map(([v, l, d]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div>${d ? `<div class="d">${d}</div>` : ""}</div>`).join("");
  const count = (l, [lo, hi]) => l.filter((p) => p.km >= lo && p.km < hi).length;
  barList($("#c-radius-km"), RADIUS_BINS.map((b) => {
    const n = count(list, b);
    return { label: b[2], value: n, tip: `${b[2]}: ${einsaetze(n)}${list.length ? ` (${pct(n, list.length)} %)` : ""}` };
  }), { labelWidth: 90, scaleTo: Math.max(1, ...RADIUS_BINS.map((b) => count(radius.pts, b))) });
}

// The alarms at the dot nearest to the pointer (one street shares one spot on the map), oldest first.
function radiusNear(at) {
  const now = performance.now();
  const list = (radius.shown || radius.pts).filter((p) => !radius.shown || !(p.land > now));
  let best = null, bd = 12;
  for (const p of list) {
    const q = radius.map.latLngToContainerPoint(p.ll), d = Math.hypot(q.x - at.x, q.y - at.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best && list.filter((p) => p.ll[0] === best.ll[0] && p.ll[1] === best.ll[1]);
}

function radiusTip(group) {
  const p = group.at(-1), r = p.r;
  const place = `${esc(r.street)}, ${esc(r.district)}`;
  if (group.length === 1) {
    return `<b>${fmtDate(r.date)}${r.timeUnknown ? "" : `, ${r.time} Uhr`}</b><br>${esc(r.name)}${r.event ? ` · ${esc(r.event)}` : ""}<br>${place}<br>${fmtKm(p.km)} Luftlinie`;
  }
  return `<b>${place}</b><br>${einsaetze(group.length)}, ${fmtKm(p.km)} Luftlinie<br>zuletzt ${fmtDate(r.date)}: ${esc(r.name)}`;
}

function radiusDraw(now = performance.now()) {
  const { map, canvas, dpr } = radius;
  if (!map || !canvas.width) return;
  const ctx = canvas.getContext("2d"), W = canvas.width / dpr, H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), color = (k) => css.getPropertyValue(k).trim();
  const spoke = color("--accent"), halo = color("--surface"), ink = color("--text"), edge = color("--panel");
  const kindColor = Object.fromEntries(DOT_ORDER.map((k) => [k, color(`--dot-${k}`)]));
  const font = getComputedStyle(document.body).fontFamily;
  const label = (text, x, y, weight = 400) => {
    ctx.font = `${weight} 12px ${font}`;
    ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeStyle = halo; ctx.strokeText(text, x, y);
    ctx.fillStyle = ink; ctx.fillText(text, x, y);
  };
  const o = map.latLngToContainerPoint(WACHE);
  // Pixels per km from the unrounded map position: container points are whole pixels, so 1 km can come out
  // as 0 pixels when zoomed far out.
  const z = map.getZoom(), perKm = map.project(WACHE, z).y - map.project([WACHE[0] + 1 / KM_Y, WACHE[1]], z).y;
  const at = (p) => map.latLngToContainerPoint(p.ll);
  // A slight bend to the right of the direction of travel, so lines to one street don't hide each other.
  const bend = (q) => [(o.x + q.x) / 2 - (q.y - o.y) * 0.18, (o.y + q.y) / 2 + (q.x - o.x) * 0.18];

  // Rings every 1, 2, 5, 10, 20 … km, the smallest step that keeps them at least 50 pixels apart,
  // and only those that cross the visible map (the Wache can be off the map).
  const rings = [];
  if (perKm > 0) {
    let step = 1;
    for (let i = 0; step * perKm < 50; i++) step *= [2, 2.5, 2][i % 3];
    const near = Math.hypot(Math.max(0, -o.x, o.x - W), Math.max(0, -o.y, o.y - H));
    const reach = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y));
    for (let k = Math.max(1, Math.ceil(near / perKm / step)) * step; k * perKm < reach; k += step) rings.push(k);
  }
  ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  for (const k of rings) { ctx.beginPath(); ctx.arc(o.x, o.y, k * perKm, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  const list = radius.shown || radius.pts;
  if (!radius.shown) { // at rest every line faintly, a star around the Wache
    ctx.strokeStyle = spoke; ctx.globalAlpha = 0.2; ctx.lineWidth = 1; ctx.beginPath();
    for (const p of list) { const q = at(p), [mx, my] = bend(q); ctx.moveTo(o.x, o.y); ctx.quadraticCurveTo(mx, my, q.x, q.y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1; ctx.strokeStyle = edge;
  for (const p of list) {
    if (radius.shown && p.land > now) continue; // still on its way
    const q = at(p);
    ctx.fillStyle = kindColor[p.kind]; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
  // Each new alarm: the line grows from the Wache, then fades while a ring spreads where it landed.
  radius.flights = radius.flights.filter((f) => now - f.t < FLY + FADE);
  for (const f of radius.flights) {
    const age = now - f.t;
    if (age < 0) continue;
    const q = at(f.p), [mx, my] = bend(q), e = 1 - (1 - Math.min(1, age / FLY)) ** 3;
    const pt = (t) => [(1 - t) ** 2 * o.x + 2 * (1 - t) * t * mx + t * t * q.x, (1 - t) ** 2 * o.y + 2 * (1 - t) * t * my + t * t * q.y];
    ctx.globalAlpha = age < FLY ? 0.9 : 0.9 * (1 - (age - FLY) / FADE);
    ctx.strokeStyle = spoke; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(o.x, o.y);
    for (let i = 1; i <= 24; i++) ctx.lineTo(...pt((i / 24) * e));
    ctx.stroke();
    ctx.beginPath();
    if (age < FLY) { ctx.fillStyle = spoke; ctx.arc(...pt(e), 2.5, 0, 2 * Math.PI); ctx.fill(); }
    else { ctx.strokeStyle = kindColor[f.p.kind]; ctx.lineWidth = 2; ctx.arc(q.x, q.y, 3 + ((age - FLY) / FADE) * 14, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // ring labels on top of the dots, above each ring (below it where the top is off the map)
  ctx.textAlign = "center";
  for (const k of rings) {
    const y = o.y - k * perKm - 4;
    label(`${k} km`, o.x, y > 14 ? y : o.y + k * perKm + 14);
  }
  // the Wache
  ctx.fillStyle = spoke; ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.rect(o.x - 6, o.y - 6, 12, 12); ctx.fill(); ctx.stroke();
  ctx.textAlign = "left";
  label("Wache", o.x + 10, o.y + 16, 600);
}

// ---------- Einsatzradius: playback ----------
function radiusReset() {
  cancelAnimationFrame(radius.raf);
  Object.assign(radius, { raf: 0, playing: false, shown: null, queue: [], flights: [] });
  $("#ra-play").textContent = "▶ Abspielen";
  if (radius.clock) radius.clock.hidden = true;
}

function radiusPause() {
  radius.playing = false; // lines already on their way still land
  $("#ra-play").textContent = "▶ Weiter";
}

function radiusPlay() {
  if (!radius.map || !radius.pts.length) return;
  if (radius.playing) return radiusPause();
  if (!radius.shown) { // start from the first alarm, a moment before it
    Object.assign(radius, { shown: [], queue: [...radius.pts], flights: [], day: -3 });
    radiusStats();
  }
  radius.playing = true;
  $("#ra-play").textContent = "❚❚ Pause";
  radius.clock.hidden = false;
  $("#c-radius").scrollIntoView({ block: "nearest", behavior: "smooth" }); // on phones the map sits below the controls
  if (!radius.raf) { radius.t = performance.now(); radius.raf = requestAnimationFrame(radiusFrame); }
}

function radiusFrame(now) {
  // at most 0.1 s per frame, so a tab left in the background doesn't jump ahead
  const dt = Math.min(0.1, (now - radius.t) / 1000);
  radius.t = now;
  if (radius.playing) {
    radius.day += dt * Number($("#ra-speed").value);
    const before = radius.shown.length;
    while (radius.queue.length && radius.queue[0].day <= radius.day) {
      const p = radius.queue.shift(), t = now + (calm() ? 0 : Math.random() * 250);
      p.land = calm() ? 0 : t + FLY;
      radius.shown.push(p);
      if (!calm()) radius.flights.push({ p, t });
    }
    if (radius.shown.length !== before) radiusStats();
    const day = Math.max(0, Math.min(radius.days, Math.floor(radius.day)));
    radius.clock.innerHTML = `<b>${fmtDate(isoDate(addDays(radius.first, day)))}</b>${einsaetze(radius.shown.length)}`;
    if (!radius.queue.length && !radius.flights.length) { // all landed: back to the whole picture
      Object.assign(radius, { playing: false, shown: null });
      $("#ra-play").textContent = "▶ Nochmal abspielen";
      radius.clock.hidden = true;
      radiusStats();
    }
  }
  radiusDraw(now);
  radius.raf = radius.playing || radius.flights.length ? requestAnimationFrame(radiusFrame) : 0;
}

$("#ra-play").addEventListener("click", radiusPlay);
document.querySelectorAll("[data-radius]").forEach((b) => b.addEventListener("click", () => radiusFit(b.dataset.radius)));

// ---------- Wetter ----------
const WEATHER_BUCKETS = [
  ["Windböen", "gust", [[0, 40, "unter 40 km/h"], [40, 60, "40–60 km/h"], [60, 80, "60–80 km/h"], [80, 999, "ab 80 km/h"]]],
  ["Niederschlag", "rain", [[0, 0.1, "trocken"], [0.1, 5, "bis 5 mm"], [5, 20, "5–20 mm"], [20, 999, "ab 20 mm"]]],
  ["Höchsttemperatur", "tmax", [[-99, 0, "unter 0 °C"], [0, 10, "0–10 °C"], [10, 20, "10–20 °C"], [20, 30, "20–30 °C"], [30, 99, "ab 30 °C"]]],
];

function renderWeather(rows, year, dropped) {
  const box = $("#c-weather");
  const days = Object.keys(WEATHER);
  if (!days.length) {
    box.innerHTML = `<p class="note">Die Wetterdaten erscheinen nach der nächsten täglichen Aktualisierung.</p>`;
    return;
  }
  const perDay = {};
  for (const r of rows) perDay[r.date] = (perDay[r.date] || 0) + 1;
  const first = rows.length ? rows[rows.length - 1].date : "";
  const last = isoDate(minDate(addDays(UPDATED, -1), addDays(LISTED, -1)));
  // Only days the selection covers: the chosen year, and not the Großlage days that were filtered out
  // (they'd otherwise count as stormy days without alarms). Silvester and Neujahr are left out too: their
  // fireworks alarms come whatever the weather, and two stormy Neujahr days made windy days look busy.
  const covered = days.filter((d) => d >= first && d <= last && (!year || d.startsWith(year)) && !dropped.has(d) &&
    !["12-31", "01-01"].includes(d.slice(5)));
  // Without a mouse the tooltip never shows, so the number of days goes next to the label.
  const touch = matchMedia("(hover: none)").matches;
  const tage = (n) => `${n} ${n === 1 ? "Tag" : "Tage"}`;
  box.innerHTML = WEATHER_BUCKETS.map(([title, , ], i) => `<h2>${title}</h2><div class="chart" id="c-weather-${i}"></div>`).join("");
  WEATHER_BUCKETS.forEach(([title, field, buckets], i) => {
    barList($(`#c-weather-${i}`), buckets.map(([lo, hi, label]) => {
      const ds = covered.filter((d) => WEATHER[d][field] >= lo && WEATHER[d][field] < hi);
      const n = ds.reduce((a, d) => a + (perDay[d] || 0), 0);
      const avg = ds.length ? n / ds.length : 0;
      return {
        label: touch && ds.length ? `${label} · ${tage(ds.length)}` : label,
        value: Math.round(avg * 100) / 100, display: ds.length ? avg.toFixed(2).replace(".", ",") : "keine Tage",
        tip: `<b>${label}</b><br>${tage(ds.length)}, ${einsaetze(n)}<br>Ø ${avg.toFixed(2).replace(".", ",")} pro Tag`,
      };
    }));
  });
}

// ---------- Mythen-Check ----------
// Popular beliefs tested against the alarms. The days of a myth are compared with similar days (by
// default the same weekday, at most 30 days from the same date in any year). Drawing one similar day
// for each myth day, many times over, shows how far the average moves by chance alone.
let FERIEN = [];     // school holidays in Lower Saxony, [[first, last], ...] from data/ferien.json
let HEIMSPIELE = []; // Hannover 96 home games, from data/heimspiele.json
let mythCache = null;

// Full moons after Meeus, "Astronomical Algorithms", ch. 49 (a few minutes off at most), as Hannover dates.
function fullMoons(from, to) {
  const rad = Math.PI / 180, out = [];
  const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }); // "YYYY-MM-DD"
  for (let k = Math.floor((from.getFullYear() - 2000) * 12.3685) - 1.5; ; k++) {
    const T = k / 1236.85;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;
    const M = (2.5534 + 29.1053567 * k) * rad;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * rad;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * rad;
    const O = (124.7746 - 1.56375588 * k) * rad;
    const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T
      - 0.40614 * Math.sin(Mp) + 0.17302 * E * Math.sin(M) + 0.01614 * Math.sin(2 * Mp) + 0.01043 * Math.sin(2 * F)
      + 0.00734 * E * Math.sin(Mp - M) - 0.00515 * E * Math.sin(Mp + M) + 0.00209 * E * E * Math.sin(2 * M)
      - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M)
      - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F)
      - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(O);
    const when = new Date((jde - 2440587.5) * 864e5);
    if (when > addDays(to, 1)) return out;
    if (when >= addDays(from, -1)) out.push(berlin.format(when));
  }
}

// Public holidays in Lower Saxony, without 01.01 (that one is Silvester's)
function holidays(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4; // Easter, Gauss/Meeus
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  return [addDays(easter, -2), addDays(easter, 1), new Date(y, 4, 1), addDays(easter, 39), addDays(easter, 50),
    new Date(y, 9, 3), new Date(y, 9, 31), new Date(y, 11, 25), new Date(y, 11, 26)].map(isoDate);
}

// Seeded random numbers (mulberry32), so the result stays the same on every visit until new alarms come in
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// days: [{date, wd, doy, n}]. Returns the myth days' average and what similar days give by chance.
function testMyth(days, is, similar, seed) {
  const hits = days.filter(is), others = days.filter((o) => !is(o));
  const paired = hits.map((h) => [h, others.filter((o) => similar(h, o)).map((o) => o.n)]).filter(([, p]) => p.length);
  const used = paired.map(([h]) => h), pools = paired.map(([, p]) => p);
  const n = used.length;
  if (!n) return null;
  const avg = used.reduce((a, d) => a + d.n, 0) / n;
  const rand = rng(seed), sims = [];
  for (let s = 0; s < 2000; s++) {
    let t = 0;
    for (const p of pools) t += p[Math.floor(rand() * p.length)];
    sims.push(t / n);
  }
  sims.sort((a, b) => a - b);
  return {
    hits: used, n, avg, base: sims.reduce((a, b) => a + b, 0) / sims.length,
    lo: sims[Math.floor(sims.length * 0.025)], hi: sims[Math.ceil(sims.length * 0.975) - 1],
    atLeast: sims.filter((v) => v >= avg - 1e-9).length / sims.length,
    atMost: sims.filter((v) => v <= avg + 1e-9).length / sims.length,
  };
}

function mythResults() {
  const first = ALL.length ? parseDate(ALL[ALL.length - 1].date) : new Date();
  const last = minDate(addDays(UPDATED, -1), addDays(LISTED, -1));
  const key = `${ALL.length}|${isoDate(last)}|${HEIMSPIELE.length}|${FERIEN.length}`;
  if (mythCache?.key === key) return mythCache;
  const perDay = {}, big = new Set();
  for (const r of ALL) if (!r.standby) perDay[r.date] = (perDay[r.date] || 0) + 1;
  for (const r of ALL) if (r.bigDay) big.add(r.date);
  const all = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const date = isoDate(d);
    if (!big.has(date)) all.push({ date, wd: weekday(d), doy: Math.round((d - new Date(d.getFullYear(), 0, 1)) / 864e5), n: perDay[date] || 0 });
  }
  // 01.01 only counts for Silvester: with its dozen alarms it would make any winter comparison look busy.
  const days = all.filter((d) => d.date.slice(5) !== "01-01");
  const near = (a, b) => { const g = Math.abs(a.doy - b.doy); return Math.min(g, 365 - g) <= 30; };
  const alike = (a, b) => a.wd === b.wd && near(a, b);
  const moons = fullMoons(first, last);
  const moonDays = new Set(moons.flatMap((m) => [-1, 0, 1].map((o) => isoDate(addDays(parseDate(m), o)))));
  const hol = new Set();
  for (let y = first.getFullYear(); y <= last.getFullYear(); y++) holidays(y).forEach((d) => hol.add(d));
  const games = new Set(HEIMSPIELE);
  const list = (hits) => hits.map((h) => `${fmtDate(h.date)} (${einsaetze(h.n)})`).join(", ");
  const myths = [
    { title: "Bei Vollmond ist mehr los.", label: "Vollmond-Tage", on: "An Vollmond-Tagen", cmp: "Ähnliche Tage ohne Vollmond", vs: "an ähnlichen Tagen ohne Vollmond", pool: days,
      is: (d) => moonDays.has(d.date), similar: alike,
      about: (t) => `${t.n} Tage: jeweils der Tag mit Vollmond und die Tage davor und danach, dann ist der Mond fast voll.` },
    { title: "Am Freitag, dem 13., ist mehr los.", label: "Freitage, der 13.", on: "An Freitagen, dem 13.,", cmp: "Andere Freitage", vs: "an anderen Freitagen", pick: "andere Freitage", pool: days,
      is: (d) => d.wd === 4 && d.date.slice(8) === "13", similar: alike,
      about: (t) => `Bisher gab es erst ${t.n} solche Tage: ${list(t.hits)}.` },
    { title: "An Feiertagen ist mehr los.", label: "Feiertage", on: "An Feiertagen", cmp: "Ähnliche Tage ohne Feiertag", vs: "an ähnlichen Tagen ohne Feiertag", pool: days,
      is: (d) => hol.has(d.date), similar: alike,
      about: (t) => `${t.n} gesetzliche Feiertage in Niedersachsen. Neujahr zählt bei Silvester.` },
    FERIEN.length && { title: "In den Ferien ist mehr los.", label: "Ferientage", on: "In den Ferien", cmp: "Ähnliche Tage ohne Ferien", vs: "an ähnlichen Tagen ohne Ferien", pool: days,
      is: (d) => FERIEN.some(([a, b]) => d.date >= a && d.date <= b), similar: alike,
      about: (t) => `${t.n} Tage Schulferien in Niedersachsen, die Wochenenden in den Ferien eingeschlossen.` },
    games.size && { title: "Wenn 96 zu Hause spielt, ist mehr los.", label: "Heimspieltage", on: "An Heimspieltagen", cmp: "Ähnliche Tage ohne Heimspiel", vs: "an ähnlichen Tagen ohne Heimspiel", pool: days,
      is: (d) => games.has(d.date), similar: alike,
      about: (t) => `${t.n} Heimspiele von Hannover 96 in der Liga. Das Stadion liegt nah an Linden.` },
    { title: "Bei Hitze gibt es mehr Einsätze.", label: "Tage ab 30 °C", on: "An Tagen ab 30 °C", cmp: "Ähnliche Tage unter 30 °C", vs: "an ähnlichen Tagen unter 30 °C", pool: days.filter((d) => WEATHER[d.date]),
      is: (d) => WEATHER[d.date].tmax >= 30, similar: alike,
      about: (t) => `${t.n} Tage mit mindestens 30 °C in Hannover (Daten: Open-Meteo).` },
    { title: "Am Wochenende ist mehr los.", label: "Samstage und Sonntage", on: "Am Wochenende", cmp: "Werktage", vs: "an Werktagen", pick: "Werktage", pool: days,
      is: (d) => d.wd >= 5, similar: (a, b) => b.wd < 5 && near(a, b),
      about: (t) => `${t.n} Samstage und Sonntage, verglichen mit Montag bis Freitag in derselben Jahreszeit.` },
    { title: "Silvester ist die Nacht des Jahres.", label: "Neujahrstage", on: "Am Neujahrstag", cmp: "Andere Tage um den Jahreswechsel", vs: "an anderen Tagen um den Jahreswechsel", pick: "andere Tage um den Jahreswechsel", pool: all,
      is: (d) => d.date.slice(5) === "01-01", similar: near,
      about: (t) => `Zum Vergleich, weil es jeder weiß: So sieht ein echter Unterschied aus. Gezählt wird der 01.01., ` +
        `weil die Silvester-Einsätze meist nach Mitternacht liegen: ${list(t.hits)}.` },
  ].filter(Boolean);
  const results = myths.map((m, i) => ({ ...m, t: testMyth(m.pool, m.is, m.similar, 1000 + i) })).filter((m) => m.t);
  mythCache = { key, results, first, last, days: all.length };
  return mythCache;
}

// p: how often chance gives at least as many alarms (or at most as few, for fewer) as the myth days had.
function mythVerdict(t, pick = "ähnliche Tage") {
  const more = t.avg >= t.base, p = more ? t.atLeast : t.atMost;
  const k = Math.round(100 * p);
  const tries = `Wählt man ebenso viele zufällige ${pick}, kommen sie in ${k ? `${k} von 100` : "keinem von 100"} Versuchen auf ${more ? "mindestens" : "höchstens"} so ${more ? "viele" : "wenige"} Einsätze`;
  if (p < 0.025) return ["yes", more ? "Stimmt" : "Im Gegenteil", `${tries}. Da steckt also mehr dahinter als Zufall.`];
  if (t.n < 10) return ["few", "Zu wenige Tage", `${tries}. Bei nur ${t.n} Tagen reicht das nicht für eine Aussage.`];
  if (p < 0.1) return ["maybe", more ? "Vielleicht" : "Vielleicht weniger", `${tries}. Das ist ein Hinweis, aber noch kein Beleg.`];
  return ["none", "Kein Unterschied", `${tries}. Das ist also gut mit Zufall zu erklären.`];
}

// One myth's verdict, picture (dot, chance bar, legend) and sentence; also used by the quiz.
function mythParts(m) {
  const { t } = m;
  const dec = (x) => x.toFixed(2).replace(".", ",");
  const [cls, verdict, why] = mythVerdict(t, m.pick);
  const r = t.base ? t.avg / t.base : t.avg ? Infinity : 1;
  const [how, word] = r === Infinity ? ["mehr", "als"] : r >= 1.95 ? [`${r.toFixed(1).replace(".", ",")}-mal so viele`, "wie"]
    : r >= 1.1 ? [`${Math.round(100 * (r - 1))} % mehr`, "als"]
    : r > 0.9 ? ["etwa gleich viele", "wie"] : [`${Math.round(100 * (1 - r))} % weniger`, "als"];
  const max = [0.5, 1, 2, 5, 10, 20, 50].find((v) => v >= 1.1 * Math.max(t.avg, t.hi)) || 100;
  const x = (v) => `${((100 * v) / max).toFixed(2)}%`;
  const picture = `<div class="myth-strip" role="img" aria-label="${esc(m.label)}: ${dec(t.avg)} pro Tag. ${esc(m.cmp)}: zufällig ${dec(t.lo)} bis ${dec(t.hi)}.">` +
    `<span class="myth-band" style="left:${x(t.lo)};width:calc(${x(t.hi - t.lo)} + 2px)"></span>` +
    `<span class="myth-base" style="left:${x(t.base)}"></span><span class="myth-dot" style="left:${x(t.avg)}"></span></div>` +
    `<div class="myth-axis">${[0, max / 2, max].map((v) => `<span style="left:${x(v)}">${String(v).replace(".", ",")}</span>`).join("")}</div>` +
    `<ul class="myth-legend"><li><i class="k-dot"></i>${esc(m.label)}: <b>${dec(t.avg)}</b> Einsätze pro Tag</li>` +
    `<li><i class="k-band"></i>${esc(m.cmp)}: <b>${dec(t.base)}</b>, durch Zufall zwischen ${dec(t.lo)} und ${dec(t.hi)}</li></ul>`;
  return { cls, verdict, picture, sentence: `${m.on} gab es ${how} Einsätze ${word} ${m.vs}. ${why}` };
}

function renderMyths() {
  const { results, first, last, days } = mythResults();
  $("#myths-note").textContent = `Gezählt werden ${days.toLocaleString("de-DE")} Tage vom ${fmtDate(isoDate(first))} bis ${fmtDate(isoDate(last))}, ` +
    "ohne Großlagen und ohne Wachbesetzungen.";
  $("#c-myths").innerHTML = results.map((m) => {
    const { cls, verdict, picture, sentence } = mythParts(m);
    return `<article class="myth ${cls}"><header><h3>${m.title}</h3><span class="verdict">${verdict}</span></header>` +
      `${picture}<p>${sentence}</p><p class="myth-about">${esc(m.about(m.t))}</p></article>`;
  }).join("");
}

// ---------- Quiz "Schätz mal" ----------
// Ten questions per round, drawn from a larger pool and built from the data so they stay current. Numbers
// are guessed with a slider (2 points close to the answer, 1 point near it), the others are multiple choice
// (2 points). Nothing is saved: no names, no high score.
const QUIZ_LEN = 10;
const quiz = { qs: [], i: 0, got: [], guess: null, done: false, recent: new Set() };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const pct = (n, of) => Math.round((100 * n) / of);
const counted = (list, f) => topCounts(list, f, 999).map(([k, l]) => [k, l.length]);
const dec = (x) => x.toFixed(1).replace(".", ",");
const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} und ${a.at(-1)}` : a.join(""));

// Charts are drawn at phone width at most and then scale with the card, so a big screen gets big labels.
function quizChart(draw, items, opts) {
  const tmp = document.createElement("div");
  tmp.className = "chart";
  tmp.style.cssText = `position:absolute;left:-9999px;visibility:hidden;width:${Math.min(520, $("#quiz-card").clientWidth || 520)}px`;
  document.body.append(tmp);
  draw(tmp, items, opts);
  const html = tmp.innerHTML;
  tmp.remove();
  return `<div class="chart quiz-chart">${html}</div>`;
}

// A number to guess. unit: [one, many] or "%"; the slider ends at a round number well above the answer.
// near: how far off still gives 2 points and 1 point. tags: topics the question takes besides its own.
function numberQ(text, answer, unit, { max, near, explain = "", chart = null, tags = [] } = {}) {
  const percent = unit === "%";
  max ??= percent ? 100 : niceMax(Math.max(answer + 5, answer * (1.4 + Math.random() * 1.2)));
  near ??= percent ? [5, 10] : [Math.max(1, answer * 0.1), Math.max(2, answer * 0.25)];
  return { kind: "number", text, answer, unit, max, near, explain, chart, tags };
}
// Multiple choice: the right answer and up to three others, shuffled.
function choiceQ(text, right, others, { explain = "", chart = null, tags = [] } = {}) {
  const options = shuffle([right, ...shuffle([...new Set(others)].filter((o) => o !== right)).slice(0, 3)]);
  return options.length < 2 ? null : { kind: "choice", text, options, right, explain, chart, tags };
}
// Two options, in the order the question names them.
function pairQ(text, a, b, right, opts) {
  const q = choiceQ(text, right, [a, b], opts);
  if (q) q.options = [a, b];
  return q;
}
// Months, weekdays and times of day read better in their natural order.
const inOrder = (q, list) => (q && q.options.sort((a, b) => list.indexOf(a) - list.indexOf(b)), q);
const unitText = (q, n) => (q.unit === "%" ? `${n} %` : `${n.toLocaleString("de-DE")} ${n === 1 ? q.unit[0] : q.unit[1]}`);

function quizQuestions() {
  const rows = ALL.filter((r) => !r.standby);
  if (!rows.length) return [];
  const calm = rows.filter((r) => !r.bigDay);
  const listed = isoDate(LISTED), first = rows.at(-1).date;
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort();
  const full = years.filter((y) => !yearInfo(y, true).partial);
  const E = ["Einsatz", "Einsätze"], T = ["Tag", "Tage"];
  const plainName = (r) => r.name.replace(/\s*\(.*\)$/, "");
  const top = (list) => (list.length > 1 && list[0][1] === list[1][1] ? null : list[0]); // only a clear winner
  const inYear = (y) => rows.filter((r) => r.date.startsWith(y));
  const bigIn = (list) => topCounts(list.filter((r) => r.bigDay), (r) => r.date, 1)[0]; // the largest Großlage in it
  const yearBars = (hi) => quizChart(barList, years.map((y) => {
    const info = yearInfo(y, true);
    return { label: info.partial ? `${y} (bis ${fmtDate(info.cutDate).slice(0, 6)})` : y, value: info.rows.length, hi: !hi || y === hi, tip: "" };
  }), { labelWidth: 150 });
  // Whole months the website has listed, oldest first.
  const months = [];
  for (let d = parseDate(`${first.slice(0, 7)}-01`); isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) < listed; d = new Date(d.getFullYear(), d.getMonth() + 1, 1))
    months.push(isoDate(d).slice(0, 7));
  const perMonth = Object.fromEntries(months.map((ym) => [ym, 0]));
  for (const r of rows) if (r.date.slice(0, 7) in perMonth) perMonth[r.date.slice(0, 7)]++;
  const avgMonth = months.length ? Math.round(months.reduce((a, ym) => a + perMonth[ym], 0) / months.length) : 0;
  const monthName = (ym) => `${MONTHS_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
  // A note on a Großlage or on Neujahr would give away the questions on single days, so a question with
  // such a note takes the "days" topic too, and leaves it out when that topic is taken.
  const dayBound = (list) => list.some((r) => r.bigDay || r.date.endsWith("-01-01"));
  const monthBars = (hi) => quizChart(columnChart, months.map((ym) =>
    ({ tick: ym.endsWith("-01") ? ym.slice(0, 4) : "", value: perMonth[ym], hi: ym === hi, tip: "" })), { height: 160 });
  const known = rows.filter((r) => !r.timeUnknown);
  const hours = Array.from({ length: 24 }, (_, h) => known.filter((r) => r.hour === h).length);
  const hourBars = (hi) => quizChart(columnChart, hours.map((n, h) => ({ tick: h % 6 ? "" : `${h}`, value: n, hi: hi(h), tip: "" })), { height: 150 });
  const districts = counted(rows.filter((r) => r.district && r.district !== "unbekannt"), (r) => r.district);
  const streets = counted(rows.filter((r) => r.street), (r) => r.street);
  // The longest run of days with (busy) or without an alarm. Großlage days count as busy, and the count
  // stops at the website's newest alarm.
  const dates = new Set(rows.map((r) => r.date));
  const longestRun = (busy) => {
    let best = null, from = null;
    for (let d = parseDate(first); isoDate(d) <= listed; d = addDays(d, 1)) {
      const k = isoDate(d);
      if (dates.has(k) !== busy) { from = null; continue; }
      from ||= k;
      const len = Math.round((d - parseDate(from)) / 864e5) + 1;
      if (!best || len > best.len) best = { len, from, to: k };
    }
    return best;
  };
  const reasons = [
    { label: "Rauchwarnmelder", is: isRWM, text: "Wie oft wurde die FF Linden bisher wegen eines Rauchwarnmelders alarmiert?" },
    { label: "Brandmeldeanlage", is: isBMA, text: "Wie oft hat bisher eine Brandmeldeanlage die FF Linden alarmiert?" },
    { label: "Containerbrand", is: (r) => /container/i.test(r.event), text: "Wie oft brannte bisher ein Container?" },
    { label: "Gas & Gefahrstoffe", is: (r) => r.group === "Gas & Gefahrstoffe", text: "Wie oft ging es bisher um Gas oder andere Gefahrstoffe?" },
    { label: "Technische Hilfe", is: (r) => r.group === "Technische Hilfe",
      text: "Wie oft war bisher technische Hilfe gefragt, zum Beispiel nach einem Unfall oder bei Wasser im Keller?" },
    { label: "Unwetter", is: (r) => r.group === "Unwetter", text: "Wie oft wurde die FF Linden bisher wegen eines Unwetters alarmiert?" },
  ].map((x) => ({ ...x, list: rows.filter(x.is) })).filter((x) => x.list.length >= 5);
  // A Großlage can make up most of a reason (the Unwetter of 14.07.2026), so the answer says so.
  const reasonNote = (x, named) => {
    const big = bigIn(x.list);
    return big && big[1].length >= x.list.length / 3 ? ` ${named ? `${x.label}: ` : ""}${big[1].length} davon allein am ${fmtDate(big[0])}.` : "";
  };

  // [topic, question]. A round has one question per topic, so a chart or note can't give away a later answer.
  const gens = [
    ["years", () => {
      if (!full.length) return null;
      const y = pick(full), n = inYear(y).length;
      return numberQ(`Wie viele Einsätze hatte die FF Linden im ganzen Jahr ${y}?`, n, E, {
        explain: `Im Schnitt ${dec(n / 52.18)} pro Woche.`, chart: () => yearBars(y),
      });
    }],
    ["years", () => {
      const days = Math.round((LISTED - parseDate(first)) / 864e5) + 1;
      return numberQ(`Wie viele Einsätze hatte die FF Linden insgesamt seit dem ${fmtDate(first)}?`, rows.length, E, {
        explain: `Im Schnitt ${dec((7 * rows.length) / days)} pro Woche.`, chart: () => yearBars(),
      });
    }],
    ["years", () => {
      // a year against the one before, up to the same date while it isn't complete
      const ys = years.filter((y) => `${y - 1}-01-01` >= first);
      if (!ys.length) return null;
      const y = pick(ys), info = yearInfo(y, true);
      const now = info.cmpRows.length, before = info.prevSame.length;
      if ((info.partial && info.cut < "03-01") || !before || now === before) return null;
      const when = info.partial ? ` bis zum ${fmtDate(info.cutDate).slice(0, 6)}` : "";
      const big = info.cmpRows.filter((r) => r.bigDay).length, bigBefore = info.prevSame.filter((r) => r.bigDay).length;
      return pairQ(`Gab es ${y}${when} mehr oder weniger Einsätze als ${y - 1}${when ? " im gleichen Zeitraum" : ""}?`, "Mehr", "Weniger",
        now > before ? "Mehr" : "Weniger", {
          explain: `${y}: ${einsaetze(now)}, ${y - 1}: ${einsaetze(before)}.` + (big || bigBefore ? ` Ohne Großlagen: ${now - big} zu ${before - bigBefore}.` : ""),
          chart: () => quizChart(barList, [[y, now], [String(y - 1), before]].map(([yy, value]) => ({ label: `${yy}${when}`, value, tip: "" })), { labelWidth: 150 }),
        });
    }],
    ["months", (taken) => {
      if (!full.length) return null;
      const y = pick(full), ry = inYear(y);
      const per = MONTHS.map((_, m) => ry.filter((r) => Number(r.date.slice(5, 7)) === m + 1).length);
      const best = top(per.map((n, m) => [m, n]).sort((a, b) => b[1] - a[1]));
      if (!best) return null;
      const list = ry.filter((r) => Number(r.date.slice(5, 7)) === best[0] + 1), big = bigIn(list), bound = dayBound(list);
      if (bound && taken.has("days")) return null;
      return inOrder(choiceQ(`In welchem Monat gab es ${y} die meisten Einsätze?`, MONTHS_LONG[best[0]], MONTHS_LONG, {
        explain: `${MONTHS_LONG[best[0]]} ${y}: ${einsaetze(best[1])}.` + (big ? ` Darin steckt die Großlage am ${fmtDate(big[0])} mit ${einsaetze(big[1].length, true)}.` : ""),
        chart: () => quizChart(columnChart, per.map((n, m) => ({ tick: MONTHS[m][0], value: n, hi: m === best[0], tip: "" })), { height: 170 }),
        tags: bound ? ["days"] : [],
      }), MONTHS_LONG);
    }],
    ["months", (taken) => {
      const inMonth = (ym) => rows.filter((r) => r.date.startsWith(ym));
      const pool = months.filter((ym) => !taken.has("days") || !dayBound(inMonth(ym)));
      if (pool.length < 3) return null;
      const ym = pick(pool), list = inMonth(ym);
      const big = bigIn(list), ny = list.filter((r) => r.date.endsWith("-01-01")).length;
      return numberQ(`Wie viele Einsätze gab es im ${monthName(ym)}?`, perMonth[ym], E, {
        explain: `Im Schnitt sind es ${avgMonth} pro Monat.` + (big ? ` Darin steckt die Großlage am ${fmtDate(big[0])} mit ${einsaetze(big[1].length, true)}.` : "") +
          (ny ? ` Allein am Neujahrstag waren es ${ny}.` : ""),
        chart: () => monthBars(ym), tags: dayBound(list) ? ["days"] : [],
      });
    }],
    ["months", () => {
      const sorted = months.map((ym) => [ym, perMonth[ym]]).sort((a, b) => a[1] - b[1]);
      if (sorted.length < 6 || sorted[0][1] === sorted[1][1]) return null;
      const [ym, n] = sorted[0], [most, mostN] = sorted.at(-1);
      return numberQ(`Der ruhigste Monat bisher war der ${monthName(ym)}. Wie viele Einsätze gab es da?`, n, E, {
        explain: `Im Schnitt sind es ${avgMonth} pro Monat, im stärksten Monat (${monthName(most)}) waren es ${mostN}.`,
        chart: () => monthBars(ym),
      });
    }],
    ["months", () => {
      const ys = years.filter((y) => inYear(y).length >= 100);
      if (!ys.length) return null;
      const at = (y) => inYear(y).at(-100).date; // the list is newest first
      const y = pick(ys), d = at(y), m = Number(d.slice(5, 7)) - 1;
      const others = ys.filter((yy) => yy !== y).map((yy) => fmtDate(at(yy)));
      return inOrder(choiceQ(`In welchem Monat kam ${y} der 100. Einsatz des Jahres?`, MONTHS_LONG[m],
        [m - 2, m - 1, m + 1, m + 2].filter((k) => k >= 0 && k < 12).map((k) => MONTHS_LONG[k]), {
          explain: `Am ${fmtDate(d)}.` + (rows.some((r) => r.bigDay && r.date === d) ? " Das war mitten in einer Großlage." : "") +
            (others.length ? ` Zum Vergleich: ${andList(others)}.` : ""),
        }), MONTHS_LONG);
    }],
    ["months", () => {
      if (full.length < 2) return null;
      const per = MONTHS.map((_, m) => rows.filter((r) => full.includes(r.date.slice(0, 4)) && Number(r.date.slice(5, 7)) === m + 1).length);
      const best = top(per.map((n, m) => [m, n]).sort((a, b) => a[1] - b[1]));
      if (!best) return null;
      // February is shorter, so per day too
      const perDay = per.map((n, m) => n / full.reduce((a, y) => a + new Date(Number(y), m + 1, 0).getDate(), 0));
      const calmest = perDay.indexOf(Math.min(...perDay));
      return inOrder(choiceQ(`In welchem Monat ist am wenigsten los? Gezählt sind die ganzen Jahre ${andList(full)}.`, MONTHS_LONG[best[0]], MONTHS_LONG, {
        explain: `${MONTHS_LONG[best[0]]}: zusammen nur ${einsaetze(best[1])}. ` +
          (calmest === best[0] ? "Auch pro Tag gerechnet ist er der ruhigste." : `Pro Tag gerechnet ist der ${MONTHS_LONG[calmest]} am ruhigsten.`),
        chart: () => quizChart(columnChart, per.map((n, m) => ({ tick: MONTHS[m][0], value: n, hi: m === best[0], tip: "" })), { height: 160 }),
      }), MONTHS_LONG);
    }],
    ["days", () => {
      const days = counted(rows, (r) => r.date);
      const best = top(days);
      if (!best || best[1] < 5) return null;
      const [d, n] = best;
      const [ev, evl] = topCounts(rows.filter((r) => r.date === d), (r) => r.event, 1)[0];
      return numberQ(`Der stärkste Tag bisher war ${WEEKDAYS_LONG[weekday(parseDate(d))]}, der ${fmtDate(d)}. Wie viele Einsätze gab es an diesem Tag?`, n, E, {
        explain: evl.length > n / 2 ? `${evl.length} davon: „${esc(ev)}“.` : "",
        chart: () => quizChart(barList, days.slice(0, 5).map(([dd, nn]) => ({ label: fmtDate(dd), value: nn, hi: dd === d, tip: "" })), { labelWidth: 110 }),
      });
    }],
    ["days", () => {
      const ny = years.filter((y) => `${y}-01-01` <= listed);
      if (!ny.length) return null;
      const y = pick(ny), n = rows.filter((r) => r.date === `${y}-01-01`).length;
      const usual = rows.filter((r) => !r.bigDay && r.date.slice(5) !== "01-01").length / ((LISTED - parseDate(years[0] + "-01-01")) / 864e5 + 1);
      return numberQ(`Silvester ${y - 1}: Wie viele Einsätze gab es am Neujahrstag, dem 01.01.${y}?`, n, E, {
        explain: `An einem normalen Tag sind es im Schnitt ${dec(usual)}.`,
        chart: () => quizChart(barList, ny.map((yy) => ({ label: `01.01.${yy}`, value: rows.filter((r) => r.date === `${yy}-01-01`).length, hi: yy === y, tip: "" })), { labelWidth: 110 }),
      });
    }],
    ["", () => {
      const firsts = years.map((y) => inYear(y).at(-1)).filter((r) => r.date.endsWith("-01-01") && !r.timeUnknown && r.hour === 0);
      if (!firsts.length) return null;
      const r = pick(firsts), y = Number(r.date.slice(0, 4));
      const others = firsts.filter((o) => o !== r).map((o) => `${o.date.slice(0, 4)} um ${o.time} Uhr`);
      return numberQ(`Silvester ${y - 1}: Wie viele Minuten nach Mitternacht kam der erste Einsatz des Jahres ${y}?`, Number(r.time.slice(3, 5)), ["Minute", "Minuten"], {
        max: 60, near: [2, 5],
        explain: `Um ${r.time} Uhr: „${esc(r.event)}“.` + (others.length ? ` Zum Vergleich: ${andList(others)}.` : ""),
      });
    }],
    ["hours", () => {
      if (known.length < 50) return null;
      const night = known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length, share = pct(night, known.length);
      const more = night / 8 > (known.length - night) / 16;
      return numberQ("Wie viel Prozent der Einsätze kommen nachts, zwischen 22 und 6 Uhr?", share, "%", {
        explain: `Die Nacht hat 8 von 24 Stunden, also 33 %. Pro Stunde ist nachts also ${more ? "mehr" : "weniger"} los als tagsüber.`,
        chart: () => hourBars((h) => h >= NIGHT_START || h < DAY_START),
      });
    }],
    ["hours", () => {
      const best = top(hours.map((n, h) => [h, n]).sort((a, b) => b[1] - a[1]));
      if (!best) return null;
      const label = (h) => `${h}–${h + 1} Uhr`;
      return choiceQ("In welcher Stunde wird am häufigsten alarmiert?", label(best[0]),
        hours.map((n, h) => (n <= best[1] * 0.75 ? label(h) : null)).filter(Boolean), {
          explain: `${label(best[0])}: ${einsaetze(best[1])}.`,
          chart: () => hourBars((h) => h === best[0]),
        });
    }],
    ["hours", () => {
      const fires = known.filter((r) => r.group === "Brand");
      if (fires.length < 50) return null;
      const parts = [["Nachts (0–6 Uhr)", 0], ["Morgens (6–12 Uhr)", 6], ["Nachmittags (12–18 Uhr)", 12], ["Abends (18–24 Uhr)", 18]]
        .map(([label, h]) => [label, fires.filter((r) => r.hour >= h && r.hour < h + 6).length]);
      const best = top([...parts].sort((a, b) => b[1] - a[1]));
      if (!best) return null;
      return inOrder(choiceQ("Zu welcher Tageszeit wird die FF Linden am häufigsten zu einem Brand alarmiert?", best[0], parts.map(([l]) => l), {
        explain: `${best[0]}: ${best[1]} von ${fires.length} Brandeinsätzen. Ausgelöste Rauchwarnmelder und Brandmeldeanlagen zählen mit.`,
        chart: () => quizChart(barList, parts.map(([label, value]) => ({ label, value, hi: label === best[0], tip: "" })), { labelWidth: 190 }),
      }), parts.map(([l]) => l));
    }],
    ["weekdays", () => {
      // Großlagen would decide this on their own (the storm fell on a Tuesday), so they stay out.
      const per = WEEKDAYS_LONG.map((_, k) => calm.filter((r) => weekday(parseDate(r.date)) === k).length);
      const most = Math.random() < 0.5;
      const best = top(per.map((n, k) => [k, n]).sort((a, b) => (most ? b[1] - a[1] : a[1] - b[1])));
      if (!best) return null;
      return inOrder(choiceQ(`An welchem Wochentag gibt es die ${most ? "meisten" : "wenigsten"} Einsätze?`, WEEKDAYS_LONG[best[0]], WEEKDAYS_LONG, {
        explain: `${WEEKDAYS_LONG[best[0]]}: ${einsaetze(best[1])} (ohne Großlagen).`,
        chart: () => quizChart(columnChart, per.map((n, k) => ({ tick: WEEKDAYS[k], value: n, hi: k === best[0], tip: "" })), { height: 150 }),
      }), WEEKDAYS_LONG);
    }],
    ["weekdays", () => {
      if (calm.length < 50) return null;
      const per = WEEKDAYS.map((_, k) => calm.filter((r) => weekday(parseDate(r.date)) === k).length);
      const end = per[5] + per[6], more = end / 2 > (calm.length - end) / 5;
      return numberQ("Ohne Großlagen gezählt: Wie viel Prozent der Einsätze fallen aufs Wochenende, also auf Samstag oder Sonntag?", pct(end, calm.length), "%", {
        explain: `Samstag und Sonntag sind 2 von 7 Tagen, also 29 %. Pro Tag ist am Wochenende also ${more ? "mehr" : "weniger"} los als unter der Woche.`,
        chart: () => quizChart(columnChart, per.map((n, k) => ({ tick: WEEKDAYS[k], value: n, hi: k >= 5, tip: "" })), { height: 150 }),
      });
    }],
    ["keywords", () => {
      const kws = counted(rows, plainName);
      const best = top(kws);
      if (!best) return null;
      return choiceQ("Welches Alarmstichwort kommt am häufigsten vor?", best[0], kws.slice(1, 7).map(([k]) => k), {
        explain: `${einsaetze(best[1])}, das sind ${pct(best[1], rows.length)} % aller Einsätze.`,
        chart: () => quizChart(barList, kws.slice(0, 5).map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" }))),
      });
    }],
    ["keywords", () => {
      const kws = counted(rows.filter((r) => KW.codes[r.base]), (r) => r.base);
      if (kws.length < 5) return null;
      const once = kws.filter(([, n]) => n === 1).length;
      return numberQ("Wie viele verschiedene Alarmstichwörter kamen bisher vor?", kws.length, ["Stichwort", "Stichwörter"], {
        explain: `Am häufigsten „${esc(plainName(rows.find((r) => r.base === kws[0][0])))}“ mit ${einsaetze(kws[0][1], true)}.` +
          (once ? ` ${once === 1 ? "Ein Stichwort kam" : `${once} Stichwörter kamen`} nur ein einziges Mal vor.` : ""),
      });
    }],
    ["districts", () => {
      const best = top(districts);
      if (!best) return null;
      return choiceQ("In welchem Stadtteil gab es bisher die meisten Einsätze?", best[0], districts.slice(1, 6).map(([k]) => k), {
        explain: `${esc(best[0])}: ${einsaetze(best[1])}, das sind ${pct(best[1], rows.length)} %.`,
        chart: () => quizChart(barList, districts.slice(0, 6).map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" }))),
      });
    }],
    ["districts", () => {
      const options = districts.filter(([, n]) => n >= 10);
      if (!options.length) return null;
      const [d, n] = pick(options), rank = districts.findIndex(([k]) => k === d) + 1;
      return numberQ(`Wie viele Einsätze gab es bisher im Stadtteil ${esc(d)}?`, n, E, {
        explain: `Platz ${rank} von ${districts.length} Stadtteilen.`,
        chart: () => quizChart(barList, districts.slice(0, Math.max(8, rank)).map(([k, v]) => ({ label: k, value: v, hi: k === d, tip: "" }))),
      });
    }],
    ["districts", () => {
      if (districts.length < 5) return null;
      const few = districts.filter(([, n]) => n <= 2).length;
      return numberQ("In wie vielen verschiedenen Stadtteilen war die FF Linden bisher im Einsatz?", districts.length, ["Stadtteil", "Stadtteile"], {
        explain: few ? `In ${few} davon nur ein- oder zweimal.` : "",
      });
    }],
    ["districts", () => {
      const ds = districts.filter(([, n]) => n >= 10), pairs = [];
      for (const a of ds) for (const b of ds) if (a[1] >= b[1] * 1.2) pairs.push(Math.random() < 0.5 ? [a, b] : [b, a]);
      if (!pairs.length) return null;
      const [a, b] = pick(pairs);
      return pairQ(`Wo gab es bisher mehr Einsätze: ${esc(a[0])} oder ${esc(b[0])}?`, a[0], b[0], a[1] > b[1] ? a[0] : b[0], {
        explain: `${esc(a[0])}: ${einsaetze(a[1])}, ${esc(b[0])}: ${einsaetze(b[1])}.`,
      });
    }],
    ["districts", () => {
      const linden = ["Linden-Nord", "Linden-Mitte", "Linden-Süd"];
      const all = districts.reduce((a, [, n]) => a + n, 0), n = districts.filter(([k]) => linden.includes(k)).reduce((a, [, v]) => a + v, 0);
      if (all < 50 || !n) return null;
      const rest = districts.filter(([k]) => !linden.includes(k)).slice(0, 2);
      return numberQ("Wie viel Prozent ihrer Einsätze hatte die FF Linden in Linden selbst, also in Linden-Nord, Linden-Mitte und Linden-Süd?", pct(n, all), "%", {
        explain: `Von den übrigen lagen die meisten in den Stadtteilen ${andList(rest.map(([k, v]) => `${esc(k)} (${v})`))}.`,
        chart: () => quizChart(barList, districts.slice(0, 7).map(([k, v]) => ({ label: k, value: v, hi: linden.includes(k), tip: "" }))),
      });
    }],
    ["streets", () => {
      if (streets.length < 8) return null;
      const most = streets[0][1];
      const right = pick(streets.filter(([, n]) => n === most))[0];
      const others = streets.filter(([, n]) => n <= most - 3 && n >= 2).map(([k]) => k);
      const q = choiceQ("Welche dieser Straßen hatte bisher die meisten Einsätze?", right, others, {
        explain: `${esc(right)}: ${einsaetze(most)}.` + (streets[1][1] === most ? ` Genauso viele: ${esc(streets.filter(([k, n]) => n === most && k !== right).map(([k]) => k).join(", "))}.` : ""),
      });
      if (q) q.chart = () => quizChart(barList, q.options.map((o) => [o, streets.find(([k]) => k === o)[1]]).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => ({ label: k, value: n, hi: k === right, tip: "" })));
      return q;
    }],
    ["streets", () => {
      if (streets.length < 20) return null;
      const once = streets.filter(([, n]) => n === 1).length;
      return numberQ("In wie vielen verschiedenen Straßen war die FF Linden bisher im Einsatz?", streets.length, ["Straße", "Straßen"], {
        explain: `In ${once} davon nur ein einziges Mal. Mitgezählt sind auch Plätze, Bahnhöfe und Stücke der Autobahn.`,
      });
    }],
    ["streets", () => {
      for (const [d] of shuffle(districts.filter(([, n]) => n >= 30))) {
        const st = counted(rows.filter((r) => r.district === d && r.street), (r) => r.street);
        const best = top(st);
        if (!best || best[1] < 3) continue;
        const less = st.filter(([, n]) => n < best[1]); // streets with a few alarms first, they are the better known ones
        const others = [...shuffle(less.filter(([, n]) => n >= 2)), ...shuffle(less.filter(([, n]) => n < 2))].slice(0, 3).map(([k]) => k);
        const q = choiceQ(`Wo im Stadtteil ${esc(d)} gab es bisher die meisten Einsätze?`, best[0], others, { explain: `${esc(best[0])}: ${einsaetze(best[1])}.` });
        if (q) q.chart = () => quizChart(barList, q.options.map((o) => [o, st.find(([k]) => k === o)[1]]).sort((a, b) => b[1] - a[1])
          .map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" })));
        return q;
      }
      return null;
    }],
    ["bma", () => {
      const bma = counted(rows.filter((r) => r.street && isBMA(r)), (r) => r.street);
      const best = top(bma);
      if (!best || best[1] < 3) return null;
      const q = choiceQ("An welchem dieser Orte hat eine Brandmeldeanlage am häufigsten ausgelöst?", best[0], bma.slice(1, 8).map(([k]) => k), {
        explain: `${esc(best[0])}: ${best[1]}-mal.`,
      });
      if (q) q.chart = () => quizChart(barList, q.options.map((o) => [o, bma.find(([k]) => k === o)[1]]).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" })));
      return q;
    }],
    ["reasons", () => {
      const groups = counted(rows, (r) => r.group);
      const brand = groups.find(([g]) => g === "Brand");
      if (!brand) return null;
      return numberQ("Wie viel Prozent aller Einsätze sind Brände, vom Rauchmelder bis zum Wohnungsbrand?", pct(brand[1], rows.length), "%", {
        chart: () => quizChart(barList, groups.slice(0, 5).map(([g, n]) => ({ label: g, value: n, display: `${pct(n, rows.length)} %`, hi: g === "Brand", tip: "" }))),
      });
    }],
    ["reasons", (taken) => {
      const pool = reasons.filter((x) => !taken.has("days") || !reasonNote(x));
      if (!pool.length) return null;
      const x = pick(pool), n = x.list.length;
      return numberQ(x.text, n, ["Mal", "Mal"], {
        explain: `Das ist ungefähr jeder ${Math.round(rows.length / n)}. Einsatz.` + reasonNote(x, false),
        chart: () => quizChart(barList, [...reasons].sort((a, b) => b.list.length - a.list.length)
          .map((y) => ({ label: y.label, value: y.list.length, hi: y === x, tip: "" })), { labelWidth: 190 }),
        tags: reasonNote(x) ? ["days"] : [],
      });
    }],
    ["reasons", (taken) => {
      const pool = reasons.filter((x) => !taken.has("days") || !reasonNote(x)), pairs = [];
      for (const a of pool) for (const b of pool) if (a.list.length >= b.list.length * 1.2) pairs.push(Math.random() < 0.5 ? [a, b] : [b, a]);
      if (!pairs.length) return null;
      const [a, b] = pick(pairs);
      return pairQ(`Was kam bisher öfter vor: ${a.label} oder ${b.label}?`, a.label, b.label, a.list.length > b.list.length ? a.label : b.label, {
        explain: `${a.label}: ${a.list.length}-mal, ${b.label}: ${b.list.length}-mal.` + reasonNote(a, true) + reasonNote(b, true),
        tags: reasonNote(a) || reasonNote(b) ? ["days"] : [],
      });
    }],
    ["radius", () => {
      const pts = radiusPoints(rows);
      if (pts.length < 20) return null;
      const far = pts.reduce((a, b) => (b.km > a.km ? b : a));
      return numberQ("Wie viele Kilometer Luftlinie lag der bisher weiteste Einsatz von der Wache entfernt?", Math.round(far.km), ["Kilometer", "Kilometer"], {
        explain: `Genau ${fmtKm(far.km)}, am ${fmtDate(far.r.date)}: „${esc(far.r.event)}“ (${esc(far.r.street)}, ${esc(far.r.district)}).`,
      });
    }],
    ["radius", () => {
      const kms = radiusPoints(rows).map((p) => p.km).sort((a, b) => a - b);
      if (kms.length < 50) return null;
      return numberQ("Wie viel Prozent der Einsätze lagen höchstens 2 km Luftlinie von der Wache entfernt?", pct(kms.filter((k) => k <= 2).length, kms.length), "%", {
        explain: `Die Hälfte lag sogar näher als ${fmtKm(kms[Math.floor(kms.length / 2)])}.`,
        chart: () => quizChart(barList, RADIUS_BINS.map(([lo, hi, label]) => ({ label, value: kms.filter((k) => k >= lo && k < hi).length, hi: hi <= 2, tip: "" })), { labelWidth: 110 }),
      });
    }],
    ["weather", () => {
      // like the Wetter view: Silvester/Neujahr and Großlagen left out
      const per = {}, big = new Set(rows.filter((r) => r.bigDay).map((r) => r.date));
      for (const r of calm) per[r.date] = (per[r.date] || 0) + 1;
      const days = Object.keys(WEATHER).filter((d) => d >= first && d <= listed && !big.has(d) && !["12-31", "01-01"].includes(d.slice(5)));
      if (days.length < 200) return null;
      const avg = (ds) => ds.reduce((a, d) => a + (per[d] || 0), 0) / ds.length;
      const kinds = [
        [`Hitze ab ${HOT} °C`, (w) => w.tmax >= HOT], ["Frost", (w) => w.tmin < 0],
        [`Sturm mit Böen ab ${GUST} km/h`, (w) => w.gust >= GUST], ["Viel Regen, ab 10 mm", (w) => w.rain >= 10],
      ].map(([label, is]) => { const ds = days.filter((d) => is(WEATHER[d])); return { label, n: ds.length, avg: avg(ds) }; }).filter((k) => k.n >= 10);
      const sorted = [...kinds].sort((a, b) => b.avg - a.avg);
      if (kinds.length < 3 || sorted[0].avg < sorted[1].avg * 1.2) return null;
      return inOrder(choiceQ("Bei welchem Wetter gibt es pro Tag die meisten Einsätze?", sorted[0].label, kinds.map((k) => k.label), {
        explain: `${sorted[0].label}: ${dec(sorted[0].avg)} Einsätze pro Tag, im Schnitt aller Tage sind es ${dec(avg(days))}. Silvester und Großlagen zählen nicht mit.`,
        chart: () => quizChart(barList, sorted.map((k) => ({ label: k.label, value: k.avg, display: dec(k.avg), hi: k === sorted[0], tip: "" })), { labelWidth: 210 }),
      }), kinds.map((k) => k.label));
    }],
    ["", () => {
      const best = longestRun(false);
      if (!best || best.len < 3) return null;
      return numberQ("Die längste Pause bisher: Wie viele Tage hintereinander gab es keinen einzigen Einsatz?", best.len, T, {
        explain: `Die längste Pause ging vom ${fmtDate(best.from)} bis zum ${fmtDate(best.to)}.`,
      });
    }],
    ["", () => {
      const best = longestRun(true);
      if (!best || best.len < 3) return null;
      return numberQ("Die längste Serie bisher: An wie vielen Tagen hintereinander gab es jeden Tag mindestens einen Einsatz?", best.len, T, {
        explain: `Die Serie ging vom ${fmtDate(best.from)} bis zum ${fmtDate(best.to)}.`,
      });
    }],
    ["", () => {
      if (!full.length) return null;
      const y = pick(full), n = new Set(inYear(y).map((r) => r.date)).size;
      const len = new Date(Number(y), 1, 29).getDate() === 29 ? 366 : 365;
      return numberQ(`An wie vielen Tagen im Jahr ${y} gab es mindestens einen Einsatz?`, n, T, {
        max: len, explain: `Das ist ungefähr jeder ${Math.round(len / n)}. Tag. An den anderen ${len - n} Tagen blieb es ruhig.`,
      });
    }],
    ["", () => {
      const ts = calm.map(stamp).sort((a, b) => a - b);
      if (ts.length < 50) return null;
      const gaps = ts.slice(1).map((t, k) => (t - ts[k]) / 36e5).sort((a, b) => a - b);
      const h = Math.round((ts.at(-1) - ts[0]) / 36e5 / gaps.length), mid = Math.round(gaps[Math.floor(gaps.length / 2)]);
      return numberQ("Ohne Großlagen gezählt: Wie viele Stunden liegen im Schnitt zwischen zwei Einsätzen?", h, ["Stunde", "Stunden"], {
        explain: `Das sind etwa ${dec(h / 24)} Tage.` + (mid < h * 0.8 ? ` Die Hälfte der Abstände ist aber kürzer als ${mid} Stunden.` : ""),
      });
    }],
    ["myth", (taken) => {
      // the heat and weekend myths and the weather and weekday questions give each other away
      const tag = (m) => (/Hitze/.test(m.title) ? "weather" : /Wochenende/.test(m.title) ? "weekdays" : "");
      const ms = mythResults().results.filter((m) => !/^Silvester/.test(m.title) && ["yes", "none"].includes(mythVerdict(m.t)[0]) && m.t.n >= 10 && !taken.has(tag(m)));
      if (!ms.length) return null;
      const m = pick(ms), parts = mythParts(m);
      return { kind: "choice", text: `Stimmt das? „${m.title}“`, options: ["Stimmt", "Stimmt nicht"],
        right: parts.cls === "yes" && m.t.avg > m.t.base ? "Stimmt" : "Stimmt nicht",
        explain: parts.sentence, chart: () => `<div class="quiz-myth">${parts.picture}</div>`, tags: [tag(m)] };
    }],
  ];
  // Kinds from the last round go to the back, so the next round brings new ones.
  const order = shuffle(gens.map((_, k) => k)).sort((a, b) => quiz.recent.has(a) - quiz.recent.has(b));
  const qs = [], taken = new Set(), used = new Set();
  for (const k of order) {
    if (qs.length === QUIZ_LEN) break;
    const [topic, make] = gens[k];
    if (taken.has(topic)) continue;
    const q = make(taken);
    if (!q) continue;
    qs.push(q);
    used.add(k);
    for (const t of [topic, ...q.tags]) if (t) taken.add(t);
  }
  quiz.recent = used;
  return qs;
}

function quizShow() {
  const card = $("#quiz-card"), n = quiz.qs.length;
  const total = quiz.got.reduce((a, b) => a + b, 0);
  $("#quiz-bar").innerHTML = quiz.qs.length && quiz.i < n
    ? quiz.qs.map((_, k) => `<i class="${k < quiz.i ? "done" : k === quiz.i ? "now" : ""}"></i>`).join("") : "";
  if (!n) {
    card.innerHTML = `<div class="quiz-kicker">Quiz</div><h2 class="quiz-title">Schätz mal!</h2>` +
      `<p>${QUIZ_LEN} Fragen zu den Einsätzen der FF Linden. Bei Zahlen gibt es 2 Punkte für einen Treffer und 1 Punkt, wenn du nah dran bist. ` +
      `Jede andere richtige Antwort bringt 2 Punkte. Nichts wird gespeichert.</p>` +
      `<div class="quiz-actions"><button type="button" class="primary" data-quiz="start">Los geht's</button></div>`;
    return;
  }
  if (quiz.i >= n) {
    const max = 2 * n, share = total / max;
    card.innerHTML = `<div class="quiz-kicker">Geschafft</div><div class="quiz-hero">${total} <span>von ${max} Punkten</span></div>` +
      `<p class="quiz-verdict">${share >= 0.85 ? "Stark! Du kennst die FF Linden richtig gut." : share >= 0.6 ? "Gut geschätzt!"
        : share >= 0.35 ? "Nicht schlecht, da geht noch was." : "Schwierig, oder? Auf dieser Seite stehen alle Zahlen zum Nachschauen."}</p>` +
      `<ol class="quiz-summary">${quiz.qs.map((q, k) => `<li class="p${quiz.got[k]}"><b>${quiz.got[k] ? `+${quiz.got[k]}` : "0"}</b>${q.text}</li>`).join("")}</ol>` +
      `<div class="quiz-actions"><button type="button" class="primary" data-quiz="start">Nochmal spielen</button></div>`;
    return;
  }
  const q = quiz.qs[quiz.i];
  const head = `<div class="quiz-kicker">Frage ${quiz.i + 1} von ${n}</div><h2 class="quiz-q">${q.text}</h2>`;
  if (!quiz.done) {
    if (q.kind === "choice") {
      card.innerHTML = head + `<div class="quiz-options${q.options.length > 2 ? "" : " two"}">` +
        q.options.map((o, k) => `<button type="button" data-quiz="pick" data-k="${k}"><span class="key">${k + 1}</span>${esc(o)}</button>`).join("") + "</div>";
    } else {
      quiz.guess ??= Math.round(q.max / 2);
      const step = q.max > 500 ? 5 : 1;
      card.innerHTML = head + `<div class="quiz-guess"><output id="quiz-val">${unitText(q, quiz.guess)}</output></div>` +
        `<div class="quiz-slider"><button type="button" data-quiz="step" data-d="-${step}" aria-label="weniger">−</button>` +
        `<input type="range" id="quiz-range" min="0" max="${q.max}" step="${step}" value="${quiz.guess}" aria-label="Deine Schätzung">` +
        `<button type="button" data-quiz="step" data-d="${step}" aria-label="mehr">+</button></div>` +
        `<div class="quiz-scale"><span>0</span><span>${q.max.toLocaleString("de-DE")}</span></div>` +
        `<div class="quiz-actions"><button type="button" class="primary" data-quiz="answer">Antworten</button></div>`;
    }
    return;
  }
  // the answer
  const got = quiz.got[quiz.i];
  let body;
  if (q.kind === "choice") {
    body = `<div class="quiz-options${q.options.length > 2 ? "" : " two"} shown">` + q.options.map((o, k) =>
      `<button type="button" disabled class="${o === q.right ? "right" : k === quiz.guess ? "wrong" : ""}"><span class="key">${k + 1}</span>${esc(o)}</button>`).join("") + "</div>";
  } else {
    // labels near an end are aligned to that end, so they stay inside the card
    const mark = (cls, v, text) => {
      const p = Math.min(100, (100 * v) / q.max);
      return `<span class="mark ${cls}${p < 15 ? " l" : p > 85 ? " r" : ""}" style="left:${p.toFixed(2)}%"><b>${text}</b></span>`;
    };
    body = `<div class="quiz-line" role="img" aria-label="Deine Schätzung ${unitText(q, quiz.guess)}, richtig ${unitText(q, q.answer)}">` +
      mark("you", quiz.guess, `Du: ${unitText(q, quiz.guess)}`) + mark("real", q.answer, `Richtig: ${unitText(q, q.answer)}`) + `</div>`;
  }
  const verdict = q.kind === "choice" ? (got ? "Richtig!" : "Leider falsch.") : got === 2 ? "Volltreffer!" : got ? "Nah dran!" : "Daneben.";
  card.innerHTML = head + body +
    `<p class="quiz-result p${got}"><b>${verdict}</b> ${got ? `+${got} ${got === 1 ? "Punkt" : "Punkte"}` : ""}</p>` +
    (q.kind === "number" ? `<p class="quiz-answer">Die richtige Antwort: <b>${unitText(q, q.answer)}</b>.${q.explain ? ` ${q.explain}` : ""}</p>`
      : q.explain ? `<p class="quiz-answer">${q.explain}</p>` : "") +
    (q.chart ? q.chart() : "") +
    `<div class="quiz-actions"><button type="button" class="primary" data-quiz="next">${quiz.i + 1 < n ? "Weiter" : "Zum Ergebnis"}</button></div>`;
}

function quizAnswer(value) {
  const q = quiz.qs[quiz.i];
  quiz.guess = value;
  const off = Math.abs(value - q.answer);
  quiz.got[quiz.i] = q.kind === "choice" ? (q.options[value] === q.right ? 2 : 0) : off <= q.near[0] ? 2 : off <= q.near[1] ? 1 : 0;
  quiz.done = true;
  quizShow();
  $("#quiz-card [data-quiz=next]").focus({ preventScroll: true });
}

function quizGo(k) {
  Object.assign(quiz, k === "start" ? { qs: quizQuestions(), i: 0, got: [] } : { i: quiz.i + 1 }, { guess: null, done: false });
  quizShow();
  $("#quiz").scrollIntoView({ block: "nearest" });
  ($("#quiz-range") || $("#quiz-card button:not([disabled])"))?.focus({ preventScroll: true });
}

$("#quiz-card").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quiz]");
  if (!b) return;
  const act = b.dataset.quiz;
  if (act === "start" || act === "next") quizGo(act);
  else if (act === "pick") quizAnswer(Number(b.dataset.k));
  else if (act === "answer") quizAnswer(quiz.guess);
  else if (act === "step") {
    const r = $("#quiz-range");
    r.value = Number(r.value) + Number(b.dataset.d);
    r.dispatchEvent(new Event("input"));
  }
});
$("#quiz-card").addEventListener("input", (e) => {
  if (e.target.id !== "quiz-range") return;
  quiz.guess = Number(e.target.value);
  $("#quiz-val").textContent = unitText(quiz.qs[quiz.i], quiz.guess);
});
// Keys for a big screen: 1–4 answer, Enter goes on.
document.addEventListener("keydown", (e) => {
  if (!$("section[data-view=quiz]").classList.contains("active") || e.altKey || e.ctrlKey || e.metaKey) return;
  const q = quiz.qs[quiz.i];
  if (q && !quiz.done && q.kind === "choice" && /^[1-4]$/.test(e.key) && Number(e.key) <= q.options.length) quizAnswer(Number(e.key) - 1);
  else if (e.key === "Enter" && !e.target.closest("button")) {
    const b = $("#quiz-card .quiz-actions .primary");
    if (b) { e.preventDefault(); b.click(); }
  }
});
// Full screen for a TV or projector (not offered where the browser can't do it, e.g. on iPhones).
$("#quiz-full").hidden = !document.fullscreenEnabled;
$("#quiz-full").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : $("#quiz").requestFullscreen()));
document.addEventListener("fullscreenchange", () => {
  $("#quiz-full").textContent = document.fullscreenElement ? "Vollbild beenden" : "Vollbild";
});

// ---------- wiring ----------
function render() {
  const rows = selection();
  renderOverview(rows);
  renderCalendar(rows);
  renderSpiral(rows);
  renderDots(rows);
  renderHours(rows);
  renderKeywords(rows);
  renderDistricts(rows);
  renderAddresses(rows);
  renderList(rows);
  renderYear();
  renderMap(rows);
  renderRadius(rows);
  const dropped = new Set($("#f-storm").checked ? [] : ALL.filter((r) => r.bigDay).map((r) => r.date));
  renderWeather(rows.filter((r) => !r.standby), $("#f-year").value, dropped);
  if ($("section[data-view=myths]").classList.contains("active")) renderMyths(); // same for every filter, and only worked out once opened
  if ($("section[data-view=quiz]").classList.contains("active") && !quiz.qs.length) quizShow();
  drawOutlook(); // needs the width, so only once the view shows
}

function showView(v) {
  document.querySelectorAll("[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
  $("#filters").style.display = ["chance", "year", "myths", "quiz"].includes(v) ? "none" : "";
  try { localStorage.setItem("view", v); } catch {}
  if (v === "chance" && warnStale()) loadWarnings();
  if (ALL.length) render(); // hidden sections have no width, so draw charts once visible
}

// The admin link only shows in a browser that is signed in on the admin page (same site, so the
// saved key is visible here). Everyone else never sees it.
try { $("#admin-link").hidden = !localStorage.getItem("gh-token"); } catch {}

// ---------- Als App speichern ----------
// On phones and tablets, Übersicht offers to put the site on the home screen. Android browsers that can
// install it (Chrome, Edge, Samsung Internet) say so with "beforeinstallprompt", only while it isn't
// installed yet, and the button opens their own install window. iPhones and iPads have no such window and
// can't tell whether the icon exists, so there the button opens a short guide; "Erledigt" or × hide the
// offer on that device. Nothing shows on computers, in other browsers, or when the site runs as the app.
const APP_OFFER_KEY = "app-offer-hidden";
const appOffer = {
  ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  android: /Android/.test(navigator.userAgent),
  install: null, // the browser's install window, while it offers one
};
function showAppOffer() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(APP_OFFER_KEY) === "1"; } catch {}
  const asApp = matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone === true;
  $("#app-offer").hidden = dismissed || asApp || !(appOffer.ios || appOffer.install);
}
function dismissAppOffer() {
  try { localStorage.setItem(APP_OFFER_KEY, "1"); } catch {}
  showAppOffer();
}
window.addEventListener("beforeinstallprompt", (e) => {
  if (!appOffer.android) return; // computers keep the browser's own install symbol
  e.preventDefault(); // the button takes the place of Chrome's own install bar
  appOffer.install = e;
  showAppOffer();
});
window.addEventListener("appinstalled", () => { appOffer.install = null; showAppOffer(); });
$("#app-offer-btn").addEventListener("click", async () => {
  if (appOffer.ios) {
    const guide = $("#app-offer-guide");
    guide.hidden = !guide.hidden;
    $("#app-offer-btn").setAttribute("aria-expanded", String(!guide.hidden));
    return;
  }
  const install = appOffer.install;
  appOffer.install = null; // the window opens only once; the browser offers it again on a later visit
  try { await install.prompt(); await install.userChoice; } catch {}
  showAppOffer();
});
$("#app-offer-close").addEventListener("click", dismissAppOffer);
$("#app-offer-done").addEventListener("click", dismissAppOffer);
if (appOffer.ios) {
  $("#app-offer-sub").textContent = "Mit eigenem Symbol auf dem Home-Bildschirm.";
  // The guide names the buttons as the phone shows them, so a phone set to another language gets the English names.
  if (!/^de\b/i.test(navigator.language || "")) document.querySelectorAll("#app-offer-guide [data-en]").forEach((b) => (b.textContent = b.dataset.en));
  $("#app-offer-btn").setAttribute("aria-expanded", "false");
  $("#app-offer-btn").setAttribute("aria-controls", "app-offer-guide");
}
showAppOffer();

// GitHub Pages lets browsers cache files for 10 minutes; "no-cache" revalidates so new alarms show promptly.
const getJSON = (u, fallback) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);

Promise.all([
  getJSON("data/alarms.json", null), getJSON("data/keywords.json", KW), getJSON("data/manual.json", { rows: [] }),
  getJSON("data/geo.json", {}), getJSON("data/weather.json", { days: {} }),
  getJSON("data/ferien.json", { ranges: [] }), getJSON("data/heimspiele.json", { seasons: {} }),
])
  .then(([data, kw, manual, geo, weather, ferien, heimspiele]) => {
    if (!data) {
      $("#updated").textContent = "–";
      $("#listed").textContent = " · Die Einsätze konnten nicht geladen werden. Bitte die Seite neu laden.";
      return;
    }
    KW = kw;
    GEO = geo;
    WEATHER = weather.days;
    FERIEN = ferien.ranges || [];
    HEIMSPIELE = Object.values(heimspiele.seasons || {}).flat();
    ALL = clean(mergeManual(data.rows, manual.rows));
    UPDATED = new Date(data.updated);
    // Only alarms: events (Veranstaltung) can be listed ahead of time.
    const newest = data.rows.reduce((m, r) => (r.category === "Einsatz" && r.date > m ? r.date : m), "");
    LISTED = newest ? parseDate(newest) : UPDATED;
    $("#updated").textContent = new Date(data.updated).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    if (listBehind()) {
      const byHand = ALL.some((r) => r.manual && parseDate(r.date) > LISTED);
      $("#listed").textContent = ` · Die Website listet Einsätze bis ${fmtDate(newest)}${byHand ? ", neuere sind vorläufig eingetragen" : ""}.`;
    }
    const years = [...new Set(ALL.map((r) => r.date.slice(0, 4)))].sort().reverse();
    $("#f-year").innerHTML += years.map((y) => `<option>${y}</option>`).join("");
    $("#y-year").innerHTML = years.map((y) => `<option>${y}</option>`).join("");
    $("#y-year").addEventListener("change", renderYear);
    $("#y-storm").addEventListener("change", renderYear);
    $("#y-print").addEventListener("click", () => window.print());
    document.querySelectorAll("#filters input, #filters select").forEach((el) => el.addEventListener("change", render));
    $("#q").addEventListener("input", () => renderList(selection()));
    document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
    let v = "overview";
    try { v = localStorage.getItem("view") || v; } catch {}
    showView(v); // draws the chosen view
    renderChance();
    // Only a change of width needs new charts; height changes when a phone's toolbar hides.
    let resize, width = innerWidth;
    window.addEventListener("resize", () => {
      if (innerWidth === width) return;
      width = innerWidth;
      clearTimeout(resize);
      resize = setTimeout(render, 150);
    });
  });
