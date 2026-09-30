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
  const W = el.clientWidth || 1000, R = 40;
  const max = Math.max(1, ...items.map((d) => d.value));
  // Labels left of the bars; if one doesn't fit (long keyword names on a phone), each label goes above its bar.
  const draw = (stacked) => {
    const row = stacked ? 38 : 26, L = stacked ? 0 : Math.min(labelWidth, W * 0.5), top = stacked ? 18 : 3;
    const H = items.length * row + 4;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    items.forEach((d, i) => {
      const y = i * row + 4, w = ((W - L - R) * d.value) / max;
      s += stacked ? `<text class="lbl" x="0" y="${y + 12}">${esc(d.label)}</text>`
        : `<text class="lbl" x="${L - 8}" y="${y + 15}" text-anchor="end">${esc(d.label)}</text>`;
      s += `<path class="bar" d="${roundRight(L, y + top, w, stacked ? 14 : row - 8, 4)}"/>`;
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
    const what = topCounts(list, kind, 2).map(([k, l]) => `${l.length}× ${esc(k)}`).join(" · ");
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
// Share of comparable past days (same weekday, month within ±1) that had at least one alarm
// in the window. Deliberately simple so anyone can check it by hand.
const MIN_DAYS = 20;
const PRIOR = 10;
const monthDist = (a, b) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));
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
  let total = 0, totDay = 0, totalNights = 0, totNight = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const k = isoDate(d);
    total++; totDay += win.inDay.has(k);
    if (!specialNight(k)) { totalNights++; totNight += win.inNight.has(k); }
  }
  const blend = (hits, n, base) => (n + PRIOR ? (hits + PRIOR * base) / (n + PRIOR) : 0);
  const nights = days.filter((d) => !specialNight(d));
  const day = days.filter((d) => win.inDay.has(d)).length;
  const night = nights.filter((d) => win.inNight.has(d)).length;
  return {
    strict, n: days.length, nNight: nights.length, day, night,
    pDay: blend(day, days.length, totDay / total), pNight: blend(night, nights.length, totNight / totalNights),
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
  const pct = { v: `~${Math.round(100 * est.pNight)} %`, d: `in ${est.night} von ${est.nNight} vergleichbaren Nächten gab es mindestens einen Einsatz` };
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
  const scope = est.strict
    ? `${WEEKDAYS_LONG[weekday(today)]}e von ${MONTHS_LONG[(today.getMonth() + 11) % 12]} bis ${MONTHS_LONG[(today.getMonth() + 1) % 12]}`
    : `alle ${WEEKDAYS_LONG[weekday(today)]}e`;
  const day = { short: "Tag", label: "Heute tagsüber", time: "6–22 Uhr", v: `~${Math.round(100 * est.pDay)} %`, d: `an ${est.day} von ${est.n} vergleichbaren Tagen gab es mindestens einen Einsatz` };
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
    `So wird gerechnet: Vergleichbare Tage sind ${scope} vom ${fmtDate(isoDate(first))} bis ${fmtDate(isoDate(last))}. ` +
    `Gezählt wird, an wie vielen davon im jeweiligen Zeitfenster mindestens ein Einsatz war. ` +
    `Weil das nur wenige Tage sind, wird der Wert etwas zum Durchschnitt aller Tage hin ausgeglichen ` +
    `(so, als kämen ${PRIOR} durchschnittliche Tage dazu). Wachbesetzungen zählen nicht, die Silvesternacht zählt nicht als vergleichbare Nacht.`;

  const w = WEATHER[isoDate(today)];
  const warn = w && (w.gust >= 60 || w.rain >= 20);
  $("#chance-weather").hidden = !warn;
  if (warn) {
    $("#chance-weather").textContent = `Wetter heute laut Vorhersage: Böen bis ${Math.round(w.gust)} km/h, ${w.rain.toFixed(1).replace(".", ",")} mm Regen. ` +
      `Bei solchem Wetter gab es bisher deutlich mehr Einsätze als sonst (siehe Ansicht „Wetter“). Die Zahlen oben berücksichtigen das nicht.`;
  }

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
  const anyNow = groups.some(isNow);
  $("#backtest-odds").innerHTML = groups.map((g) => {
    const now = isNow(g);
    // the others keep an invisible tag so the dots of all three line up
    const tag = now ? `<span class="tag">jetzt ~${nowPct} %</span>` : anyNow ? '<span class="tag ghost">jetzt</span>' : "";
    return `<figure class="odd${now ? " now" : ""}" data-tip="Die Schätzung sagte ${g.label}: bei ${num(g.hit)} von ${num(g.n)} Schätzungen gab es wirklich einen Einsatz (${g.rate} %).">` +
      `<figcaption>Die Schätzung sagte<br><b>${g.label}</b>${tag}</figcaption>` +
      hundredDots(g.rate) +
      `<div class="odd-v"><b>${g.rate}</b> von 100</div><div class="odd-d">hatten einen Einsatz<br>${num(g.n)} Schätzungen${g.n < 50 ? ", noch zu wenige" : ""}</div></figure>`;
  }).join("");
  const low = groups[0], high = groups.at(-1), most = groups.reduce((a, g) => (!a || g.n > a.n ? g : a), null);
  const off = groups.filter((g) => g.fit.startsWith("Nein"));
  $("#backtest-verdict").textContent = !most ? "" : [
    groups.length > 1 && high.rate >= low.rate + 10 ? "Je höher die Schätzung, desto öfter gab es wirklich einen Einsatz."
      : groups.length > 1 ? "Nach hohen und niedrigen Schätzungen gab es bisher etwa gleich oft einen Einsatz." : "",
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
  if (!window.L) {
    await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    await loadScript("https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js");
  }
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
  // (they'd otherwise count as stormy days without alarms).
  const covered = days.filter((d) => d >= first && d <= last && (!year || d.startsWith(year)) && !dropped.has(d));
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

function renderMyths() {
  const { results, first, last, days } = mythResults();
  const dec = (x) => x.toFixed(2).replace(".", ",");
  $("#myths-note").textContent = `Gezählt werden ${days.toLocaleString("de-DE")} Tage vom ${fmtDate(isoDate(first))} bis ${fmtDate(isoDate(last))}, ` +
    "ohne Großlagen und ohne Wachbesetzungen.";
  $("#c-myths").innerHTML = results.map((m) => {
    const { t } = m;
    const [cls, verdict, why] = mythVerdict(t, m.pick);
    const r = t.base ? t.avg / t.base : t.avg ? Infinity : 1;
    const [how, word] = r === Infinity ? ["mehr", "als"] : r >= 1.95 ? [`${r.toFixed(1).replace(".", ",")}-mal so viele`, "wie"]
      : r >= 1.1 ? [`${Math.round(100 * (r - 1))} % mehr`, "als"]
      : r > 0.9 ? ["etwa gleich viele", "wie"] : [`${Math.round(100 * (1 - r))} % weniger`, "als"];
    const max = [0.5, 1, 2, 5, 10, 20, 50].find((v) => v >= 1.1 * Math.max(t.avg, t.hi)) || 100;
    const x = (v) => `${((100 * v) / max).toFixed(2)}%`;
    return `<article class="myth ${cls}"><header><h3>${m.title}</h3><span class="verdict">${verdict}</span></header>` +
      `<div class="myth-strip" role="img" aria-label="${esc(m.label)}: ${dec(t.avg)} pro Tag. ${esc(m.cmp)}: zufällig ${dec(t.lo)} bis ${dec(t.hi)}.">` +
      `<span class="myth-band" style="left:${x(t.lo)};width:calc(${x(t.hi - t.lo)} + 2px)"></span>` +
      `<span class="myth-base" style="left:${x(t.base)}"></span><span class="myth-dot" style="left:${x(t.avg)}"></span></div>` +
      `<div class="myth-axis">${[0, max / 2, max].map((v) => `<span style="left:${x(v)}">${String(v).replace(".", ",")}</span>`).join("")}</div>` +
      `<ul class="myth-legend"><li><i class="k-dot"></i>${esc(m.label)}: <b>${dec(t.avg)}</b> Einsätze pro Tag</li>` +
      `<li><i class="k-band"></i>${esc(m.cmp)}: <b>${dec(t.base)}</b>, durch Zufall zwischen ${dec(t.lo)} und ${dec(t.hi)}</li></ul>` +
      `<p>${m.on} gab es ${how} Einsätze ${word} ${m.vs}. ${why}</p>` +
      `<p class="myth-about">${esc(m.about(t))}</p></article>`;
  }).join("");
}

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
  const dropped = new Set($("#f-storm").checked ? [] : ALL.filter((r) => r.bigDay).map((r) => r.date));
  renderWeather(rows.filter((r) => !r.standby), $("#f-year").value, dropped);
  if ($("section[data-view=myths]").classList.contains("active")) renderMyths(); // same for every filter, and only worked out once opened
}

function showView(v) {
  document.querySelectorAll("[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
  $("#filters").style.display = ["chance", "year", "myths"].includes(v) ? "none" : "";
  try { localStorage.setItem("view", v); } catch {}
  if (ALL.length) render(); // hidden sections have no width, so draw charts once visible
}

// The admin link only shows in a browser that is signed in on the admin page (same site, so the
// saved key is visible here). Everyone else never sees it.
try { $("#admin-link").hidden = !localStorage.getItem("gh-token"); } catch {}

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
