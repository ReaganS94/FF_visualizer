// "Einsatz heute?": the 24-hour ring with the estimate for the time of day we're in, today and tonight as tiles,
// yesterday's estimate against what happened, the next 7 days from the weather forecast, and how well the
// estimate did so far. The estimate, its backtest and the special nights are worked out in lib/estimate.js, the
// weather rules in lib/weather.js; this draws the view.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WEEKDAYS, WEEKDAYS_LONG, parseDate, isoDate, addDays, weekday, fmtDate } from "../../lib/dates.js";
import { einsaetze } from "../../lib/text.js";
import { HOT, GUST, isHot, isStorm, isThunder, wxKind, weatherFacts, tempScale } from "../../lib/weather.js";
import {
  DAY_START, NIGHT_START, PRIOR, specialNight, alarmWindows, lastCovered, estimate, backtest, backtestFit, backtestGroups, alarmsIn,
  pastNights, estimateLevel,
} from "../../lib/estimate.js";
import { pct, hourTotals } from "../../lib/count.js";
import { ALL, WEATHER, UPDATED, LISTED } from "../../data.js";
import "./chance.css";

const f = (n) => n.toFixed(1);
const num = (x) => x.toLocaleString("de-DE");

export default function Chance() {
  // The time the tab goes by: from when it is first drawn, then once a minute, which moves the ring's "jetzt" hand.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  // Everything else only changes with the window (Tag 6–22 Uhr, Nacht) or the date.
  const h = now.getHours();
  const key = `${isoDate(now)}-${h >= DAY_START && h < NIGHT_START}`;
  const m = useMemo(() => chanceModel(now), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="disclaimer"><strong>Nur eine Schätzung.</strong> Diese Zahlen werden aus vergangenen Einsätzen berechnet und sagen nichts darüber, was heute wirklich passiert. Bitte nicht danach planen und die Einsatzbereitschaft nicht davon abhängig machen.</div>
      <div className="chance-grid">
        <div>
          <Ring m={m} now={now} />
        </div>
        <div>
          <div className="tiles" id="chance">
            {[m.day, m.night].map((w, i) => {
              const active = m.cur === w;
              return (
                <div className={`tile${active ? " now" : ""}`} key={i}>
                  <div className="l">{`${w.label} (${w.time})${active ? " · jetzt" : ""}`}</div>
                  <div className={`v${/\d/.test(w.v) ? "" : " word"}`}>{w.v}</div>
                  <div className="d">{w.d}</div>
                </div>
              );
            })}
          </div>
          <Yesterday m={m} />
        </div>
      </div>
      <p className="note" id="chance-method">
        {(m.ni.name ? `Die ${m.ni.name} wird nicht mit anderen Nächten verglichen, sondern nur mit derselben Nacht in den Vorjahren. ` : "") +
          `So wird gerechnet: Für den Tag zählt, an wie vielen ${m.wd}en vom ${fmtDate(isoDate(m.first))} bis ${fmtDate(isoDate(m.last))} ` +
          `zwischen 6 und 22 Uhr mindestens ein Einsatz war. Weil das nur wenige Tage sind, wird der Wert etwas zum Durchschnitt ` +
          `aller Tage hin ausgeglichen (so, als kämen ${PRIOR} durchschnittliche Tage dazu). Sind ${HOT} °C oder mehr angesagt, ` +
          `werden zusätzlich die bisherigen so heißen Tage verglichen. Für die Nacht zählt der Anteil aller bisherigen Nächte mit Einsatz: ` +
          `Nachts hat sich kein Muster nach Wochentag oder Jahreszeit von einem Jahr aufs nächste gehalten. ` +
          `Wachbesetzungen zählen nicht, die Silvesternacht zählt nicht als vergleichbare Nacht.`}
      </p>
      <Outlook m={m} />
      <h2>Wie gut lag die Schätzung bisher?</h2>
      <Backtest m={m} />
    </>
  );
}

// What the tab shows for the moment `now`, worked out once per window and day.
function chanceModel(now) {
  const win = alarmWindows(ALL);
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

  // The next days from the weather forecast, each with its day estimate.
  const ahead = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i), w = WEATHER[isoDate(d)];
    if (!w) break;
    ahead.push({ d, w, est: i ? estimate(d, first, last, win, WEATHER) : est });
  }
  return {
    win, h, yesterday, first, last, wd, day, night, cur, other, pNow, ni, niY, estY, ahead,
    hours: hourTotals(ALL), bt: backtest(first, last, win, WEATHER),
  };
}

