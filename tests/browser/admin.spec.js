// The admin page, where alarms the website doesn't list yet are added by hand. Its server (the Worker behind
// Cloudflare Access) is played by the test: nothing is saved anywhere, and the "saved" list is kept in server.rows.
import { test, expect, json } from "./fixtures.js";
import { fileURLToPath } from "node:url";
import { SITE, ADMIN } from "../../web/src/lib/links.js";

const NOW = new Date("2026-09-30T08:40:00+02:00");
const alarm = (date, time, keyword, event, street, more = {}) =>
  ({ date, time, category: "Einsatz", keyword, event, street, district: "Linden-Mitte", remarks: "", ...more });

// The website's list: its newest alarm is from 28.09., and it lists the th1 of 20.09. twice, as it sometimes does.
const WEBSITE = {
  updated: "2026-09-30T04:15:00+00:00",
  rows: [
    alarm("2026-09-28", "18:00", "b1", "Brand Mülltonne", "Fössestraße"),
    alarm("2026-09-20", "10:05", "th1", "Tür öffnen", "Limmerstraße"),
    alarm("2026-09-20", "10:05", "th1", "Tür öffnen", "Limmerstraße", { remarks: "Presse" }),
    alarm("2026-09-12", "14:30", "b2", "Brand Keller", "Wittekindstrasse", { district: "Linden-Nord" }),
    alarm("2026-09-02", "03:10", "th1", "Baum auf Straße", "NieschlagS/WittekindS"),
  ],
};
// The hand entries, newest first like the saved file.
const HAND = [
  alarm("2026-09-29", "22:00", "b1", "Rauchwarnmelder", "Davenstedter Straße"), // after the website's newest alarm
  alarm("2026-09-25", "12:00", "b1", "Doppelt", "Teststraße"), // saved twice by mistake
  alarm("2026-09-25", "12:00", "b1", "Doppelt", "Teststraße"),
  alarm("2026-09-20", "10:40", "th1", "Türöffnung 2", "Kochstraße"), // the website's th1 already stands for the one below
  alarm("2026-09-20", "10:00", "th1", "Türöffnung", "Limmerstraße"),
];

// Plays the admin Worker (admin/worker.js) and, behind it, GitHub's file for web/public/data/manual.json, and
// records each commit's message. Set server.fail to "offline", "expired" (Access sends the login page),
// 403 (an account Access lets in but the Worker doesn't), 409 (only once, like a change from elsewhere) or
// 502 (the Worker's GitHub key doesn't work) to make the next requests fail.
async function fakeServer(page, rows = HAND) {
  const server = { rows: structuredClone(rows), sha: 1, commits: [], fail: null };
  await page.route("**/api/manual", (r) => {
    const req = r.request();
    if (server.fail === "offline") return r.abort();
    if (server.fail === "expired") return r.fulfill({ status: 302, headers: { location: "https://ff-linden.cloudflareaccess.com/cdn-cgi/access/login/x" } });
    if (server.fail === 403) return r.fulfill(json({ error: "Keine Berechtigung." }, 403));
    if (server.fail === 502) return r.fulfill(json({ error: "Der GitHub-Schlüssel des Admin-Servers ist ungültig, abgelaufen oder darf nicht speichern." }, 502));
    if (req.method() === "PUT") {
      if (server.fail === 409) { server.fail = null; server.sha++; return r.fulfill(json({ error: "conflict" }, 409)); }
      const body = JSON.parse(req.postData());
      if (body.sha !== String(server.sha)) return r.fulfill(json({ error: "conflict" }, 409));
      server.rows = body.rows;
      server.sha++;
      server.commits.push(body.message);
      return r.fulfill(json({ sha: String(server.sha), user: "reagan@example.com" }));
    }
    return r.fulfill(json({ sha: String(server.sha), rows: server.rows, user: "reagan@example.com" }));
  });
  return server;
}

// Opens the admin page at NOW, signed in (Access did that before the page loaded). Questions the page asks
// are answered with yes and kept in page.dialogs; set page.answer = false to answer no. The website's list
// and the keywords come from the public site.
async function openAdmin(page, { ready = true } = {}) {
  page.dialogs = [];
  page.on("dialog", (d) => { page.dialogs.push(d.message()); return page.answer === false ? d.dismiss() : d.accept(); });
  await page.clock.install({ time: NOW });
  await page.route(`${SITE}data/keywords.json*`, (r) => r.fulfill(json({ codes: { b1: { name: "Brand 1" } } })));
  await page.route(`${SITE}data/alarms.json*`, (r) => r.fulfill(json(WEBSITE)));
  await page.goto("/admin.html");
  if (ready) await page.waitForSelector("#t-manual [data-edit]");
}

