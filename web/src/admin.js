// Saves manual alarms into web/public/data/manual.json. The page runs on its own address, a Cloudflare Worker
// (admin/worker.js) behind Cloudflare Access: Access asks for the login before the page loads, and the Worker
// does the saving with a GitHub key that never reaches the browser.
import { fmtDate } from "./lib/dates.js";
import { esc } from "./lib/text.js";
import { tidyStreet, stamp, sameAlarm, matchedManual } from "./lib/alarms.js";
import { SITE, ADMIN } from "./lib/links.js";

const $ = (s) => document.querySelector(s);

// The old admin page lived on the public site and kept a GitHub key in the browser. That copy now only sends
// people here, and forgets the key on the way.
const moved = location.origin + location.pathname === new URL("admin.html", SITE).href;
if (moved) {
  try { localStorage.removeItem("gh-token"); } catch {}
  location.replace(ADMIN);
}

// ---------- The Worker ----------
async function api(opts = {}) {
  let res;
  try {
    // Once the login has run out, Access answers with a redirect to its login page; "manual" keeps it
    // from being followed, so the page can say what happened.
    res = await fetch("/api/manual", { cache: "no-store", redirect: "manual", ...opts, headers: { "content-type": "application/json" } });
  } catch {
    // A save may have gone through even though the answer never arrived.
    const hint = opts.method ? " Bitte die Seite neu laden und nachsehen, ob die Änderung schon da ist." : "";
    throw new Error("Keine Verbindung zum Server." + hint);
  }
  if (res.type === "opaqueredirect" || res.status === 401) throw expired();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return body;
}

function expired() {
  const err = new Error("Die Anmeldung ist abgelaufen.");
  err.status = 401;
  return err;
}

async function readManual() {
  const { sha, rows, user } = await api();
  if (user) $("#user").textContent = user;
  return { sha, rows };
}