// What the page says about the night of `date`: a percentage, or for a special night the same
// night in earlier years.
function nightInfo(date, est, first, last) {
  const share = { v: `~${Math.round(100 * est.pNight)} %`, d: `in ${est.night} von ${est.nights} bisherigen Nächten gab es mindestens einen Einsatz` };
  const special = specialNight(isoDate(date));
  if (!special) return share;
  const [name, plural] = special;
  const past = pastNights(ALL, date, first, last); // only nights the data fully covers
  if (!past.length) return share;
  const hits = past.filter(([, n]) => n > 0).length;
  const which = hits === past.length ? (past.length === 1 ? "in der letzten" : past.length === 2 ? "in beiden bisherigen" : `in allen ${past.length} bisherigen`)
    : `in ${hits} von ${past.length} bisherigen`;
  return {
    name, v: hits === past.length ? "bisher jedes Jahr" : `${hits} von ${past.length}`,
    d: `${which} ${past.length === 1 ? name : plural} gab es Einsätze (${past.map(([y, n]) => `${y}: ${n}`).join(", ")})`,
  };
}

// 24-hour ring: one segment per hour, darker = more alarms at that time of day since the data starts. The centre
// shows the estimate for the window we're in, a pointer marks the current time. The tooltips are HTML
// (components/tooltip.js).
function Ring({ m, now }) {
  const { hours, cur, other } = m;
  const max = Math.max(1, ...hours);
  const C = 190, R0 = 88, R1 = 138, RB = 146;
  const pt = (deg, r) => { const a = ((deg - 90) * Math.PI) / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (a0, a1, r0, r1) => {
    const [x0, y0] = pt(a0, r1), [x1, y1] = pt(a1, r1), [x2, y2] = pt(a1, r0), [x3, y3] = pt(a0, r0);
    const big = a1 - a0 > 180 ? 1 : 0;
    return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${big} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${big} 0 ${f(x3)} ${f(y3)}Z`;
  };
  const since = m.first.getFullYear();
  const a = (now.getHours() + now.getMinutes() / 60) * 15;
  const text = (x, y, str, cls = "", size = 11) =>
    <text x={f(x)} y={f(y)} textAnchor="middle" style={{ fontSize: `${size}px` }} className={cls}>{str}</text>;
  // "jetzt": a hand across the ring plus a marker outside it
  const [nx0, ny0] = pt(a, R0 - 2), [nx1, ny1] = pt(a, R1 + 2);
  const [tx, ty] = pt(a, RB + 7), [lx, ly] = pt(a - 5, RB + 20), [rx, ry] = pt(a + 5, RB + 20), [jx, jy] = pt(a, RB + 30);
  return (
    <>
      <div id="chance-ring">
        <svg viewBox="0 0 380 380" role="img" aria-label={`Einsätze je Uhrzeit. ${cur.label}: ${cur.v}`}>
          {hours.map((n, h) => (
            <path key={h} className="seg" d={arc(h * 15, h * 15 + 15, R0, R1)} fill={`var(--heat-${Math.min(4, Math.floor((n / max) * 5))})`}
              data-tip={`${h}–${h + 1} Uhr: <b>${einsaetze(n)}</b> seit ${since}`} />
          ))}
          <path d={arc(DAY_START * 15, NIGHT_START * 15, RB, RB + 5)} fill="var(--band-day)" />
          <path d={arc(NIGHT_START * 15, (24 + DAY_START) * 15, RB, RB + 5)} fill="var(--band-night)" />
          {[0, 6, 12, 18].map((h) => { const [x, y] = pt(h * 15, R0 - 12); return <Fragment key={h}>{text(x, y + 4, String(h).padStart(2, "0"), "muted")}</Fragment>; })}
          <line className="hand" x1={f(nx0)} y1={f(ny0)} x2={f(nx1)} y2={f(ny1)} />
          <path className="hand-mark" d={`M${f(tx)} ${f(ty)}L${f(lx)} ${f(ly)}L${f(rx)} ${f(ry)}Z`} />
          {text(jx, jy + 4, "jetzt", "strong")}
          {text(C, C - 30, cur.label, "", 12)}
          {/\d/.test(cur.v) ? text(C, C + 12, cur.v, "big", 34)
            : cur.v.split(" ").map((w, i, all) => <Fragment key={i}>{text(C, C + 6 + (i - (all.length - 1) / 2) * 20, w, "big", 16)}</Fragment>)}
          {other && text(C, C + 38, `${other.short}: ${other.v}`, "", 11)}
        </svg>
      </div>
      <div id="ring-legend">
        <div className="legend">weniger {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ background: `var(--heat-${i})` }} />)} mehr</div>
        <div className="legend">
          <i className="band" style={{ background: "var(--band-day)" }} />{"Tag 6–22 Uhr "}
          <i className="band" style={{ background: "var(--band-night)" }} />Nacht 22–6 Uhr
        </div>
        <p className="note">{`Jedes Stück ist eine Stunde. Je dunkler, desto mehr Einsätze gab es seit ${since} zu dieser Uhrzeit.`}</p>
      </div>
    </>
  );
}

// Yesterday: what the page estimated against what has been entered since.
function Yesterday({ m }) {
  const { h, yesterday, estY, niY } = m;
  const count = (n) => (n ? `${n} ${n === 1 ? "Einsatz" : "Einsätze"}` : "keiner");
  const iy = isoDate(yesterday);
  const rows = [["Gestern tagsüber", `~${Math.round(100 * estY.pDay)} %`, count(alarmsIn(ALL, iy, false))]];
  rows.push(h < DAY_START
    ? ["Diese Nacht", niY.v, "läuft noch"]
    : ["Letzte Nacht", niY.v, count(alarmsIn(ALL, iy, true))]);
  return (
    <>
      <h2>Gestern</h2>
      <div className="table-wrap"><table id="t-yesterday">
        <thead><tr><th>Zeitfenster</th><th>Geschätzt</th><th>Eingetragen</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
      </table></div>
      {/* Last night reaches past midnight, which the website may not have reached yet. */}
      <p className="note" id="yesterday-listed">
        {yesterday > LISTED
          ? `Die Website hat bisher nur Einsätze bis ${fmtDate(isoDate(LISTED))} eingetragen. Hier zählen deshalb nur vorläufige Einträge.`
          : h >= DAY_START && isoDate(LISTED) === iy
            ? "Die Website hat bisher Einsätze bis gestern eingetragen. Einsätze nach Mitternacht fehlen in der letzten Zeile deshalb vielleicht noch."
            : ""}
      </p>
      <p className="note">Ein einzelner Tag sagt wenig darüber, ob die Schätzung stimmt. Das zeigt erst der Abschnitt ganz unten.</p>
    </>
  );
}

// ---------- Die nächsten 7 Tage ----------
// Today and the next six days from the weather forecast, each with the day estimate (weekday plus the
// heat rule, so only the temperature changes it). Hot, stormy and thunder days are tinted, and days
// further ahead fade because the forecast gets less sure. The weather rules are in lib/weather.js.

// [nominative, dative], e.g. ["Gewittertage", "Gewittertagen"]
const factsText = (f, [nom, dat]) => !f.on ? "" : f.on < 10 ? `Bisher gab es erst ${f.on} ${nom}, zu wenige für einen Vergleich.`
  : `An bisherigen ${dat} gab es tagsüber an ${f.onHit} von ${f.on} mindestens einen Einsatz (${pct(f.onHit, f.on)} %), an den anderen Tagen in ${pct(f.offHit, f.off)} %.`;

const WIND_PATH = "M0 -4H9a2.5 2.5 0 1 0-2.5-2.5M0 1H13a2.5 2.5 0 1 1-2.5 2.5";

// The notes on heat, storm and thunder, the chart and its key. The chart needs the section's width, so it is drawn
// once the tab shows, and again when the width changes; a hidden tab keeps the chart it had.
function Outlook({ m }) {
  const { ahead, first, last, win } = m;
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const w = box.current?.clientWidth;
    if (w && w !== width) setWidth(w);
  });
  if (!ahead.length) {
    return (
      <div id="outlook" hidden>
        <h2 id="outlook-title">Die nächsten 7 Tage</h2>
        <div id="outlook-notes" />
        <div className="outlook" id="outlook-chart" />
        <div className="legend" id="outlook-legend" />
        <p className="note" id="outlook-note" />
      </div>
    );
  }
  const name = (i) => (i === 0 ? "heute" : i === 1 ? "morgen" : WEEKDAYS_LONG[weekday(ahead[i].d)]);
  const list = (is, what) => ahead.map((a, i) => (is(a.w) ? `${name(i)}${what ? ` ${what(a.w)}` : ""}` : "")).filter(Boolean).join(", ");
  const hot = list(isHot, (w) => `bis ${Math.round(w.tmax)} °C`);
  // A thunderstorm is only a rough hint after tomorrow.
  const near = (w) => isThunder(w) && ahead.findIndex((a) => a.w === w) < 2, far = (w) => isThunder(w) && !near(w);
  const storm = list(isStorm, (w) => `bis ${Math.round(w.gust)} km/h`), tNear = list(near), tFar = list(far);
  // Großlagen so far: how much wind the weather data showed on those days.
  const big = [...new Set(ALL.filter((r) => r.bigDay).map((r) => r.date))].filter((d) => WEATHER[d]).sort();
  const calm = big.length && big.every((d) => WEATHER[d].gust < GUST);
  const icon = (body) => <svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">{body}</svg>;
  return (
    <div id="outlook">
      <h2 id="outlook-title">{ahead.length > 1 ? `Die nächsten ${ahead.length} Tage` : "Das Wetter heute"}</h2>
      <div id="outlook-notes">
        {hot ? (
          <div className="wx-note hot"><b>Hitze angesagt:</b>
            {` ${hot}. ${factsText(weatherFacts(first, last, win, isHot, WEATHER), [`Tage ab ${HOT} °C`, `Tagen ab ${HOT} °C`])} Die Schätzung für diese Tage ist deshalb höher.`}
          </div>
        ) : null}
        {storm || tNear || tFar ? (
          <div className="wx-note storm">
            {storm ? <><b>Sturmböen angesagt:</b>{` ${storm}. `}</> : null}
            {tNear ? <><b>Gewitter angesagt:</b>{` ${tNear}. `}</> : null}
            {tFar ? <><b>Gewitter möglich:</b>{` ${tFar}. `}</> : null}
            {(storm ? factsText(weatherFacts(first, last, win, isStorm, WEATHER), ["Tage mit Sturmböen", "Tagen mit Sturmböen"]) + " " : "") +
              (tNear || tFar ? factsText(weatherFacts(first, last, win, isThunder, WEATHER), ["Gewittertage", "Gewittertagen"]) + " " : "") +
              "In die Schätzung geht nur die Temperatur ein."}
          </div>
        ) : null}
        {!hot && !storm && !tNear && !tFar && <p className="note">{`In diesen Tagen sind weder ${HOT} °C noch Sturmböen oder Gewitter angesagt.`}</p>}
      </div>
      <div className="outlook" id="outlook-chart" ref={box}>{width > 0 && <OutlookChart ahead={ahead} W={width} />}</div>
      <div className="legend" id="outlook-legend">
        {width > 0 && (
          <>
            <span>{icon(<g className="wx-wind" transform="translate(-7 1)"><path d={WIND_PATH} /></g>)} Windböen in km/h</span>
            <span>
              {icon(<><circle className="wx-ring" r="6.5" style={{ strokeWidth: "3" }} /><circle r="6.5" fill="none" stroke="var(--heat-3)" strokeWidth="3" strokeDasharray="16 41" transform="rotate(-90)" /></>)}
              {" Schätzung: mindestens ein Einsatz tagsüber"}
            </span>
            <span><i className="wx-key hot" />{`ab ${HOT} °C`}</span>
            <span><i className="wx-key storm" />{`Sturmböen ab ${GUST} km/h oder Gewitter`}</span>
          </>
        )}
      </div>
      <p className="note" id="outlook-note">
        {`Wettervorhersage für Hannover (Daten: Open-Meteo). Je weiter ein Tag weg ist, desto blasser: ` +
          `Temperaturen stimmen meist für etwa fünf Tage, Sturm und Gewitter nur für ein bis zwei Tage.` +
          (calm ? ` Großlagen kündigen sich hier oft nicht an: ${big.length === 1 ? "am" : "an den Tagen"} ${big.map(fmtDate).join(" und ")} ` +
            `zeigten die Wetterdaten nur Böen bis ${Math.round(Math.max(...big.map((d) => WEATHER[d].gust)))} km/h.` : "")}
      </p>
    </div>
  );
}

// Catmull-Rom through the points, as cubic curves.
function smoothPath(pts, move = "M") {
  return pts.map(([x, y], i) => {
    if (!i) return `${move}${f(x)} ${f(y)}`;
    const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || [x, y];
    return `C${f(p1[0] + (x - p0[0]) / 6)} ${f(p1[1] + (y - p0[1]) / 6)} ${f(x - (p3[0] - p1[0]) / 6)} ${f(y - (p3[1] - p1[1]) / 6)} ${f(x)} ${f(y)}`;
  }).join("");
}

// Colours of the temperature band, hottest first.
const TEMP_STOPS = [[36, "#a3160d"], [30, "#e0542c"], [25, "#f2994a"], [18, "#f2c94c"], [10, "#7cc6c0"], [0, "#5aa0e0"], [-10, "#3d6fd1"]];

// The chart of the days ahead, `W` pixels wide: a column per day with its weather symbol, temperatures, gusts and
// the day estimate as a small ring. The tooltips are HTML (components/tooltip.js).
function OutlookChart({ ahead, W }) {
  const n = ahead.length, cw = Math.min(140, W / n), x0 = (W - cw * n) / 2, H = 278;
  const narrow = cw < 84;
  const cx = (i) => x0 + cw * (i + 0.5);
  const T0 = 172, T1 = 90; // temperature band from bottom to top
  const { hi, lo, heatLine } = tempScale(ahead.map((a) => a.w));
  const ty = (t) => T0 - ((t - lo) / (hi - lo)) * (T0 - T1);
  const off = (t) => Math.min(1, Math.max(0, (hi - t) / (hi - lo)));
  const fade = n > 2;
  const top = ahead.map((a, i) => [cx(i), ty(a.w.tmax)]), bottom = ahead.map((a, i) => [cx(i), ty(a.w.tmin)]);
  // the heat line's label goes to the end where it is furthest from that day's temperature
  const gap = (i) => Math.abs(ty(ahead[i].w.tmax) - 9 - (ty(HOT) - 4));
  const right = n > 1 && gap(n - 1) > gap(0);
  const R = 17, C = 2 * Math.PI * R, RY = 250;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Wetter und Schätzung für die nächsten ${n} Tage`}>
      <defs>
        <linearGradient id="wx-temp" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={f(ty(hi))} y2={f(ty(lo))}>
          {TEMP_STOPS.map(([t, c]) => <stop key={t} offset={off(t).toFixed(3)} stopColor={c} />)}
        </linearGradient>
        <linearGradient id="wx-hot" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--wx-hot)" stopOpacity=".38" /><stop offset=".75" stopColor="var(--wx-hot)" stopOpacity=".06" /></linearGradient>
        <linearGradient id="wx-storm" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--wx-storm)" stopOpacity=".34" /><stop offset=".75" stopColor="var(--wx-storm)" stopOpacity=".06" /></linearGradient>
        {fade && (
          <>
            <linearGradient id="wx-fade" gradientUnits="userSpaceOnUse" x1={f(cx(1))} x2={f(cx(n - 1))} y1="0" y2="0">
              <stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#6a6a6a" />
            </linearGradient>
            <mask id="wx-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}><rect width={W} height={H} fill="url(#wx-fade)" /></mask>
          </>
        )}
      </defs>
      {/* columns */}
      {ahead.map((a, i) => {
        const x = x0 + cw * i + 2, w = cw - 4, cls = [isHot(a.w) && "hot", (isStorm(a.w) || isThunder(a.w)) && "storm", i === 0 && "now"].filter(Boolean).join(" ");
        const day = i === 0 ? "Heute" : i === 1 ? "Morgen" : (narrow ? WEEKDAYS : WEEKDAYS_LONG)[weekday(a.d)];
        return (
          <g className={`wx-col ${cls}`} key={i}>
            <rect className="wx-card" x={f(x)} y="0" width={f(w)} height={H} rx="10" />
            {isHot(a.w) && <rect className="wx-hotbg" x={f(x)} y="0" width={f(w)} height={H} rx="10" fill="url(#wx-hot)" />}
            {(isStorm(a.w) || isThunder(a.w)) && <rect className={`wx-stormbg${isThunder(a.w) ? " thunder" : ""}`} x={f(x)} y="0" width={f(w)} height={H} rx="10" fill="url(#wx-storm)" />}
            <text x={f(cx(i))} y="20" className="wx-day" style={{ fontSize: `${narrow ? 12 : 13}px` }}>{day}</text>
            <text x={f(cx(i))} y="35" className="wx-date">{fmtDate(isoDate(a.d)).slice(0, 6)}</text>
          </g>
        );
      })}
      {/* the forecast itself, fading with distance */}
      <g className="wx-fc" mask={fade ? "url(#wx-mask)" : undefined}>
        {ahead.map((a, i) => { const k = wxKind(a.w); return k && <g className={`wx-icon${isHot(a.w) ? " hot" : ""}`} key={i}><WxIcon kind={k[0]} x={cx(i)} y={60} /></g>; })}
        {heatLine && (
          <>
            <line className="wx-heatline" x1={f(x0 + 4)} x2={f(x0 + cw * n - 4)} y1={f(ty(HOT))} y2={f(ty(HOT))} />
            <text className="wx-heatlabel" x={f(right ? x0 + cw * n - 8 : x0 + 8)} y={f(ty(HOT) - 4)} style={{ textAnchor: right ? "end" : "start" }}>{`${HOT} °C`}</text>
          </>
        )}
        {n > 1 ? (
          <>
            <path className="wx-band" d={`${smoothPath(top)}${smoothPath([...bottom].reverse(), "L")}Z`} />
            <path className="wx-tmax" d={smoothPath(top)} /><path className="wx-tmin" d={smoothPath(bottom)} />
          </>
        ) : <line className="wx-tmax" x1={f(top[0][0])} x2={f(top[0][0])} y1={f(top[0][1])} y2={f(bottom[0][1])} />}
        {ahead.map((a, i) => {
          const [x, y] = top[i], [, yb] = bottom[i];
          return (
            <Fragment key={i}>
              <circle className="wx-dot" cx={f(x)} cy={f(y)} r="3.5" />
              <text x={f(x)} y={f(y - 9)} className={`wx-tmaxlabel${isHot(a.w) ? " hot" : ""}`}>{`${Math.round(a.w.tmax)}°`}</text>
              <text x={f(x)} y={f(yb + 15)} className="wx-tminlabel">{`${Math.round(a.w.tmin)}°`}</text>
            </Fragment>
          );
        })}
        {ahead.map((a, i) => {
          const x = cx(i), st = isStorm(a.w);
          return (
            <Fragment key={i}>
              <g className={`wx-wind${st ? " storm" : ""}`} transform={`translate(${f(x - 17)} 210)`}><path d={WIND_PATH} /></g>
              <text x={f(x + 7)} y="214" className={`wx-gust${st ? " storm" : ""}`}>{Math.round(a.w.gust)}</text>
            </Fragment>
          );
        })}
      </g>
      {/* the day estimate as a small ring: darker = more, like the ring above */}
      {ahead.map((a, i) => {
        const p = a.est.pDay, x = cx(i);
        return (
          <Fragment key={i}>
            <circle className="wx-ring" cx={f(x)} cy={RY} r={R} />
            <circle cx={f(x)} cy={RY} r={R} fill="none" stroke={`var(--heat-${estimateLevel(p)})`} strokeWidth="6" strokeDasharray={`${f(p * C)} ${f(C)}`}
              transform={`rotate(-90 ${f(x)} ${RY})`} />
            <text x={f(x)} y={RY + 4} className="wx-pct">{Math.round(100 * p)}<tspan dx="1" style={{ fontSize: "8px" }}>%</tspan></text>
          </Fragment>
        );
      })}
      {/* one invisible target per column for the tooltip */}
      {ahead.map((a, i) => {
        const k = wxKind(a.w), e = a.est, wd = WEEKDAYS_LONG[weekday(a.d)];
        const why = e.heat ? `an ${e.hotDay} von ${e.hot} Tagen ab ${HOT} °C und an ${e.day} von ${e.n} ${wd}en gab es mindestens einen Einsatz`
          : `an ${e.day} von ${e.n} ${wd}en gab es mindestens einen Einsatz`;
        const tip = `<b>${wd}, ${fmtDate(isoDate(a.d))}</b><br>` +
          [k && k[1], `${Math.round(a.w.tmin)} bis ${Math.round(a.w.tmax)} °C`, `Böen bis ${Math.round(a.w.gust)} km/h`].filter(Boolean).join(" · ") +
          (isStorm(a.w) ? "<br>Sturmböen" : "") + (isThunder(a.w) ? `<br>Gewitter ${i < 2 ? "angesagt" : "möglich"}` : "") +
          `<br>Schätzung tagsüber: <b>~${Math.round(100 * e.pDay)} %</b><br>${why}`;
        return <rect key={i} className="wx-hit" x={f(x0 + cw * i)} y="0" width={f(cw)} height={H} data-tip={tip} />;
      })}
    </svg>
  );
}

