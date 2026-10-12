// Jahr als Story: full-screen cards to tap or swipe through, one fact each, sized for a phone screenshot.
// The Jahresrückblick's button opens it with storyOpen(), for the year and the "Großlagen mitzählen" choice of
// the tab. React draws the dialog's inside (#story in index.html) from the cards and the card shown, each time
// they change; opening, closing, the keys and the back button are handled here as before.

import { Fragment, cloneElement, useLayoutEffect, useRef } from "react";
import { WEEKDAYS_LONG, parseDate, weekday, fmtDate, longestRun } from "../../lib/dates.js";
import { einsaetze } from "../../lib/text.js";
import { DAY_START, NIGHT_START } from "../../lib/estimate.js";
import { yearInfo, runningTotal } from "../../lib/year.js";
import { topCounts, pct } from "../../lib/count.js";
import { $, calm } from "../../dom.js";
import { ALL, LISTED } from "../../data.js";
import { show } from "../../show.js";
import Chart from "../../components/Chart.jsx";
import { raceChart } from "./race-chart.js";
import "./story.css";

const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;

// A number that counts up from 0 when its card appears.
function Count({ to, sign = false }) {
  const el = useRef(null);
  useLayoutEffect(() => countUp(el.current), []);
  return <span ref={el} data-to={to} data-sign={sign ? "1" : undefined}>{sign ? signed(to) : String(to)}</span>;
}

