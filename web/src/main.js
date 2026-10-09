// Starts the page: loads the data, fills in the header and the year lists, wires up the tab bar and the filters,
// and draws the tabs, again whenever a filter, the tab or the window's width changes. Each tab's code is in
// views/<tab>/.

import { parseDate, fmtDate } from "./lib/dates.js";
import { $ } from "./dom.js";
import { ALL, LISTED, listBehind, selection, loadData } from "./data.js";
import "./components/tooltip.js"; // the box that follows the pointer over charts and maps sets itself up
import "./components/warnings.js"; // the warnings box loads and refreshes itself
import { show } from "./show.js"; // before the tabs, so React's file stays the same as more tabs use React (browsers keep it)
import { renderOverview } from "./views/overview/overview.js";
import { renderDots } from "./views/dots/dots.js";
import { renderCalendar } from "./views/calendar/calendar.js";
import { renderSpiral } from "./views/spiral/spiral.js";
import { renderHours } from "./views/hours/hours.js";
import Keywords from "./views/keywords/Keywords.jsx";
import Districts from "./views/districts/Districts.jsx";
import Addresses from "./views/addresses/Addresses.jsx";
import { renderWeather } from "./views/weather/weather.js";
import { renderMyths } from "./views/myths/myths.js";
import { renderChance, drawOutlook } from "./views/chance/chance.js";
import { renderYear } from "./views/year/year.js";
import { renderMap } from "./views/map/map.js";
import { renderRadius } from "./views/radius/radius.js";
import { quiz, quizShow } from "./views/quiz/quiz.js";
import AlarmList from "./views/list/AlarmList.jsx";

function render() {
  const rows = selection();
  renderOverview(rows);
  renderCalendar(rows);
  renderSpiral(rows);
  renderDots(rows);
  renderHours(rows);
  show($("section[data-view=keywords]"), Keywords, { rows }); // in React: views/keywords/Keywords.jsx
  show($("section[data-view=districts]"), Districts, { rows }); // in React: views/districts/Districts.jsx
  show($("section[data-view=addresses]"), Addresses, { rows }); // in React: views/addresses/Addresses.jsx
  show($("section[data-view=list]"), AlarmList, { rows }); // in React: views/list/AlarmList.jsx
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
  if (ALL.length) render(); // hidden sections have no width, so draw charts once visible
}

// The admin link only shows in a browser that is signed in on the admin page (same site, so the
// saved key is visible here). Everyone else never sees it.
try { $("#admin-link").hidden = !localStorage.getItem("gh-token"); } catch {}

loadData()
  .then((loaded) => {
    if (!loaded) {
      $("#updated").textContent = "–";
      $("#listed").textContent = " · Die Einsätze konnten nicht geladen werden. Bitte die Seite neu laden.";
      return;
    }
    $("#updated").textContent = new Date(loaded.updated).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    if (listBehind()) {
      const byHand = ALL.some((r) => r.manual && parseDate(r.date) > LISTED);
      $("#listed").textContent = ` · Die Website listet Einsätze bis ${fmtDate(loaded.newest)}${byHand ? ", neuere sind vorläufig eingetragen" : ""}.`;
    }
    const years = [...new Set(ALL.map((r) => r.date.slice(0, 4)))].sort().reverse();
    $("#f-year").innerHTML += years.map((y) => `<option>${y}</option>`).join("");
    $("#y-year").innerHTML = years.map((y) => `<option>${y}</option>`).join("");
    $("#y-year").addEventListener("change", renderYear);
    $("#y-storm").addEventListener("change", renderYear);
    $("#y-print").addEventListener("click", () => window.print());
    document.querySelectorAll("#filters input, #filters select").forEach((el) => el.addEventListener("change", render));
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