// A weather symbol centred on (x, y).
function WxIcon({ kind, x, y }) {
  const rays = (r0, r1) => Array.from({ length: 8 }, (_, i) => {
    const c = Math.cos((i * Math.PI) / 4), s = Math.sin((i * Math.PI) / 4);
    return <line key={i} x1={(r0 * c).toFixed(1)} y1={(r0 * s).toFixed(1)} x2={(r1 * c).toFixed(1)} y2={(r1 * s).toFixed(1)} />;
  });
  // the inner group turns on hot days, so its own transform stays free for the animation
  const sun = (dx, dy, k) => <g transform={`translate(${dx} ${dy}) scale(${k})`}><g className="wx-sun"><circle r="7" />{rays(10, 13.5)}</g></g>;
  const cloud = (dx, dy, cls = "wx-cloud") => (
    <g className={cls} transform={`translate(${dx} ${dy})`}><circle cx="-6" cy="2" r="6.5" />
      <circle cx="2" cy="-3" r="8.5" /><circle cx="9" cy="2.5" r="6" /><rect x="-12.5" y="2" width="27.5" height="7" rx="3.5" /></g>
  );
  const drops = (cls, mark) => <g className={cls}>{[-7, 0, 7].map(mark)}</g>;
  const body = {
    sun: () => sun(0, 0, 1),
    part: () => <>{sun(-5, -5, 0.8)}{cloud(3, 4)}</>,
    cloud: () => cloud(0, 0),
    rain: () => <>{cloud(0, -4)}{drops("wx-rain", (dx) => <line key={dx} x1={dx + 1} y1="9" x2={dx - 2} y2="16" />)}</>,
    snow: () => <>{cloud(0, -4)}{drops("wx-snow", (dx, i) => <circle key={dx} cx={dx} cy={12 + (i % 2) * 3} r="1.8" />)}</>,
    fog: () => <g className="wx-fog">{[-6, 0, 6].map((dy, i) => <line key={dy} x1={-13 + i * 3} y1={dy} x2={13 - i * 3} y2={dy} />)}</g>,
    thunder: () => <>{cloud(0, -6, "wx-cloud dark")}<path className="wx-bolt" d="M1 1L-5 11H0L-3 20L6 7H1L4 1Z" /></>,
  }[kind];
  return body ? <g transform={`translate(${x.toFixed(1)} ${y})`}>{body()}</g> : null;
}