function countUp(el) {
  const to = Number(el.dataset.to);
  const show = (v) => { el.textContent = el.dataset.sign ? signed(v) : String(v); };
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

// big words shrink with their length so they stay on one line
const fit = (text, max = 26) => ({ fontSize: `min(${max}cqw, ${(120 / text.length).toFixed(1)}cqw, 16cqh)` });
const Times = ({ children }) => <span className="st-nw">{children}-mal</span>;

// The cards of a year: [{theme, body: [the card's parts]}], none for a year without alarms.
function storyCards(year, storm) {
  const info = yearInfo(year, storm, ALL, LISTED);
  const { rows } = info;
  if (!rows.length) return [];
  const cards = [];
  const add = (theme, ...body) => cards.push({ theme, body: body.filter(Boolean) });
  const dm = (iso) => fmtDate(iso).slice(0, 6);

  add("red", <div className="st-kicker">Freiwillige Feuerwehr Hannover-Linden</div>, <div className="st-title">{`Das Einsatzjahr ${year}`}</div>,
    info.partial && <div className="st-text">{`${info.running ? "Das Jahr läuft noch. " : ""}Gezählt ist alles bis zum ${fmtDate(info.lastDate)}.`}</div>,
    <div className="st-small">Zum Weiterblättern tippen oder wischen.</div>);

  // Average per week only over days the data fully covers.
  const covered = info.partial ? info.cmpRows : rows;
  const weeks = ((parseDate(info.cutDate) - parseDate(`${year}-01-01`)) / 864e5 + 1) / 7;
  const big = topCounts(ALL.filter((r) => !r.standby && r.bigDay && r.date.startsWith(year)), (r) => r.date)
    .sort(([a], [b]) => a.localeCompare(b));
  const bigText = big.length === 1 ? `die Großlage am ${dm(big[0][0])} mit ${einsaetze(big[0][1].length, true)}`
    : `die Großlagen am ${big.map(([d, l]) => `${dm(d)} (${einsaetze(l.length)})`).join(" und ")}`;
  add("dark", <div className="st-kicker">Einsätze</div>, <div className="st-hero"><Count to={rows.length} /></div>,
    // No average while the website hasn't reached the year yet (hand entries only, e.g. on 01.01.)
    info.cut && <div className="st-text">{`Im Schnitt ${(covered.length / weeks).toFixed(1).replace(".", ",")} pro Woche.`}</div>,
    big.length > 0 && <div className="st-small">{`${storm ? "Mitgezählt" : "Nicht mitgezählt"}: ${bigText}.`}</div>);

  const [bd, bl] = topCounts(rows, (r) => r.date, 1)[0];
  const [ev, evl] = topCounts(bl, (r) => r.event, 1)[0];
  const silvester = bd.slice(5) === "01-01" ? bl.filter((r) => !r.timeUnknown && r.hour < DAY_START).length : 0;
  add("amber", <div className="st-kicker">Der stärkste Tag</div>, <div className="st-date">{`${WEEKDAYS_LONG[weekday(parseDate(bd))]}, ${fmtDate(bd)}`}</div>,
    <div className="st-hero"><Count to={bl.length} /></div>,
    <div className="st-text">{`Einsätze an einem Tag${silvester === bl.length ? ", alle in der Silvesternacht" : silvester ? `, ${silvester} davon in der Silvesternacht` : ""}.`}</div>,
    evl.length > 1 && <div className="st-small">{`Am häufigsten: „${ev}“ (`}<Times>{evl.length}</Times>)</div>);

  // Placeholder times (bulk-entered Großlagen) say nothing about the hour.
  const known = rows.filter((r) => !r.timeUnknown);
  const nightShare = known.length ? pct(known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length, known.length) : null;
  if (known.length) {
    const hours = Array(24).fill(0);
    for (const r of known) hours[r.hour]++;
    const top = Math.max(...hours), h = hours.indexOf(top);
    const same = hours.map((n, k) => (n === top && k !== h ? `${k}–${k + 1} Uhr` : "")).filter(Boolean);
    const word = h === 0 ? "Mitternacht" : `${h} Uhr`;
    add("navy", <div className="st-kicker">Die häufigste Uhrzeit</div>, <div className="st-hero" style={fit(word)}>{word}</div>,
      <div className="st-text">{`Zwischen ${h} und ${h + 1} Uhr wurde am häufigsten alarmiert: `}<Times>{top}</Times>.</div>,
      <div className="st-hours">
        <div className="bars">{hours.map((n, k) => <i key={k} className={k === h ? "hi" : ""} style={{ height: `${Math.max(2, (100 * n) / top)}%`, "--k": k }}></i>)}</div>
        <div className="ticks"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 Uhr</span></div>
      </div>,
      same.length > 0 && <div className="st-small">{`Genauso oft: ${same.join(", ")}.`}</div>);

    add("dark", <div className="st-kicker">Nachts</div>, <div className="st-hero" style={fit(`${nightShare} %`)}><Count to={nightShare} /> %</div>,
      <div className="st-text">der Einsätze kamen zwischen 22 und 6 Uhr, also in 8 von 24 Stunden.</div>,
      <div className="st-split"><i style={{ flexGrow: 100 - nightShare }}></i><i className="hi" style={{ flexGrow: nightShare }}></i></div>,
      <div className="st-legend"><span>{`Tag ${100 - nightShare} %`}</span><span>{`Nacht ${nightShare} %`}</span></div>);
  }

  const kws = topCounts(rows, (r) => r.base, 3);
  const [kb, kl] = kws[0];
  add("red", <div className="st-kicker">Das häufigste Stichwort</div>, <div className="st-hero" style={fit(kb, 30)}>{kb}</div>,
    <div className="st-text"><b>{kl[0].name}</b></div>,
    <div className="st-text"><Times><Count to={kl.length} /></Times>{`, das sind ${pct(kl.length, rows.length)} % aller Einsätze.`}</div>,
    kws.length > 1 && <div className="st-small">{`Danach: ${kws.slice(1).map(([k, l]) => `${k} ${l[0].name} (${l.length})`).join(", ")}`}</div>);

  // Top three places, plus anything tied with the third, at most five.
  const places = topCounts(rows.filter((r) => r.street), (r) => r.street, 999);
  if (places.length) {
    const third = places[Math.min(2, places.length - 1)][1].length;
    const tied = places.filter(([, l]) => l.length >= third);
    const shown = tied.slice(0, 5), more = tied.length - shown.length;
    const most = shown[0][1].length;
    add("navy", <div className="st-kicker">Die häufigsten Einsatzorte</div>,
      <ol className="st-rank">{shown.map(([st, l], k) => (
        <li key={st} style={{ "--k": k }}>
          <span>{st}<small>{topCounts(l, (r) => r.district, 1)[0][0].replace("unbekannt", "")}</small></span>
          <span className="n">{l.length}</span><i style={{ width: `${(100 * l.length) / most}%` }}></i>
        </li>
      ))}</ol>,
      more > 0 && <div className="st-small">{`Und ${more === 1 ? "ein weiterer Ort" : `${more} weitere`} mit ${more === 1 ? "" : "je "}${third} ${third === 1 ? "Einsatz" : "Einsätzen"}.`}</div>);
  }

  // Longest run of days without any alarm (Großlagen always count here: a storm day is never quiet),
  // only up to the website's newest entry.
  const busy = new Set(ALL.filter((r) => !r.standby).map((r) => r.date));
  const quiet = longestRun(busy, `${year}-01-01`, info.partial ? info.listed : `${year}-12-31`, false);
  if (quiet && quiet.len > 1) {
    add("amber", <div className="st-kicker">Die längste Pause</div>, <div className="st-hero"><Count to={quiet.len} /> <span className="st-unit">Tage</span></div>,
      <div className="st-text">{`ohne einen einzigen Einsatz, vom ${dm(quiet.from)} bis ${fmtDate(quiet.to)}.`}</div>);
  }

  if (info.delta !== null) {
    const prevYear = String(year - 1);
    const period = info.partial ? ` (jeweils bis ${dm(info.cutDate)})` : "";
    const withBig = storm && [...info.cmpRows, ...info.prevSame].some((r) => r.bigDay);
    const without = withBig ? yearInfo(year, false, ALL, LISTED).delta : null;
    const series = [
      { label: prevYear, values: runningTotal(info.prevSame, info.cut) },
      { label: year, sel: true, values: runningTotal(info.cmpRows, info.cut) },
    ];
    add("navy", <div className="st-kicker">{`Im Vergleich zu ${prevYear}`}</div>,
      <div className="st-hero" style={fit(`${signed(info.delta)} %`)}><Count to={info.delta} sign /> %</div>,
      <div className="st-text">{`${einsaetze(info.cmpRows.length)} im Jahr ${year}, ${info.prevSame.length} im Jahr ${prevYear}${period}.`}</div>,
      <Chart className="st-chart" draw={(box) => raceChart(box, series, { height: 180, hover: false })} />,
      without !== null && <div className="st-small">{`Ohne Großlagen: ${signed(without)} %`}</div>);
  }

  const facts = [
    ["Einsätze", rows.length],
    ["Nachts", nightShare === null ? "–" : `${nightShare} %`],
    ["Stärkster Tag", <>{dm(bd)}<small>{einsaetze(bl.length)}</small></>],
    ["Längste Pause", quiet && quiet.len > 1 ? `${quiet.len} Tage` : "–"],
    ["Häufigstes Stichwort", kb],
    ["Häufigster Ort", places.length ? places[0][0] : "–"],
  ];
  add("red", <div className="st-kicker">{`${year} in Zahlen`}</div>,
    <dl className="st-grid">{facts.map(([l, v]) => <div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>,
    <div className="st-actions">
      <button type="button" data-story="restart" onClick={() => storyShow(0)}>Von vorn</button>
      <button type="button" data-story="close" onClick={storyClose}>Schließen</button>
    </div>);

  const foot = [storm ? "" : "Ohne Großlagen", info.partial ? `Stand ${fmtDate(info.lastDate)}` : ""].filter(Boolean).join(" · ");
  return cards.map((c, i) => ({ ...c, head: i ? `FF Linden · Einsatzjahr ${year}` : "", foot }));
}

// The dialog. cards: the year's cards, i: the card shown, n: counts the cards shown, so a card shown again starts
// its animations again; open: false once closed, when the card is left empty.
function Story({ cards, i, n, open }) {
  const c = cards[i];
  // Tap the left third to go back, anywhere else to go on; or swipe.
  const down = useRef(null);
  const onPointerUp = (e) => {
    if (down.current === null || e.target.closest("button")) { down.current = null; return; }
    const dx = e.clientX - down.current, box = e.currentTarget.getBoundingClientRect();
    down.current = null;
    if (Math.abs(dx) > 40) storyShow(i + (dx < 0 ? 1 : -1));
    else storyShow(i + (e.clientX < box.left + box.width / 3 ? -1 : 1));
  };
  return (
    <div className="story-stage">
      <button type="button" className="story-nav prev" id="story-prev" aria-label="Zurück" disabled={!!c && i === 0} onClick={() => storyShow(i - 1)}>‹</button>
      <div className={c ? `story-frame st-${c.theme}` : "story-frame"} id="story-frame">
        <div className="story-bar" id="story-bar">{cards.map((_, k) => <i key={k} className={k < i ? "done" : k === i ? "now" : ""}></i>)}</div>
        <button type="button" className="story-close" id="story-close" aria-label="Schließen" onClick={storyClose}>×</button>
        <div className="story-card" id="story-card" aria-live="polite" onPointerDown={(e) => { down.current = e.clientX; }}
          onPointerUp={onPointerUp} onPointerCancel={() => { down.current = null; }}>
          {open && c && (
            <Fragment key={n}>
              <div className="st-head">{c.head}</div>
              <div className="st-body">{c.body.map((el, k) => cloneElement(el, { key: k, style: { ...el.props.style, "--i": k } }))}</div>
              <div className="st-foot">{c.foot}</div>
            </Fragment>
          )}
        </div>
      </div>
      <button type="button" className="story-nav next" id="story-next" aria-label="Weiter" disabled={!!c && i === cards.length - 1} onClick={() => storyShow(i + 1)}>›</button>
    </div>
  );
}

const story = { cards: [], i: 0, n: 0, open: false };
const draw = () => show($("#story"), Story, { ...story });
draw();

function storyShow(i) {
  story.i = Math.max(0, Math.min(story.cards.length - 1, i));
  story.n++;
  draw();
}

// year: "2026"; storm: whether the Großlagen count.
export function storyOpen(year, storm) {
  const cards = storyCards(year, storm);
  if (!cards.length) return;
  Object.assign(story, { cards, open: true });
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
  story.open = false;
  draw();
  $("#y-story").focus();
}
const storyClose = () => (history.state?.story ? history.back() : storyHide());

window.addEventListener("popstate", () => { if (!$("#story").hidden) storyHide(); });
document.addEventListener("keydown", (e) => {
  if ($("#story").hidden) return;
  if (e.key === "Escape") storyClose();
  else if (e.key === "ArrowRight" || (e.key === " " && !e.target.closest("button"))) { e.preventDefault(); storyShow(story.i + 1); }
  else if (e.key === "ArrowLeft") storyShow(story.i - 1);
});
