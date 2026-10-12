// Current official warnings, loaded in the browser when the page opens and every 5 minutes while it shows.
// Weather warnings of the Deutscher Wetterdienst for the city come through Bright Sky, which lets any
// website load them. NINA adds the other warnings for the Region Hannover (civil protection, floods,
// police). NINA doesn't let other websites load its list, so it comes through a small relay
// (relay/nina.js, a Cloudflare Worker). NINA's weather warnings are the same as the DWD's, so they are
// left out. Nothing is stored.
// As soon as one warning needs attention (weather from Stufe 2, or any other warning), all of them move to
// the very top of every tab. Otherwise they stay on Übersicht, with one quiet line when there are none.
// This file loads them and starts itself when the page loads; Warnings.jsx draws the two boxes from warnView().
import { WEEKDAYS, isoDate, weekday, fmtDate } from "../lib/dates.js";
import { WACHE } from "../lib/places.js";

const WARN_EVERY = 5 * 60 * 1000;
const warn = { at: 0, busy: false };
const NINA_RELAY = "https://ff-linden-nina.ff-statistik.workers.dev/"; // NINA's list for the Region Hannover
const WARN_LEVEL = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
const NINA_KIND = { MOWAS: "Bevölkerungsschutz", LHP: "Hochwasser", POLICE: "Polizei", KATWARN: "Katwarn", BIWAPP: "Biwapp" };
// How much a warning moves: 0 not at all, 1 shakes once, 2 pulses. Weather warnings: Stufe 1 not at all,
// Stufe 2 shakes, Stufe 3 and 4 pulse. The other warnings (a big fire, an evacuation, a flood) always pulse.
const warnMove = (level, weather) => (weather && level < 3 ? level - 1 : 2);

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
  tell(warnItems(dwd && Array.isArray(dwd.alerts) ? dwd.alerts : null, Array.isArray(nina) ? nina : null));
}

// "heute 14:00 bis 20:00 Uhr", "bis morgen 06:00 Uhr", "ab Fr 09.10. 18:00 Uhr"
export function warnSpan(onset, expires, now) {
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

// dwd, nina: the loaded lists, or null when they couldn't be loaded. What the boxes show: the warnings that
// still hold, most urgent first, whether each service could be loaded, and when.
function warnItems(dwd, nina) {
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
  return { items, dwd: !!dwd, nina: !!nina, now };
}

// The latest answer for Warnings.jsx, null until the first one; it reads it with useSyncExternalStore.
let view = null;
const listeners = new Set();
export const warnView = () => view;
export function warnSubscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function tell(next) { view = next; listeners.forEach((fn) => fn()); }

// When the page opens, every 5 minutes while it shows, and when it comes back after a while in the background.
const warnStale = () => Date.now() - warn.at > WARN_EVERY;
setInterval(() => { if (!document.hidden) loadWarnings(); }, WARN_EVERY);
document.addEventListener("visibilitychange", () => { if (!document.hidden && warnStale()) loadWarnings(); });
loadWarnings();
