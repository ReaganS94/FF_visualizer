// The admin page's own address, a Cloudflare Worker behind Cloudflare Access. Access asks everyone for a login
// before anything here runs, and only lets in the people its policy lists (that list is the list of admins).
// The Worker serves the admin page (built into dist/ like the rest of the site) and saves the hand entries
// in web/public/data/manual.json through the GitHub API, with a key that only the Worker knows. The browser
// never sees it. docs/admin.md says how to set it up.
//
// Settings (Worker → Settings → Variables and Secrets):
// - TEAM_DOMAIN: the Zero Trust team's address, like "ff-linden.cloudflareaccess.com"
// - ACCESS_AUD: the "Application Audience (AUD) Tag" of the Access application in front of this Worker
// - GITHUB_TOKEN (secret): a fine-grained token for this repository with "Contents: Read and write"

const REPO = "ReaganS94/FF_visualizer";
const FILE = "web/public/data/manual.json";
const FIELDS = ["date", "time", "category", "keyword", "event", "street", "district", "remarks"];

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // The page itself. Access already checked the visitor; the page has no secrets.
      if (url.pathname === "/") return Response.redirect(new URL("/admin.html", url), 302);
      return env.ASSETS.fetch(request);
    }
    // Every API call proves again that Access let this person in: a request that reaches the Worker some
    // other way (Access switched off by mistake, say) carries no valid token and gets nothing.
    const user = await accessUser(request, env);
    if (!user) return reply({ error: "Keine Berechtigung." }, 403);
    if (url.pathname !== "/api/manual") return reply({ error: "Not found" }, 404);
    if (request.method === "GET") return readManual(env, user);
    if (request.method === "PUT") return writeManual(request, env, user);
    return new Response(null, { status: 405, headers: { allow: "GET, PUT" } });
  },
};

// ---------- Access ----------

// The signed-in person's email, if the request carries a token that Access signed for this application and
// that hasn't run out; otherwise null. Access puts the token in a header, and in the CF_Authorization cookie
// of this address; either is checked the same way. A refusal is logged with its reason (never the token), so
// Worker → Observability shows what didn't match.
export async function accessUser(request, env) {
  const why = await check(request, env);
  if (typeof why === "object") return why.email;
  console.warn(`Access check failed: ${why}`);
  return null;
}

async function check(request, env) {
  // Settings pasted with a stray space or line break, or with https:// in front, still count.
  const team = (env.TEAM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const audTag = (env.ACCESS_AUD || "").trim();
  if (!team || !audTag) return "TEAM_DOMAIN or ACCESS_AUD is not set";
  const token = request.headers.get("cf-access-jwt-assertion") || cookie(request, "CF_Authorization");
  if (!token) return "no Access token in the request";
  const parts = token.split(".");
  if (parts.length !== 3) return "the token is not a JWT";
  let header, claims;
  try {
    header = JSON.parse(text(base64url(parts[0])));
    claims = JSON.parse(text(base64url(parts[1])));
  } catch { return "the token is not a JWT"; }
  if (header.alg !== "RS256") return `unexpected algorithm ${header.alg}`;
  const key = await signingKey(team, header.kid);
  if (!key) return `no public key ${header.kid} at https://${team}/cdn-cgi/access/certs: ${keysProblem}`;
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64url(parts[2]), signed))) return "bad signature";
  const now = Date.now() / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audTag)) return "the token is for another application (ACCESS_AUD doesn't match)";
  if (claims.iss !== `https://${team}`) return `the token comes from ${claims.iss}, not https://${team} (TEAM_DOMAIN)`;
  if (!(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return "the token has run out";
  if (typeof claims.email !== "string" || !claims.email) return "the token has no email";
  return { email: claims.email };
}

function cookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Access's public keys, fetched once an hour; it changes them every few weeks. `keysProblem` says why the
// last fetch gave no usable list, for the log.
let keys = { at: 0, team: "", list: [] };
let keysProblem = "";
async function signingKey(team, kid) {
  if (keys.team !== team || Date.now() - keys.at > 60 * 60 * 1000 || !keys.list.some((k) => k.kid === kid)) {
    let res;
    try { res = await fetch(`https://${team}/cdn-cgi/access/certs`, { headers: { accept: "application/json" } }); } catch (e) {
      keysProblem = `fetching the keys failed: ${e.message}`;
      return null;
    }
    if (!res.ok) { keysProblem = `fetching the keys answered ${res.status}`; return null; }
    let body;
    try { body = await res.json(); } catch { keysProblem = `the keys answer is not JSON (${res.headers.get("content-type")})`; return null; }
    keys = { at: Date.now(), team, list: Array.isArray(body.keys) ? body.keys : [] };
  }
  const jwk = keys.list.find((k) => k.kid === kid);
  if (!jwk) { keysProblem = `the keys list has ${keys.list.map((k) => k.kid).join(", ") || "no keys"}`; return null; }
  const { alg, use, key_ops, ...plain } = jwk; // only the key itself; the algorithm is fixed below
  return crypto.subtle.importKey("jwk", plain, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

export function resetKeys() { keys = { at: 0, team: "", list: [] }; keysProblem = ""; }

const base64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const text = (bytes) => new TextDecoder().decode(bytes);

// ---------- GitHub ----------

async function github(env, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json",
      "user-agent": "ff-linden-admin", "x-github-api-version": "2022-11-28",
    },
  });
}

