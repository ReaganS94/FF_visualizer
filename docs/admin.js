"use strict";

// Saves manual alarms into docs/data/manual.json through the GitHub API. The token only lives in
// this browser's localStorage; the site itself has no server.
const REPO = "ReaganS94/FF_visualizer";
const FILE = "docs/data/manual.json";
const API = `https://api.github.com/repos/${REPO}`;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (iso) => iso.split("-").reverse().join(".");

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
    const err = new Error(body.message || res.statusText);
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

async function readManual() {
  const file = await gh(`/contents/${FILE}?ref=main`);
  return { sha: file.sha, rows: JSON.parse(decode(file.content)).rows };
}

// Read-modify-write; if someone (or the daily job) committed in between, GitHub rejects the stale
// sha with 409 and we retry on the fresh file.
async function updateManual(change, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, rows } = await readManual();
    const next = change(rows).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    try {
      await gh(`/contents/${FILE}`, {
        method: "PUT",
        body: JSON.stringify({ message, sha, branch: "main", content: encode(JSON.stringify({ rows: next }, null, 1) + "\n") }),
      });
      return next;
    } catch (e) {
      if (e.status !== 409 || attempt === 2) throw e;
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
    fetch("data/keywords.json").then((r) => r.json()).catch(() => ({ codes: {} })),
    fetch("data/alarms.json").then((r) => r.json()).catch(() => ({ rows: [] })),
  ]);
  scraped = alarms.rows;
  $("#kw-list").innerHTML = Object.entries(kw.codes).map(([c, i]) => `<option value="${esc(c)}">${esc(i.name)}</option>`).join("");
  const districts = [...new Set(scraped.map((r) => r.district).filter(Boolean))].sort();
  $("#district-list").innerHTML = districts.map((d) => `<option value="${esc(d)}">`).join("");
  try {
    renderManual((await readManual()).rows);
  } catch (err) {
    $("#save-msg").textContent = `Konnte die Liste nicht laden: ${err.message}`;
    if (err.status === 401) { token = ""; show(); }
  }
}

// Same rule as the statistics page: the website's entry replaces ours once it appears.
function onWebsite(m) {
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const base = (k) => k.split("/")[0].trim().toLowerCase();
  return scraped.some((r) => r.date === m.date && base(r.keyword) === base(m.keyword) && Math.abs(minutes(r.time) - minutes(m.time)) <= 60);
}

function renderManual(rows) {
  $("#t-manual tbody").innerHTML = rows.map((r, i) => `<tr>
    <td>${fmtDate(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.keyword)}</td><td>${esc(r.event)}</td>
    <td>${esc(r.street)}, ${esc(r.district)}</td>
    <td>${onWebsite(r) ? "auf der Website" : "nur hier"}</td>
    <td><button type="button" class="link" data-del="${i}">Löschen</button></td></tr>`).join("")
    || `<tr><td colspan="7">Noch keine.</td></tr>`;
  $("#t-manual").dataset.rows = JSON.stringify(rows);
}

$("#t-manual").addEventListener("click", async (e) => {
  const i = e.target.dataset.del;
  if (i === undefined) return;
  const row = JSON.parse($("#t-manual").dataset.rows)[i];
  if (!confirm(`Eintrag vom ${fmtDate(row.date)} ${row.time} (${row.event}) löschen?`)) return;
  const same = (r) => r.date === row.date && r.time === row.time && r.keyword === row.keyword && r.street === row.street;
  try {
    renderManual(await updateManual((rows) => rows.filter((r) => !same(r)), `Nachtrag gelöscht: ${row.date} ${row.keyword}`));
    $("#save-msg").textContent = "Gelöscht.";
  } catch (err) {
    $("#save-msg").textContent = `Löschen fehlgeschlagen: ${err.message}`;
  }
});

$("#f-alarm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const row = {
    date: f.date.value, time: f.time.value, category: "Einsatz",
    keyword: f.keyword.value.trim(), event: f.event.value.trim(),
    street: f.street.value.trim(), district: f.district.value.trim(), remarks: f.remarks.value.trim(),
  };
  $("#save").disabled = true;
  $("#save-msg").textContent = "Speichere …";
  try {
    renderManual(await updateManual((rows) => [...rows, row], `Einsatz nachgetragen: ${row.date} ${row.time} ${row.keyword}`));
    $("#save-msg").textContent = "Gespeichert. Die Statistik zeigt ihn nach etwa einer Minute.";
    for (const k of ["keyword", "event", "street", "district", "remarks"]) f[k].value = "";
  } catch (err) {
    $("#save-msg").textContent = `Speichern fehlgeschlagen: ${err.message}`;
  } finally {
    $("#save").disabled = false;
  }
});

show();