const statuses = (page) => page.locator("#t-manual tbody tr td:nth-child(6)").allTextContents();
async function fill(page, fields) {
  for (const [name, value] of Object.entries(fields)) await page.fill(`#f-alarm [name=${name}]`, value);
}
const NEW = { date: "2026-09-29", time: "09:00", keyword: "th", event: "Ölspur", street: "Fössestraße", district: "Linden-Süd" };

test("shows which hand entries the website already lists, and which to check", async ({ page }) => {
  await fakeServer(page);
  await openAdmin(page);
  expect(await statuses(page)).toEqual(["nur hier", "bitte prüfen", "bitte prüfen", "bitte prüfen", "auf der Website"]);
  await expect(page.locator("#check-note")).toBeVisible();
  // the street suggestions use the website's spelling, without crossings
  const streets = await page.$$eval("#street-list option", (o) => o.map((x) => x.value));
  expect(streets).toEqual(["Fössestraße", "Limmerstraße", "Wittekindstraße"]);
  // the form starts at the current date and time
  expect(await page.inputValue("#f-alarm [name=date]")).toBe("2026-09-30");
  expect(await page.inputValue("#f-alarm [name=time]")).toBe("08:40");
  expect(page.errors).toEqual([]);
});

test("deletes, changes and adds entries, one commit each", async ({ page }) => {
  const server = await fakeServer(page);
  await openAdmin(page);
  // deleting one of two identical entries keeps the other
  await page.click("#t-manual [data-del='2']");
  await expect(page.locator("#save-msg")).toHaveText("Gelöscht.");
  expect(page.dialogs).toEqual(["Eintrag vom 25.09.2026 12:00 (Doppelt) löschen?"]);
  expect(server.rows.filter((r) => r.event === "Doppelt")).toHaveLength(1);
  // changing an entry replaces only that one
  await page.click("#t-manual [data-edit='1']");
  await expect(page.locator("#save")).toHaveText("Änderung speichern");
  await fill(page, { event: "Brand Papierkorb" });
  await page.click("#save");
  await expect(page.locator("#save-msg")).toContainText("Geändert.");
  expect(server.rows.map((r) => r.event)).toEqual(["Rauchwarnmelder", "Brand Papierkorb", "Türöffnung 2", "Türöffnung"]);
  // "Strasse" is saved as "Straße", and the list stays sorted newest first
  await fill(page, { ...NEW, street: "Fösse Strasse" });
  await page.click("#save");
  await expect(page.locator("#save-msg")).toContainText("Gespeichert.");
  expect(server.rows[1]).toMatchObject({ date: "2026-09-29", time: "09:00", event: "Ölspur", street: "Fösse Straße" });
  expect(page.dialogs).toHaveLength(1);
  expect(server.commits).toEqual([
    "Nachtrag gelöscht: 2026-09-25 b1",
    "Nachtrag geändert: 2026-09-25 12:00 b1",
    "Einsatz nachgetragen: 2026-09-29 09:00 th",
  ]);
  expect(page.errors).toEqual([]);
});

test("asks before saving an alarm that is probably there already, or in the future", async ({ page }) => {
  const server = await fakeServer(page);
  await openAdmin(page);
  page.answer = false;
  await fill(page, { ...NEW, date: "2026-09-20", time: "10:30", keyword: "th1" });
  await page.click("#save");
  await expect(page.locator("#save-msg")).toHaveText("Nicht gespeichert.");
  expect(page.dialogs).toEqual(["Möglicher Doppeleintrag: th1 am 20.09.2026 um 10:05 (Tür öffnen, Limmerstraße) ist schon auf der Website.\n\nTrotzdem speichern?"]);
  await fill(page, { ...NEW, date: "2026-10-02" });
  await page.click("#save");
  await expect.poll(() => page.dialogs[1]).toBe("02.10.2026 09:00 liegt in der Zukunft. Trotzdem speichern?");
  await expect(page.locator("#save-msg")).toHaveText("Nicht gespeichert.");
  expect(server.commits).toEqual([]);
});