// GitHub's own answer, as one German sentence the page can show.
async function failed(res) {
  if (res.status === 409) return reply({ error: "conflict" }, 409);
  const why = res.status === 401 || res.status === 403 || res.status === 404
    ? "Der GitHub-Schlüssel des Admin-Servers ist ungültig, abgelaufen oder darf nicht speichern."
    : `GitHub antwortet mit Fehler ${res.status}.`;
  return reply({ error: why }, 502);
}

async function readManual(env, user) {
  let res;
  try { res = await github(env, `/contents/${FILE}?ref=main`); } catch { return reply({ error: "Keine Verbindung zu GitHub." }, 502); }
  if (!res.ok) return failed(res);
  const file = await res.json();
  const rows = JSON.parse(text(base64url(file.content.replace(/\n/g, "")))).rows;
  return reply({ sha: file.sha, rows, user });
}

// Saves the whole list. `sha` is the version the page started from: if the file changed since, GitHub
// refuses and the page starts over from the new version (409).
async function writeManual(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return reply({ error: "Ungültige Anfrage." }, 400); }
  const { sha, rows, message } = body || {};
  if (typeof sha !== "string" || typeof message !== "string" || !message || message.length > 200 || !validRows(rows)) {
    return reply({ error: "Ungültige Anfrage." }, 400);
  }
  const content = JSON.stringify({ rows }, null, 1) + "\n";
  let res;
  try {
    res = await github(env, `/contents/${FILE}`, {
      method: "PUT",
      body: JSON.stringify({ message, sha, branch: "main", content: encode(content) }),
    });
  } catch { return reply({ error: "Keine Verbindung zu GitHub. Bitte die Seite neu laden und nachsehen, ob die Änderung schon da ist." }, 502); }
  if (!res.ok) return failed(res);
  return reply({ sha: (await res.json()).content.sha, user });
}

// The list as the page sends it: at most 5000 entries, each with only the known fields, all short text.
export function validRows(rows) {
  return Array.isArray(rows) && rows.length <= 5000 && rows.every((r) =>
    r && typeof r === "object" && !Array.isArray(r) &&
    Object.entries(r).every(([k, v]) => FIELDS.includes(k) && typeof v === "string" && v.length <= 500) &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{2}:\d{2}$/.test(r.time));
}

function encode(s) {
  let bin = "";
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
}
