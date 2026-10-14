// The admin Worker (admin/worker.js), run in Node. Cloudflare Access is played by a key pair made for each
// run (the test signs the login tokens), and GitHub by a made-up file API.
import { test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import worker, { resetKeys, validRows } from "../../admin/worker.js";

const TEAM = "ff-linden.cloudflareaccess.com";
const AUD = "aud-tag-of-the-admin-app";
const ENV = { TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, GITHUB_TOKEN: "secret-key", ASSETS: { fetch: async (r) => new Response(`file ${new URL(r.url).pathname}`) } };
const FILE = "https://api.github.com/repos/ReaganS94/FF_visualizer/contents/web/public/data/manual.json";
const ROW = { date: "2026-10-06", time: "19:30", category: "Einsatz", keyword: "hps1", event: "Person droht zu springen", street: "Ernst-August-Platz", district: "Mitte", remarks: "" };

let keys, other, github;

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
async function sign(claims, { key = keys.privateKey, kid = "k1", alg = "RS256" } = {}) {
  const head = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}
const now = () => Math.floor(Date.now() / 1000);
const login = (more = {}) => sign({ aud: [AUD], iss: `https://${TEAM}`, email: "reagan@example.com", exp: now() + 3600, iat: now(), ...more });

async function ask(path, { method = "GET", token, body, env = ENV } = {}) {
  const headers = token ? { "cf-access-jwt-assertion": token } : {};
  const req = new Request(`https://ff-linden-admin.example.workers.dev${path}`, { method, headers, body: body && JSON.stringify(body) });
  return worker.fetch(req, env);
}

beforeAll(async () => {
  const pair = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  keys = await pair();
  other = await pair();
});

beforeEach(async () => {
  resetKeys();
  const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
  github = { sha: "s1", rows: [ROW], puts: [], fail: null };
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (String(url).startsWith(FILE)) {
      expect(opts.headers.authorization).toBe("Bearer secret-key");
      if (github.fail) return new Response("{}", { status: github.fail });
      if (opts.method === "PUT") {
        const body = JSON.parse(opts.body);
        if (body.sha !== github.sha) return new Response("{}", { status: 409 });
        github.puts.push(body);
        github.rows = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")).rows;
        github.sha = `s${github.puts.length + 1}`;
        return Response.json({ content: { sha: github.sha } });
      }
      return Response.json({ sha: github.sha, content: Buffer.from(JSON.stringify({ rows: github.rows })).toString("base64") });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

test("reads the hand entries for a signed-in admin, with the umlauts intact", async () => {
  github.rows = [{ ...ROW, street: "Fössestraße" }];
  const res = await ask("/api/manual", { token: await login() });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ sha: "s1", rows: github.rows, user: "reagan@example.com" });
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("saves the list on main with the version it started from", async () => {
  const rows = [{ ...ROW, street: "Fössestraße" }, ROW];
  const res = await ask("/api/manual", { method: "PUT", token: await login(), body: { sha: "s1", rows, message: "Einsatz nachgetragen: x" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ sha: "s2", user: "reagan@example.com" });
  expect(github.puts[0]).toMatchObject({ message: "Einsatz nachgetragen: x", sha: "s1", branch: "main" });
  expect(github.rows).toEqual(rows);
  // the file keeps its layout: one space indent and a newline at the end
  expect(Buffer.from(github.puts[0].content, "base64").toString("utf8")).toBe(JSON.stringify({ rows }, null, 1) + "\n");
});

test("passes GitHub's 'changed meanwhile' on, so the page can start over", async () => {
  const res = await ask("/api/manual", { method: "PUT", token: await login(), body: { sha: "old", rows: [ROW], message: "m" } });
  expect(res.status).toBe(409);
  expect(github.puts).toEqual([]);
});

test("says when its own GitHub key doesn't work", async () => {
  github.fail = 401;
  const res = await ask("/api/manual", { token: await login() });
  expect(res.status).toBe(502);
  expect((await res.json()).error).toMatch(/GitHub-Schlüssel/);
});

test("refuses every request without a valid Access login, before asking GitHub", async () => {
  const cases = {
    none: undefined,
    garbage: "a.b.c",
    "other app": await login({ aud: ["another-app"] }),
    "other team": await login({ iss: "https://someone.cloudflareaccess.com" }),
    expired: await login({ exp: now() - 10 }),
    "not yet valid": await login({ nbf: now() + 600 }),
    "no email": await login({ email: undefined }),
    "signed by someone else": await login().then(() => sign({ aud: [AUD], iss: `https://${TEAM}`, email: "x@example.com", exp: now() + 3600 }, { key: other.privateKey })),
    "unknown key": await sign({ aud: [AUD], iss: `https://${TEAM}`, email: "x@example.com", exp: now() + 3600 }, { kid: "k2" }),
    "alg none": (await login()).replace(/^[^.]+/, b64url(JSON.stringify({ alg: "none", kid: "k1" }))),
  };
  for (const [name, token] of Object.entries(cases)) {
    for (const method of ["GET", "PUT"]) {
      const res = await ask("/api/manual", { method, token, body: method === "PUT" ? { sha: "s1", rows: [], message: "m" } : undefined });
      expect(res.status, `${name} ${method}`).toBe(403);
    }
  }
  expect(github.puts).toEqual([]);
  expect(fetch.mock.calls.filter(([url]) => String(url).startsWith(FILE))).toEqual([]);
});

test("refuses everything until the Access settings are made", async () => {
  const token = await login();
  for (const env of [{ ...ENV, ACCESS_AUD: undefined }, { ...ENV, TEAM_DOMAIN: "" }]) {
    expect((await ask("/api/manual", { token, env })).status).toBe(403);
  }
});

test("accepts only a well-formed list", async () => {
  const token = await login();
  for (const body of [
    { sha: "s1", rows: "x", message: "m" },
    { sha: "s1", rows: [{ ...ROW, extra: "x" }], message: "m" },
    { sha: "s1", rows: [{ ...ROW, date: "06.10.2026" }], message: "m" },
    { sha: "s1", rows: [ROW], message: "" },
    { rows: [ROW], message: "m" },
  ]) {
    expect((await ask("/api/manual", { method: "PUT", token, body })).status).toBe(400);
  }
  expect(github.puts).toEqual([]);
});

test("the hand entries saved today pass the check", async () => {
  const { readFileSync } = await import("node:fs");
  const saved = JSON.parse(readFileSync(new URL("../../web/public/data/manual.json", import.meta.url), "utf8"));
  expect(validRows(saved.rows)).toBe(true);
});

test("serves the admin page, from / too, and answers other API paths and methods with errors", async () => {
  expect(await (await ask("/admin.html")).text()).toBe("file /admin.html");
  const root = await ask("/");
  expect(root.status).toBe(302);
  expect(root.headers.get("location")).toBe("https://ff-linden-admin.example.workers.dev/admin.html");
  const token = await login();
  expect((await ask("/api/other", { token })).status).toBe(404);
  expect((await ask("/api/manual", { method: "DELETE", token })).status).toBe(405);
});

test("takes the token from Access's cookie too, and settings pasted with spaces, a line break or https://", async () => {
  const token = await login();
  const env = { ...ENV, TEAM_DOMAIN: ` https://${TEAM}/\n`, ACCESS_AUD: `${AUD}\n` };
  const req = new Request("https://ff-linden-admin.example.workers.dev/api/manual", { headers: { cookie: `other=1; CF_Authorization=${token}` } });
  const res = await worker.fetch(req, env);
  expect(res.status).toBe(200);
  expect((await res.json()).user).toBe("reagan@example.com");
});

test("logs why a login was refused, without the token", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const token = await login({ aud: ["another-app"] });
  await ask("/api/manual", { token });
  await ask("/api/manual");
  expect(warn.mock.calls.map((c) => c[0])).toEqual([
    "Access check failed: the token is for another application (ACCESS_AUD doesn't match)",
    "Access check failed: no Access token in the request",
  ]);
  expect(warn.mock.calls.join(" ")).not.toContain(token);
  warn.mockRestore();
});
