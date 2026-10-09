// Current official warnings, loaded in the browser when the page opens and every 5 minutes while it shows.
// Weather warnings of the Deutscher Wetterdienst for the city come through Bright Sky, which lets any
// website load them. NINA adds the other warnings for the Region Hannover (civil protection, floods,
// police). NINA doesn't let other websites load its list, so it comes through a small relay
// (relay/nina.js, a Cloudflare Worker). NINA's weather warnings are the same as the DWD's, so they are
// left out. Nothing is stored.
// As soon as one warning needs attention (weather from Stufe 2, or any other warning), all of them move to
// the very top of every tab. Otherwise they stay on Übersicht, with one quiet line when there are none.
// The box starts itself: main.js only has to load this file.
import "./warnings.css";
import { WEEKDAYS, isoDate, weekday, fmtDate } from "../lib/dates.js";
import { esc } from "../lib/text.js";
import { WACHE } from "../lib/places.js";
import { $ } from "../dom.js";

const WARN_EVERY = 5 * 60 * 1000;
const warn = { at: 0, busy: false, drawn: {} };
const NINA_RELAY = "https://ff-linden-nina.ff-statistik.workers.dev/"; // NINA's list for the Region Hannover
const WARN_LEVEL = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
const NINA_KIND = { MOWAS: "Bevölkerungsschutz", LHP: "Hochwasser", POLICE: "Polizei", KATWARN: "Katwarn", BIWAPP: "Biwapp" };
// How much a warning moves: 0 not at all, 1 shakes once, 2 pulses. Weather warnings: Stufe 1 not at all,
// Stufe 2 shakes, Stufe 3 and 4 pulse. The other warnings (a big fire, an evacuation, a flood) always pulse.
const warnMove = (level, weather) => (weather && level < 3 ? level - 1 : 2);
const WARN_MOVE = ["", " shake", " pulse"];
const WARN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.6v.1"/></svg>';

function fetchJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  return fetch(url, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).finally(() => clearTimeout(t));
}

async function loadWarnings() {
  if (warn.busy) return;
  warn.busy = true;
  const [dwd, nina] = await Promise.all([
    fetchJSON(`https://api.brightsky.dev/alerts?lat=${WACHE[0]}&lon=${WACHE[1]}&tz=Europe/Berlin`).catch(() => null),
    fetchJSON(NINA_RELAY).catch(() => null),
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
    items.push({ level, move: warnMove(level, true), tag: `${a.category === "health" ? "Hitze" : "Wetter"} · Stufe ${level} von 4`,
      title: a.headline_de || a.event_de || "", onset: when(a.onset), expires, text: a.description_de, todo: a.instruction_de });
  }
  for (const w of nina || []) {
    // NINA's weather warnings only stand in when the DWD's own list couldn't be loaded.
    const d = (w.payload && w.payload.data) || {}, expires = when(w.expires);
    if ((dwd && d.provider === "DWD") || d.msgType === "Cancel" || (expires && expires <= now)) continue;
    const level = WARN_LEVEL[String(d.severity).toLowerCase()] || 1;
    const weather = d.provider === "DWD";
    items.push({ level, move: warnMove(level, weather), tag: weather ? `Wetter · Stufe ${level} von 4` : NINA_KIND[d.provider] || "Warnung",
      title: (w.i18nTitle && w.i18nTitle.de) || d.headline || "", onset: when(w.onset || w.effective || w.sent), expires, nina: true });
  }
  items.sort((a, b) => b.move - a.move || b.level - a.level || (a.onset || 0) - (b.onset || 0));

  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const dwdLink = (text) => link("https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html", text);
  const ninaLink = link("https://warnung.bund.de/meldungen", "NINA");
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const sources = (dwd && nina ? `Quellen: ${dwdLink("Deutscher Wetterdienst")} (Stadt Hannover) und Warn-App ${ninaLink} (Region Hannover).`
    : dwd ? `Quelle: ${dwdLink("Deutscher Wetterdienst")} (Stadt Hannover). Andere Warnungen, etwa zu Bränden mit starkem Rauch oder zu Evakuierungen, stehen in der Warn-App ${ninaLink}.`
    : nina ? `Quelle: Warn-App ${ninaLink} (Region Hannover), mit den Wetterwarnungen des ${dwdLink("Deutschen Wetterdienstes")}.`
    : `Die Warnungen konnten gerade nicht geladen werden. Sie stehen beim ${dwdLink("Deutschen Wetterdienst")} und in der Warn-App ${ninaLink}.`) +
    (dwd || nina ? ` Stand: ${hm} Uhr.` : "");
  // Only the first (loudest) warning moves, so several warnings don't turn into a light show.
  const cards = items.map((w, i) =>
    `<div class="warn l${w.level}${i ? "" : WARN_MOVE[w.move]}"><span class="warn-icon" aria-hidden="true">${WARN_ICON}</span><div class="warn-body">` +
    `<div class="warn-meta"><span class="warn-tag">${esc(w.tag)}</span><span>${warnSpan(w.onset, w.expires, now)}</span></div>` +
    `<div class="warn-title">${esc(w.title)}</div>` +
    (w.text ? `<p class="warn-text">${esc(w.text)}</p>` : "") +
    (w.todo ? `<details class="warn-todo"><summary>Was tun?</summary><p>${esc(w.todo)}</p></details>` : "") +
    (w.nina ? `<p class="warn-text">Mehr dazu in ${ninaLink}.</p>` : "") + `</div></div>`).join("");
  const calm = dwd || nina ? `<p class="warn-none"><span class="warn-ok" aria-hidden="true">✓</span>Für Hannover gibt es gerade keine ${nina ? "amtlichen Warnungen" : "Wetterwarnungen"}.</p>` : "";
  const top = items.some((w) => w.move);
  warnBox("warn-top", top ? cards : null, sources);
  warnBox("warnings", top ? null : cards || calm, sources);
}

// Fills a box, or hides it when body is null. Only redraws when the list changed, so an opened "Was tun?"
// stays open over the refresh and the first warning only moves again when something changed.
function warnBox(id, body, sources) {
  const el = $(`#${id}`);
  el.hidden = body === null;
  if (body !== warn.drawn[id]) {
    warn.drawn[id] = body;
    el.innerHTML = body === null ? "" : `${body}<p class="note"></p>`;
  }
  if (body !== null) el.lastElementChild.innerHTML = sources;
}

// When the page opens, every 5 minutes while it shows, and when it comes back after a while in the background.
const warnStale = () => Date.now() - warn.at > WARN_EVERY;
setInterval(() => { if (!document.hidden) loadWarnings(); }, WARN_EVERY);
document.addEventListener("visibilitychange", () => { if (!document.hidden && warnStale()) loadWarnings(); });
loadWarnings();
