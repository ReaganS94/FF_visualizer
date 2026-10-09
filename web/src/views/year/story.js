// Jahr als Story: full-screen cards to tap or swipe through, one fact each, sized for a phone screenshot.
// Uses the year and the "Großlagen mitzählen" choice of the Jahresrückblick. It sets itself up when the page
// loads; year.js only has to load this file.

import { WEEKDAYS_LONG, parseDate, weekday, fmtDate, longestRun } from "../../lib/dates.js";
import { esc, einsaetze } from "../../lib/text.js";
import { DAY_START, NIGHT_START } from "../../lib/estimate.js";
import { yearInfo, runningTotal } from "../../lib/year.js";
import { topCounts, pct } from "../../lib/count.js";
import { $, calm } from "../../dom.js";
import { ALL, LISTED } from "../../data.js";
import { raceChart } from "./race-chart.js";
import "./story.css";

function storyCards(year, storm) {
  const info = yearInfo(year, storm, ALL, LISTED);
  const { rows } = info;
  if (!rows.length) return [];
  const cards = [];
  const add = (theme, html, after) => cards.push({ theme, html, after });
  const num = (n, extra = "") => `<span data-to="${n}"${extra}>${n}</span>`;
  const dm = (iso) => fmtDate(iso).slice(0, 6);
  // big words shrink with their length so they stay on one line
  const fit = (text, max = 26) => `style="font-size:min(${max}cqw, ${(120 / text.length).toFixed(1)}cqw, 16cqh)"`;
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
  const quiet = longestRun(busy, `${year}-01-01`, info.partial ? info.listed : `${year}-12-31`, false);
  if (quiet && quiet.len > 1) {
    add("amber", `<div class="st-kicker">Die längste Pause</div><div class="st-hero">${num(quiet.len)} <span class="st-unit">Tage</span></div>` +
      `<div class="st-text">ohne einen einzigen Einsatz, vom ${dm(quiet.from)} bis ${fmtDate(quiet.to)}.</div>`);
  }

  if (info.delta !== null) {
    const prevYear = String(year - 1);
    const period = info.partial ? ` (jeweils bis ${dm(info.cutDate)})` : "";
    const sign = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;
    const withBig = storm && [...info.cmpRows, ...info.prevSame].some((r) => r.bigDay);
    const without = withBig ? yearInfo(year, false, ALL, LISTED).delta : null;
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
