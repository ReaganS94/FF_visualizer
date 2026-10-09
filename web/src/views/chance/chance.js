// "Einsatz heute?": the 24-hour ring with the estimate for the time of day we're in, today and tonight as tiles,
// yesterday's estimate against what happened, the next 7 days from the weather forecast, and how well the
// estimate did so far. The estimate and its backtest are worked out in lib/estimate.js; this draws the view.

import { WEEKDAYS, WEEKDAYS_LONG, parseDate, isoDate, addDays, weekday, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze } from "../../lib/text.js";
import { HOT, GUST, isHot, isStorm, isThunder, wxKind, weatherFacts } from "../../lib/weather.js";
import {
  DAY_START, NIGHT_START, PRIOR, specialNight, alarmWindows, lastCovered, estimate, backtest, backtestFit, backtestGroups, alarmsIn,
} from "../../lib/estimate.js";
import { pct } from "../../lib/count.js";
import { $ } from "../../dom.js";
import { ALL, WEATHER, UPDATED, LISTED } from "../../data.js";
import "./chance.css";

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
    if (d >= first && d <= last) past.push([y, alarmsIn(ALL, isoDate(d), true)]); // only nights the data fully covers
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
// further ahead fade because the forecast gets less sure. The weather rules are in lib/weather.js.

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
      `${factsText(weatherFacts(first, last, win, isHot, WEATHER), [`Tage ab ${HOT}\u00a0°C`, `Tagen ab ${HOT}\u00a0°C`])} Die Schätzung für diese Tage ist deshalb höher.</div>`);
  }
  // A thunderstorm is only a rough hint after tomorrow.
  const near = (w) => isThunder(w) && ahead.findIndex((a) => a.w === w) < 2, far = (w) => isThunder(w) && !near(w);
  const storm = list(isStorm, (w) => `bis ${Math.round(w.gust)} km/h`), tNear = list(near), tFar = list(far);
  if (storm || tNear || tFar) {
    notes.push(`<div class="wx-note storm">` +
      (storm ? `<b>Sturmböen angesagt:</b> ${storm}. ` : "") + (tNear ? `<b>Gewitter angesagt:</b> ${tNear}. ` : "") + (tFar ? `<b>Gewitter möglich:</b> ${tFar}. ` : "") +
      (storm ? factsText(weatherFacts(first, last, win, isStorm, WEATHER), ["Tage mit Sturmböen", "Tagen mit Sturmböen"]) + " " : "") +
      (tNear || tFar ? factsText(weatherFacts(first, last, win, isThunder, WEATHER), ["Gewittertage", "Gewittertagen"]) + " " : "") +
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

export function drawOutlook() {
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

export function renderChance() {
  const win = alarmWindows(ALL);
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = addDays(today, -1);
  const first = parseDate(ALL[ALL.length - 1].date);
  // Only count days the data fully covers.
  const last = lastCovered(today, UPDATED, LISTED), lastY = lastCovered(yesterday, UPDATED, LISTED);

  const est = estimate(today, first, last, win, WEATHER);
  const estY = estimate(yesterday, first, lastY, win, WEATHER); // what the page said yesterday
  const wd = WEEKDAYS_LONG[weekday(today)];
  const sameDays = `an ${est.day} von ${est.n} ${wd}en`;
  const day = { short: "Tag", label: "Heute tagsüber", time: "6–22 Uhr", v: `~${Math.round(100 * est.pDay)} %`, d: est.heat
    ? `heute bis ${Math.round(est.tmax)} °C angesagt: an ${est.hotDay} von ${est.hot} so heißen Tagen gab es mindestens einen Einsatz, ${sameDays}`
    : `${sameDays} gab es mindestens einen Einsatz` };
  const ni = nightInfo(today, est, first, last);
  const night = { short: "Nacht", label: ni.name ? `Heute: ${ni.name}` : "Heute Nacht", time: "22–6 Uhr", v: ni.v, d: ni.d };
  const niY = nightInfo(yesterday, estY, first, lastY);
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
  const rows = [["Gestern tagsüber", `~${Math.round(100 * estY.pDay)} %`, count(alarmsIn(ALL, iy, false))]];
  rows.push(h < DAY_START
    ? ["Diese Nacht", niY.v, "läuft noch"]
    : ["Letzte Nacht", niY.v, count(alarmsIn(ALL, iy, true))]);
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
    ahead.push({ d, w, est: i ? estimate(d, first, last, win, WEATHER) : est });
  }
  chanceModel.ahead = ahead;
  renderOutlook(ahead, first, last, win);

  const bt = backtest(first, last, win, WEATHER);
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
  const groups = backtestGroups(bt);
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

// 10 × 10 dots, the first `k` filled: "k of 100".
function hundredDots(k) {
  let s = `<svg viewBox="0 0 100 100" class="dots100" role="img" aria-label="${k} von 100">`;
  for (let i = 0; i < 100; i++) {
    s += `<circle cx="${5 + (i % 10) * 10}" cy="${5 + Math.floor(i / 10) * 10}" r="3.8"${i < k ? ' class="on"' : ""}/>`;
  }
  return s + "</svg>";
}
