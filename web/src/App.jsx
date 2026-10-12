// The page: the warnings at the very top, the header with the data's date, the tab bar, the filters and the tabs.
// main.js loads the data and draws this; status says how that went. Each tab's code is in views/<tab>/. The tabs
// are drawn again whenever a filter, the tab or the window's width changes (charts measure their box, and a hidden
// tab has no width).
import { memo, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { parseDate, fmtDate } from "./lib/dates.js";
import { ALL, LISTED, listBehind, selection } from "./data.js";
import Warnings from "./components/Warnings.jsx";
import AppOffer from "./views/overview/AppOffer.jsx";
import Overview from "./views/overview/Overview.jsx";
import Dots from "./views/dots/Dots.jsx";
import Calendar from "./views/calendar/Calendar.jsx";
import Spiral from "./views/spiral/Spiral.jsx";
import Hours from "./views/hours/Hours.jsx";
import Keywords from "./views/keywords/Keywords.jsx";
import Districts from "./views/districts/Districts.jsx";
import Addresses from "./views/addresses/Addresses.jsx";
import Weather from "./views/weather/Weather.jsx";
import Myths from "./views/myths/Myths.jsx";
import Chance from "./views/chance/Chance.jsx";
import YearReview from "./views/year/YearReview.jsx";
import AlarmMap from "./views/map/AlarmMap.jsx";
import Radius from "./views/radius/Radius.jsx";
import Quiz from "./views/quiz/Quiz.jsx";
import AlarmList from "./views/list/AlarmList.jsx";

const TABS = [["overview", "Übersicht"], ["dots", "Punktewand"], ["calendar", "Kalender"], ["spiral", "Jahresspirale"], ["hours", "Tageszeit"],
  ["keywords", "Stichworte"], ["districts", "Stadtteile"], ["addresses", "Stammadressen"], ["map", "Karte"], ["radius", "Einsatzradius"],
  ["weather", "Wetter"], ["myths", "Mythen-Check"], ["quiz", "Quiz"], ["list", "Liste"], ["year", "Jahresrückblick"], ["chance", "Einsatz heute?"]];
const NO_FILTERS = ["chance", "year", "myths", "quiz"]; // tabs with choices of their own

// The Mythen-Check's tests take a while and give the same for every filter, so it is only worked out once opened
// and only drawn again while it shows.
const MythsWhileShown = memo(Myths, (before, now) => !now.shown);

// status: undefined while the data loads, null when the alarms couldn't be loaded, else {updated, newest}.
export default function App({ status }) {
  const [view, setView] = useState("overview");
  const [filters, setFilters] = useState({ year: "", standby: false, storm: true });
  const [, setDrawn] = useState(0); // counts the drawings asked for: a tab shown again or a new width draws everything again
  const [opened, setOpened] = useState({});
  const loaded = !!status;

  // Once the data is there, the tab shown last time.
  const [started, setStarted] = useState(false);
  if (loaded && !started) {
    setStarted(true);
    let v = "overview";
    try { v = localStorage.getItem("view") || v; } catch {}
    show(v);
  }
  function show(v) {
    setView(v);
    setDrawn((n) => n + 1);
    setOpened((o) => (o[v] ? o : { ...o, [v]: true }));
    try { localStorage.setItem("view", v); } catch {}
  }
  const set = (k, v) => flushSync(() => setFilters((f) => ({ ...f, [k]: v })));

  // Only a change of width needs new charts; height changes when a phone's toolbar hides.
  useEffect(() => {
    if (!loaded) return;
    let resize, width = innerWidth;
    const onResize = () => {
      if (innerWidth === width) return;
      width = innerWidth;
      clearTimeout(resize);
      resize = setTimeout(() => flushSync(() => setDrawn((n) => n + 1)), 150);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(resize); };
  }, [loaded]);

  const byHand = loaded && listBehind() && ALL.some((r) => r.manual && parseDate(r.date) > LISTED);
  const listed = status === null ? " · Die Einsätze konnten nicht geladen werden. Bitte die Seite neu laden."
    : loaded && listBehind() ? ` · Die Website listet Einsätze bis ${fmtDate(status.newest)}${byHand ? ", neuere sind vorläufig eingetragen" : ""}.` : "";
  const updated = status === undefined ? "…" : status === null ? "–"
    : new Date(status.updated).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const years = loaded ? [...new Set(ALL.map((r) => r.date.slice(0, 4)))].sort().reverse() : [];

  // a new list each time, as the tabs expect: the Karte and the Einsatzradius redraw their maps when it changes
  const rows = loaded ? selection(filters) : [];
  const { year, storm } = filters;
  const tab = (v, children) => <section data-view={v} className={view === v ? "active" : undefined} key={v}>{children}</section>;
  return (
    <>
      <Warnings place="top" />
      <header>
        <h1>FF Linden Einsatzstatistik</h1>
        <p className="sub">Daten aus der <a target="_blank" rel="noopener noreferrer" href="https://www.ff-linden.de/veranstaltungsliste/">Aktivitätenliste</a> · Stand <span id="updated">{updated}</span><span id="listed">{listed}</span></p>
      </header>

      <nav id="views" aria-label="Ansicht wählen">
        {TABS.map(([v, label]) => (
          <button key={v} data-view={v} className={view === v ? "active" : undefined} onClick={loaded ? () => flushSync(() => show(v)) : undefined}>{label}</button>
        ))}
      </nav>

      <div id="filters" style={NO_FILTERS.includes(view) ? { display: "none" } : undefined}>
        <label>Jahr <select id="f-year" onChange={(e) => set("year", e.target.value)}><option value="">Alle</option>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label><input type="checkbox" id="f-standby" onChange={(e) => set("standby", e.target.checked)} /> Wachbesetzungen (vs) mitzählen</label>
        <label><input type="checkbox" id="f-storm" defaultChecked onChange={(e) => set("storm", e.target.checked)} /> Großlagen mitzählen</label>
      </div>

      <main>
        {tab("overview", <>
          <Warnings place="box" />
          <AppOffer />
          {loaded && <Overview rows={rows} year={year} />}
        </>)}
        {tab("calendar", loaded && <Calendar rows={rows} storm={storm} />)}
        {tab("dots", loaded && <Dots rows={rows} />)}
        {tab("spiral", loaded && <Spiral rows={rows} storm={storm} />)}
        {tab("hours", loaded && <Hours rows={rows} />)}
        {tab("keywords", loaded && <Keywords rows={rows} />)}
        {tab("districts", loaded && <Districts rows={rows} />)}
        {tab("addresses", loaded && <Addresses rows={rows} />)}
        {tab("map", loaded && <AlarmMap rows={rows} />)}
        {tab("radius", loaded && <Radius rows={rows} />)}
        {tab("weather", loaded && <Weather rows={rows} year={year} storm={storm} />)}
        {tab("myths", loaded && opened.myths && <MythsWhileShown shown={view === "myths"} />)}
        {tab("quiz", loaded && <Quiz />)}
        {tab("list", loaded && <AlarmList rows={rows} />)}
        {tab("year", loaded && <YearReview />)}
        {tab("chance", loaded && <Chance />)}
      </main>
    </>
  );
}