test("tries again when the list was changed elsewhere in the meantime", async ({ page }) => {
  const server = await fakeServer(page);
  await openAdmin(page);
  server.fail = 409;
  await fill(page, NEW);
  await page.click("#save");
  await expect(page.locator("#save-msg")).toContainText("Gespeichert.");
  expect(server.commits).toEqual(["Einsatz nachgetragen: 2026-09-29 09:00 th"]);
});

test("says so when the server can't be reached, or its GitHub key doesn't work", async ({ page }) => {
  const server = await fakeServer(page);
  await openAdmin(page);
  server.fail = "offline";
  await fill(page, NEW);
  await page.click("#save");
  await expect(page.locator("#save-msg")).toHaveText("Speichern fehlgeschlagen: Keine Verbindung zum Server.");
  server.fail = 502;
  await page.click("#save");
  await expect(page.locator("#save-msg")).toHaveText("Speichern fehlgeschlagen: Der GitHub-Schlüssel des Admin-Servers ist ungültig, abgelaufen oder darf nicht speichern.");
  await expect(page.locator("#editor")).toBeVisible();
  expect(server.commits).toEqual([]);
});

test("names the signed-in account and logs out through Access", async ({ page }) => {
  await fakeServer(page);
  await openAdmin(page);
  await expect(page.locator("#user")).toHaveText("reagan@example.com");
  await expect(page.locator("#editor a[href='/cdn-cgi/access/logout']")).toHaveText("Abmelden");
  // no key of any kind is kept in the browser
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
  expect(page.errors).toEqual([]);
});

test("asks to load the page again when the login ran out, before or while saving", async ({ page }) => {
  const server = await fakeServer(page);
  server.fail = "expired";
  await openAdmin(page, { ready: false });
  await expect(page.locator("#stopped-msg")).toHaveText("Die Anmeldung ist abgelaufen. Bitte die Seite neu laden und wieder anmelden.");
  await expect(page.locator("#editor")).toBeHidden();
  // and when it runs out with the form open
  server.fail = null;
  await page.reload();
  await page.waitForSelector("#t-manual [data-edit]");
  server.fail = "expired";
  await fill(page, NEW);
  await page.click("#save");
  await expect(page.locator("#stopped-msg")).toHaveText("Die Anmeldung ist abgelaufen. Bitte die Seite neu laden und wieder anmelden.");
  await expect(page.locator("#editor")).toBeHidden();
  await expect(page.locator("#stopped a[href='/cdn-cgi/access/logout']")).toBeVisible();
  expect(server.commits).toEqual([]);
});

test("shows nothing to an account that isn't an admin", async ({ page }) => {
  const server = await fakeServer(page);
  server.fail = 403;
  await openAdmin(page, { ready: false });
  await expect(page.locator("#stopped-msg")).toHaveText("Dieses Konto darf keine Einsätze nachtragen. Bitte abmelden und mit einem anderen Konto anmelden.");
  await expect(page.locator("#editor")).toBeHidden();
  await expect(page.locator("#t-manual tbody tr")).toHaveCount(0);
});

test("the old admin page on the public site sends people to the new one and forgets the old key", async ({ page }) => {
  // the public site, served from the build, with a blank page as its start page; the new admin page is a stand-in
  await page.route(`${SITE}**`, (r) => r.fulfill({ path: fileURLToPath(new URL(`../../dist/${new URL(r.request().url()).pathname.replace("/FF_visualizer/", "")}`, import.meta.url)) }));
  await page.route(`${SITE}index.html`, (r) => r.fulfill({ contentType: "text/html", body: "<p>site</p>" }));
  await page.route(ADMIN, (r) => r.fulfill({ contentType: "text/html", body: "<p>new admin page</p>" }));
  await page.goto(`${SITE}index.html`);
  await page.evaluate(() => localStorage.setItem("gh-token", "old"));
  await page.goto(`${SITE}admin.html`);
  await page.waitForURL(ADMIN);
  await expect(page.locator("p")).toHaveText("new admin page");
  await page.goto(`${SITE}index.html`);
  expect(await page.evaluate(() => localStorage.getItem("gh-token"))).toBeNull();
});