// How well the estimate did so far: low, middle and high estimates, each as 100 dots with the ones that had an
// alarm filled in, and the exact numbers folded away.
function Backtest({ m }) {
  const { bt, first, pNow } = m;
  const btRows = bt.bins.map((b) => {
    const range = b.hi > 100 ? `ab ${b.lo} %` : `${b.lo}–${b.hi} %`, rate = Math.round((100 * b.hit) / b.n);
    return { b, range, rate, fit: backtestFit(b, rate) };
  });
  // Read one row out loud: the one with the most estimates.
  const ex = btRows.reduce((a, r) => (!a || r.b.n > a.b.n ? r : a), null); // null with under half a year of data
  const groups = backtestGroups(bt);
  // Rounded first, so "jetzt ~10 %" never sits under "unter 10 %".
  const nowPct = pNow == null ? null : Math.round(100 * pNow);
  const isNow = (g) => nowPct != null && nowPct >= g.lo && nowPct < g.hi;
  // A group with only a few estimates would fill a whole picture from a handful of days, so it is only
  // drawn when today's estimate falls into it ("Genaue Zahlen" still lists it), and it never decides the verdict.
  const sized = groups.filter((g) => g.n >= 50);
  const shown = groups.filter((g) => g.n >= 50 || isNow(g));
  const anyNow = shown.some(isNow);
  const low = sized[0], high = sized.at(-1), most = groups.reduce((a, g) => (!a || g.n > a.n ? g : a), null);
  const off = groups.filter((g) => g.fit.startsWith("Nein"));
  return (
    <>
      <p className="note" id="backtest-note">
        {`Für jeden Tag und jede Nacht ab ${fmtDate(isoDate(addDays(first, 182)))} wurde nachgerechnet, was die Schätzung damals gesagt hätte, ` +
          `und nachgesehen, ob es dann wirklich einen Einsatz gab (${num(bt.n)} Schätzungen). Jedes Bild zeigt das umgerechnet auf 100 solche Tage oder Nächte.`}
      </p>
      <div className="odds" id="backtest-odds">
        {shown.map((g) => {
          const now = isNow(g);
          return (
            <figure className={`odd${now ? " now" : ""}`} key={g.label}
              data-tip={`Die Schätzung sagte ${g.label}: bei ${num(g.hit)} von ${num(g.n)} Schätzungen gab es wirklich einen Einsatz (${g.rate} %).`}>
              <figcaption>Die Schätzung sagte<br /><b>{g.label}</b>
                {/* the others keep an invisible tag so the dots of all three line up */}
                {now ? <span className="tag">{`jetzt ~${nowPct} %`}</span> : anyNow ? <span className="tag ghost">jetzt</span> : null}
              </figcaption>
              <HundredDots k={g.rate} />
              <div className="odd-v"><b>{g.rate}</b> von 100</div>
              <div className="odd-d">hatten einen Einsatz<br />{`${num(g.n)} Schätzungen${g.n < 50 ? ", noch zu wenige" : ""}`}</div>
            </figure>
          );
        })}
      </div>
      <p className="note" id="backtest-verdict">
        {!most ? "" : [
          sized.length > 1 && high.rate >= low.rate + 10 ? "Je höher die Schätzung, desto öfter gab es wirklich einen Einsatz."
            : sized.length > 1 ? "Nach hohen und niedrigen Schätzungen gab es bisher etwa gleich oft einen Einsatz." : "",
          off.length ? off.map((g) => `Im Bereich ${g.label} lag die Schätzung etwas zu ${g.fit === "Nein, zu niedrig" ? "niedrig" : "hoch"}: Es waren ${g.rate} von 100.`).join(" ")
            : "Die Zahlen passen ungefähr zu dem, was die Schätzung gesagt hat.",
          `Die meisten Schätzungen (${num(most.n)} von ${num(bt.n)}) lagen bei ${most.label}.` +
            (most !== low && most !== high ? " Die Schätzung unterscheidet also nur grob zwischen ruhigeren und unruhigeren Tagen." : ""),
        ].filter(Boolean).join(" ")}
      </p>
      <details className="more">
        <summary>Genaue Zahlen</summary>
        <p className="note" id="backtest-example">
          {!ex ? "" :
            `So liest man eine Zeile: ${num(ex.b.n)}-mal sagte die Schätzung ${ex.range}. In ${num(ex.b.hit)} dieser Fälle gab es wirklich einen Einsatz, ` +
            `das sind ${ex.rate} %. ` + {
              "Ja": "Das liegt im geschätzten Bereich, die Schätzung passt also.",
              "Nein, zu niedrig": "Das liegt über dem geschätzten Bereich, hier lag die Schätzung also zu niedrig.",
              "Nein, zu hoch": "Das liegt unter dem geschätzten Bereich, hier lag die Schätzung also zu hoch.",
              "Zu wenige Fälle": "Das sind noch zu wenige Fälle, um es zu beurteilen.",
            }[ex.fit]}
        </p>
        <div className="table-wrap"><table id="t-backtest">
          <thead><tr><th>Die Schätzung sagte</th><th>So oft</th><th>Davon wirklich mit Einsatz</th><th>Passt?</th></tr></thead>
          <tbody>
            {btRows.map(({ b, range, rate, fit }) => (
              <tr key={range}>
                <td style={{ whiteSpace: "nowrap" }}>{range}</td><td>{`${num(b.n)}-mal`}</td>
                <td>{`${num(b.hit)} von ${num(b.n)} `}<span style={{ whiteSpace: "nowrap" }}>{`(${rate} %)`}</span></td><td>{fit}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </details>
    </>
  );
}

// 10 × 10 dots, the first `k` filled: "k of 100".
function HundredDots({ k }) {
  return (
    <svg viewBox="0 0 100 100" className="dots100" role="img" aria-label={`${k} von 100`}>
      {Array.from({ length: 100 }, (_, i) => <circle key={i} cx={5 + (i % 10) * 10} cy={5 + Math.floor(i / 10) * 10} r="3.8" className={i < k ? "on" : undefined} />)}
    </svg>
  );
}
