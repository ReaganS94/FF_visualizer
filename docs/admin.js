"use strict";

// Saves manual alarms into docs/data/manual.json through the GitHub API. The token only lives in
// this browser's localStorage; the site itself has no server.
const REPO = "ReaganS94/FF_visualizer";
const FILE = "docs/data/manual.json";
const API = `https://api.github.com/repos/${REPO}`;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (iso) => iso.split("-").reverse().join(".");
// Same as the statistics page: "Strasse" and "Str." become "Straße", the website's spelling.
const tidyStreet = (s) => (s || "")
  .replace(/strasse/g, "straße").replace(/Strasse/g, "Straße")
  .replace(/(^|[\s-])Str\.?(?=$|[\s/])/g, "$1Straße")
  .replace(/([a-zäöüß])str\.?(?=$|[\s/])/g, "$1straße");

let token = "";
try { token = localStorage.getItem("gh-token") || ""; } catch {}

// ---------- GitHub API ----------
async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // A token without "Contents: Read and write" still logs in (the repo is readable) but can't save.
    const hint = res.status === 403 ? " Der Schlüssel braucht die Berechtigung „Contents: Read and write“." : "";
    const err = new Error((body.message || res.statusText) + hint);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// base64 <-> UTF-8 text (atob/btoa alone break umlauts)
const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
function encode(text) {
  let bin = "";
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

// GitHub lets browsers keep this answer for a minute. Without "no-store" a second change within that
// minute starts from the old list and GitHub rejects it ("does not match <sha>").
async function readManual() {
  const file = await gh(`/contents/${FILE}?ref=main`, { cache: "no-store" });
  return { sha: file.sha, rows: JSON.parse(decode(file.content)).rows };
}

// Read-modify-write; if someone (or the daily job) committed in between, GitHub rejects the stale
// sha with 409 and we retry on the fresh file.
async function updateManual(change, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, rows } = await readManual();
    const next = change(rows).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    if (JSON.stringify(next) === JSON.stringify(rows)) return next; // e.g. entry already deleted: no empty commit
    try {
      await gh(`/contents/${FILE}`, {
        method: "PUT",
        body: JSON.stringify({ message, sha, branch: "main", content: encode(JSON.stringify({ rows: next }, null, 1) + "\n") }),
      });
      return next;
    } catch (e) {
      if (e.status !== 409) throw e;
      if (attempt === 2) throw new Error("Die Liste wurde gerade woanders geändert. Bitte die Seite neu laden und noch einmal versuchen.");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ---------- UI ----------
function show() {
  $("#login").classList.toggle("active", !token);
  $("#editor").classList.toggle("active", !!token);
  if (token) loadEditor();
}

$("#f-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  token = $("#token").value.trim();
  $("#login-msg").textContent = "Prüfe Schlüssel …";
  try {
    const repo = await gh("");
    if (!repo.permissions?.push) throw new Error("Der Schlüssel darf nicht auf das Repository schreiben.");
    try { localStorage.setItem("gh-token", token); } catch {}
    $("#login-msg").textContent = "";
    show();
  } catch (err) {
    token = "";
    $("#login-msg").textContent = `Anmeldung fehlgeschlagen: ${err.message}`;
  }
});

$("#logout").addEventListener("click", () => {
  try { localStorage.removeItem("gh-token"); } catch {}
  token = "";
  show();
});

let scraped = [];

async function loadEditor() {
  const now = new Date();
  const form = $("#f-alarm");
  if (!form.date.value) {
    form.date.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    form.time.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  const [kw, alarms] = await Promise.all([
    fetch("data/keywords.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({ codes: {} })),
    fetch("data/alarms.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({ rows: [] })),
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
    $("#save-msg").textContent = `Konnte die Liste nicht laden: ${err.message}`;
    if (err.status === 401) { token = ""; show(); }
  }
}

// Same rule as the statistics page: the website's entry replaces ours once it appears. It also
// flags a probable double entry before saving.
function sameAlarm(a, b) {
  const at = (r) => new Date(`${r.date}T${r.time}`).getTime();
  const base = (k) => k.split("/")[0].trim().toLowerCase();
  return base(a.keyword) === base(b.keyword) && Math.abs(at(a) - at(b)) <= 60 * 60 * 1000;
}
const onWebsite = (m) => scraped.some((r) => sameAlarm(r, m));
// One hand entry, identified by the fields a person would notice
const sameEntry = (a, b) => a.date === b.date && a.time === b.time && a.keyword === b.keyword && a.street === b.street;
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
  $("#t-manual tbody").innerHTML = rows.map((r, i) => `<tr>
    <td>${fmtDate(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.keyword)}</td><td>${esc(r.event)}</td>
    <td>${esc(r.street)}, ${esc(r.district)}</td>
    <td>${onWebsite(r) ? "auf der Website" : "nur hier"}</td>
    <td class="actions"><button type="button" class="link" data-edit="${i}">Bearbeiten</button>
      <button type="button" class="link" data-del="${i}">Löschen</button></td></tr>`).join("")
    || `<tr><td colspan="7">Noch keine.</td></tr>`;
  $("#t-manual").dataset.rows = JSON.stringify(rows);
}

$("#t-manual").addEventListener("click", async (e) => {
  const { edit, del } = e.target.dataset;
  if (edit !== undefined) { setEditing(manualRows()[edit]); return; }
  if (del === undefined) return;
  const row = manualRows()[del];
  if (!confirm(`Eintrag vom ${fmtDate(row.date)} ${row.time} (${row.event}) löschen?`)) return;
  try {
    renderManual(await updateManual((rows) => rows.filter((r) => !sameEntry(r, row)), `Nachtrag gelöscht: ${row.date} ${row.keyword}`));
    if (editing && sameEntry(editing, row)) { setEditing(null); clearForm(); }
    $("#save-msg").textContent = "Gelöscht.";
  } catch (err) {
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
  const others = manualRows().filter((r) => !(editing && sameEntry(r, editing)));
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
  if (!confirmNoDouble(row)) { $("#save-msg").textContent = "Nicht gespeichert."; return; }
  const old = editing;
  $("#save").disabled = true;
  $("#save-msg").textContent = "Speichere …";
  try {
    // Editing replaces the old entry in the same commit; if it was deleted meanwhile, the new one is added.
    const change = old
      ? (rows) => (rows.some((r) => sameEntry(r, old)) ? rows.map((r) => (sameEntry(r, old) ? row : r)) : [...rows, row])
      : (rows) => [...rows, row];
    const message = old ? `Nachtrag geändert: ${row.date} ${row.time} ${row.keyword}` : `Einsatz nachgetragen: ${row.date} ${row.time} ${row.keyword}`;
    renderManual(await updateManual(change, message));
    $("#save-msg").textContent = `${old ? "Geändert" : "Gespeichert"}. Die Statistik zeigt das nach etwa einer Minute.`;
    setEditing(null);
    clearForm();
  } catch (err) {
    $("#save-msg").textContent = `Speichern fehlgeschlagen: ${err.message}`;
  } finally {
    $("#save").disabled = false;
  }
});

show();
