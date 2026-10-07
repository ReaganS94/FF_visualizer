// The admin page, where alarms the website doesn't list yet are added by hand. GitHub is played by the
// test: nothing is saved anywhere, and the "saved" list is kept in github.rows.
import { test, expect, json } from "./fixtures.js";

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

// Plays GitHub's file API for docs/data/manual.json and records each commit's message. Set github.fail to
// "offline", 401 or 409 to make the next requests fail (409 only once, like a change from elsewhere).
async function fakeGitHub(page, rows = HAND) {
  const github = { rows: structuredClone(rows), sha: 1, commits: [], fail: null };
  await page.route("https://api.github.com/**", (r) => {
    const req = r.request();
    if (github.fail === "offline") return r.abort();
    if (github.fail === 401) return r.fulfill(json({ message: "Bad credentials" }, 401));
    if (new URL(req.url()).pathname === "/repos/ReaganS94/FF_visualizer") return r.fulfill(json({ permissions: { push: github.push ?? true } }));
    if (req.method() === "PUT") {
      if (github.fail === 409) { github.fail = null; github.sha++; return r.fulfill(json({ message: "does not match" }, 409)); }
      const body = JSON.parse(req.postData());
      if (body.sha !== String(github.sha)) return r.fulfill(json({ message: "does not match" }, 409));
      github.rows = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")).rows;
      github.sha++;
      github.commits.push(body.message);
      return r.fulfill(json({ content: { sha: String(github.sha) } }));
    }
    return r.fulfill(json({ sha: String(github.sha), content: Buffer.from(JSON.stringify({ rows: github.rows })).toString("base64") }));
  });
  return github;
}

// Opens the admin page as Reagan (key saved in this browser) at NOW. Questions the page asks are
// answered with yes and kept in page.dialogs; set page.answer = false to answer no.
async function openAdmin(page, { loggedIn = true } = {}) {
  page.dialogs = [];
  page.on("dialog", (d) => { page.dialogs.push(d.message()); return page.answer === false ? d.dismiss() : d.accept(); });
  await page.clock.install({ time: NOW });
  await page.route("**/data/alarms.json*", (r) => r.fulfill(json(WEBSITE)));
  if (loggedIn) await page.addInitScript(() => localStorage.setItem("gh-token", "t"));
  await page.goto("/admin.html");
  if (loggedIn) await page.waitForSelector("#t-manual [data-edit]");
}

const statuses = (page) => page.locator("#t-manual tbody tr td:nth-child(6)").allTextContents();
async function fill(page, fields) {
  for (const [name, value] of Object.entries(fields)) await page.fill(`#f-alarm [name=${name}]`, value);
}
const NEW = { date: "2026-09-29", time: "09:00", keyword: "th", event: "Ölspur", street: "Fössestraße", district: "Linden-Süd" };

test("shows which hand entries the website already lists, and which to check", async ({ page }) => {
  await fakeGitHub(page);
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
  const github = await fakeGitHub(page);
  await openAdmin(page);
  // deleting one of two identical entries keeps the other
  await page.click("#t-manual [data-del='2']");
  await expect(page.locator("#save-msg")).toHaveText("Gelöscht.");
  expect(page.dialogs).toEqual(["Eintrag vom 25.09.2026 12:00 (Doppelt) löschen?"]);
  expect(github.rows.filter((r) => r.event === "Doppelt")).toHaveLength(1);
  // changing an entry replaces only that one
  await page.click("#t-manual [data-edit='1']");
  await expect(page.locator("#save")).toHaveText("Änderung speichern");
  await fill(page, { event: "Brand Papierkorb" });
  await page.click("#save");
  await expect(page.locator("#save-msg")).toContainText("Geändert.");
  expect(github.rows.map((r) => r.event)).toEqual(["Rauchwarnmelder", "Brand Papierkorb", "Türöffnung 2", "Türöffnung"]);
  // "Strasse" is saved as "Straße", and the list stays sorted newest first
  await fill(page, { ...NEW, street: "Fösse Strasse" });
  await page.click("#save");
  await expect(page.locator("#save-msg")).toContainText("Gespeichert.");
  expect(github.rows[1]).toMatchObject({ date: "2026-09-29", time: "09:00", event: "Ölspur", street: "Fösse Straße" });
  expect(page.dialogs).toHaveLength(1);
  expect(github.commits).toEqual([
    "Nachtrag gelöscht: 2026-09-25 b1",
    "Nachtrag geändert: 2026-09-25 12:00 b1",
    "Einsatz nachgetragen: 2026-09-29 09:00 th",
  ]);
  expect(page.errors).toEqual([]);
});

test("asks before saving an alarm that is probably there already, or in the future", async ({ page }) => {
  const github = await fakeGitHub(page);
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
  expect(github.commits).toEqual([]);
});

test("tries again when the list was changed elsewhere in the meantime", async ({ page }) => {
  const github = await fakeGitHub(page);
  await openAdmin(page);
  github.fail = 409;
  await fill(page, NEW);
  await page.click("#save");
  await expect(page.locator("#save-msg")).toContainText("Gespeichert.");
  expect(github.commits).toEqual(["Einsatz nachgetragen: 2026-09-29 09:00 th"]);
});

test("says so when GitHub can't be reached", async ({ page }) => {
  const github = await fakeGitHub(page);
  await openAdmin(page);
  github.fail = "offline";
  await fill(page, NEW);
  await page.click("#save");
  await expect(page.locator("#save-msg")).toHaveText("Speichern fehlgeschlagen: Keine Verbindung zu GitHub.");
});

test("asks to log in again when the key has expired", async ({ page }) => {
  const github = await fakeGitHub(page);
  github.fail = 401;
  await openAdmin(page, { loggedIn: false });
  await page.evaluate(() => localStorage.setItem("gh-token", "old"));
  await page.reload();
  await expect(page.locator("#login-msg")).toHaveText("Bitte neu anmelden. Der Schlüssel ist ungültig oder abgelaufen.");
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#editor")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("gh-token"))).toBeNull();
});

test("logs in only with a key that may save", async ({ page }) => {
  const github = await fakeGitHub(page);
  await openAdmin(page, { loggedIn: false });
  github.push = false;
  await page.fill("#token", "read-only");
  await page.click("#f-login button");
  await expect(page.locator("#login-msg")).toHaveText("Anmeldung fehlgeschlagen: Der Schlüssel darf nicht auf das Repository schreiben.");
  github.push = true;
  await page.fill("#token", "good");
  await page.click("#f-login button");
  await expect(page.locator("#editor")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("gh-token"))).toBe("good");
  // logging out removes the key from this browser
  await page.click("#logout");
  await expect(page.locator("#login")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("gh-token"))).toBeNull();
});