// Read-modify-write; if someone (or the daily job) committed in between, GitHub rejects the stale
// version with 409 and we retry on the fresh file.
async function updateManual(change, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, rows } = await readManual();
    const next = change(rows).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    if (JSON.stringify(next) === JSON.stringify(rows)) return next; // e.g. entry already deleted: no empty commit
    try {
      await api({ method: "PUT", body: JSON.stringify({ sha, rows: next, message }) });
      return next;
    } catch (e) {
      if (e.status !== 409) throw e;
      if (attempt === 2) throw new Error("Die Liste wurde gerade woanders geändert. Bitte die Seite neu laden und noch einmal versuchen.");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ---------- UI ----------

// When the login has run out or the account isn't allowed, the form goes away and a message says what to do.
function stop(err) {
  $("#editor").classList.remove("active");
  $("#stopped").classList.add("active");
  $("#stopped-msg").textContent = err.status === 401
    ? "Die Anmeldung ist abgelaufen. Bitte die Seite neu laden und wieder anmelden."
    : "Dieses Konto darf keine Einsätze nachtragen. Bitte abmelden und mit einem anderen Konto anmelden.";
}

let scraped = [];

async function loadEditor() {
  const now = new Date();
  const form = $("#f-alarm");
  if (!form.date.value) {
    form.date.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    form.time.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  const [kw, alarms] = await Promise.all([
    // The website's list and the keywords come from the public site, which always has the newest.
    fetch(new URL("data/keywords.json", SITE), { cache: "no-cache" }).then((r) => r.json()).catch(() => ({ codes: {} })),
    fetch(new URL("data/alarms.json", SITE), { cache: "no-cache" }).then((r) => r.json()).catch(() => ({ rows: [] })),
  ]);
  scraped = alarms.rows;
  $("#kw-list").innerHTML = Object.entries(kw.codes).map(([c, i]) => `<option value="${esc(c)}">${esc(i.name)}</option>`).join("");
  const districts = [...new Set(scraped.map((r) => r.district).filter(Boolean))].sort();
  $("#district-list").innerHTML = districts.map((d) => `<option value="${esc(d)}">`).join("");
  // Suggest the website's spellings; crossings ("NieschlagS/WittekindS") aren't useful as suggestions.
  const streets = [...new Set(scraped.map((r) => tidyStreet(r.street)).filter((s) => s && !s.includes("/")))].sort();
  $("#street-list").innerHTML = streets.map((s) => `<option value="${esc(s)}">`).join("");
  try {
    renderManual((await readManual()).rows);
  } catch (err) {
    if (err.status === 401 || err.status === 403) { stop(err); return; }
    $("#save-msg").textContent = `Konnte die Liste nicht laden: ${err.message}`;
  }
}

// One hand entry, all fields equal (two identical entries are still two, and each button acts on one)
const FIELDS = ["date", "time", "keyword", "event", "street", "district", "remarks"];
const sameEntry = (a, b) => FIELDS.every((k) => (a[k] || "") === (b[k] || ""));
const manualRows = () => JSON.parse($("#t-manual").dataset.rows || "[]");

let editing = null; // the hand entry being changed, or null when adding

function setEditing(row) {
  editing = row;
  const f = $("#f-alarm");
  $("#save").textContent = row ? "Änderung speichern" : "Speichern";
  $("#cancel-edit").hidden = !row;
  if (row) {
    for (const k of ["date", "time", "keyword", "event", "street", "district", "remarks"]) f[k].value = row[k] || "";
    $("#save-msg").textContent = `Eintrag vom ${fmtDate(row.date)} ${row.time} wird bearbeitet.`;
    f.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function clearForm() {
  for (const k of ["keyword", "event", "street", "district", "remarks"]) $("#f-alarm")[k].value = "";
}

function renderManual(rows) {
  const matched = matchedManual(scraped, rows);
  // The website lists alarms in order, so once it shows a later one, this one should be there too.
  // If it isn't, the website probably wrote it with another keyword or time and it would count twice.
  const newest = Math.max(0, ...scraped.filter((r) => r.category === "Einsatz").map(stamp).filter(Number.isFinite));
  const toCheck = (m) => !matched.has(m) && stamp(m) < newest;
  $("#t-manual tbody").innerHTML = rows.map((r, i) => `<tr>
    <td>${esc(fmtDate(r.date))}</td><td>${esc(r.time)}</td><td>${esc(r.keyword)}</td><td>${esc(r.event)}</td>
    <td>${esc(r.street)}, ${esc(r.district)}</td>
    <td>${matched.has(r) ? "auf der Website" : toCheck(r) ? '<span class="tag">bitte prüfen</span>' : "nur hier"}</td>
    <td class="actions"><button type="button" class="link" data-edit="${i}">Bearbeiten</button>
      <button type="button" class="link" data-del="${i}">Löschen</button></td></tr>`).join("")
    || `<tr><td colspan="7">Noch keine.</td></tr>`;
  $("#t-manual").dataset.rows = JSON.stringify(rows);
  $("#check-note").hidden = !rows.some(toCheck);
}

$("#t-manual").addEventListener("click", async (e) => {
  const { edit, del } = e.target.dataset;
  if (edit !== undefined) { setEditing(manualRows()[edit]); return; }
  if (del === undefined) return;
  const row = manualRows()[del];
  if (!confirm(`Eintrag vom ${fmtDate(row.date)} ${row.time} (${row.event}) löschen?`)) return;
  try {
    const drop = (rows) => { const i = rows.findIndex((r) => sameEntry(r, row)); return i < 0 ? rows : rows.filter((_, j) => j !== i); };
    renderManual(await updateManual(drop, `Nachtrag gelöscht: ${row.date} ${row.keyword}`));
    if (editing && sameEntry(editing, row)) { setEditing(null); clearForm(); }
    $("#save-msg").textContent = "Gelöscht.";
  } catch (err) {
    if (err.status === 401 || err.status === 403) { stop(err); return; }
    $("#save-msg").textContent = `Löschen fehlgeschlagen: ${err.message}`;
  }
});

$("#cancel-edit").addEventListener("click", () => {
  setEditing(null);
  clearForm();
  $("#save-msg").textContent = "";
});

// Before saving: is this alarm probably already there, on the website or among the hand entries?
function confirmNoDouble(row) {
  const others = manualRows();
  const self = editing ? others.findIndex((r) => sameEntry(r, editing)) : -1;
  if (self >= 0) others.splice(self, 1);
  const hit = scraped.find((r) => r.category === "Einsatz" && sameAlarm(r, row)) || others.find((r) => sameAlarm(r, row));
  if (!hit) return true;
  const where = others.includes(hit) ? "hier schon nachgetragen" : "schon auf der Website";
  return confirm(`Möglicher Doppeleintrag: ${hit.keyword} am ${fmtDate(hit.date)} um ${hit.time} ` +
    `(${hit.event}, ${hit.street}) ist ${where}.\n\nTrotzdem speichern?`);
}

$("#f-alarm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const row = {
    date: f.date.value, time: f.time.value, category: "Einsatz",
    keyword: f.keyword.value.trim(), event: f.event.value.trim(),
    street: tidyStreet(f.street.value.trim()), district: f.district.value.trim(), remarks: f.remarks.value.trim(),
  };
  const future = stamp(row) > Date.now() + 10 * 60 * 1000;
  if ((future && !confirm(`${fmtDate(row.date)} ${row.time} liegt in der Zukunft. Trotzdem speichern?`)) || !confirmNoDouble(row)) {
    $("#save-msg").textContent = "Nicht gespeichert.";
    return;
  }
  const old = editing;
  $("#save").disabled = true;
  $("#save-msg").textContent = "Speichere …";
  try {
    // Editing replaces the old entry in the same commit; if it was deleted meanwhile, the new one is added.
    const change = old
      ? (rows) => { const i = rows.findIndex((r) => sameEntry(r, old)); return i < 0 ? [...rows, row] : rows.map((r, j) => (j === i ? row : r)); }
      : (rows) => [...rows, row];
    const message = old ? `Nachtrag geändert: ${row.date} ${row.time} ${row.keyword}` : `Einsatz nachgetragen: ${row.date} ${row.time} ${row.keyword}`;
    renderManual(await updateManual(change, message));
    $("#save-msg").textContent = `${old ? "Geändert" : "Gespeichert"}. Die Statistik zeigt das nach etwa einer Minute.`;
    setEditing(null);
    clearForm();
  } catch (err) {
    if (err.status === 401 || err.status === 403) { stop(err); return; }
    $("#save-msg").textContent = `Speichern fehlgeschlagen: ${err.message}`;
  } finally {
    $("#save").disabled = false;
  }
});

if (!moved) loadEditor();
