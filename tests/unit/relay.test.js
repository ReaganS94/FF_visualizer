// The relay for NINA's warnings (relay/nina.js), run in Node with NINA's answers made up by the test.
import { test, expect, vi, beforeEach, afterEach } from "vitest";

const NINA = "https://warnung.bund.de/api31/dashboard/032410000000.json";
const LIST = [{ id: "mow.1", payload: { data: { provider: "MOWAS", severity: "Severe", msgType: "Alert" } }, i18nTitle: { de: "Brand" } }];
let relay, nina;

beforeEach(async () => {
  vi.resetModules(); // a fresh relay for every test, with nothing kept yet
  relay = (await import("../../relay/nina.js")).default;
  nina = vi.fn(async () => new Response(JSON.stringify(LIST)));
  vi.stubGlobal("fetch", nina);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ask = (method = "GET") => relay.fetch(new Request("https://relay.example/", { method, headers: { origin: "https://reagans94.github.io" } }));

test("passes on NINA's list for the Region Hannover, readable by other websites", async () => {
  const res = await ask();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(LIST);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  expect(nina).toHaveBeenCalledTimes(1);
  expect(nina.mock.calls[0][0]).toBe(NINA);
});

test("asks NINA at most once a minute", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-08T12:00:00Z"), toFake: ["Date"] });
  await ask();
  await ask();
  vi.setSystemTime(new Date("2026-10-08T12:00:59Z"));
  expect(await (await ask()).json()).toEqual(LIST);
  expect(nina).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-10-08T12:01:00Z"));
  await ask();
  expect(nina).toHaveBeenCalledTimes(2);
});

test("says 502 when NINA fails or doesn't answer with a list, and tries again next time", async () => {
  nina.mockResolvedValueOnce(new Response("[]", { status: 503 })); // a list, but NINA says something is wrong
  nina.mockRejectedValueOnce(new TypeError("fetch failed"));
  nina.mockResolvedValueOnce(new Response("<html>Wartung</html>"));
  nina.mockResolvedValueOnce(new Response('{"not":"a list"}'));
  for (let i = 0; i < 4; i++) {
    const res = await ask();
    expect(res.status).toBe(502);
    // the site can read the failure instead of seeing a blocked request
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  }
  expect((await ask()).status).toBe(200);
  expect(nina).toHaveBeenCalledTimes(5);
});

test("gives up on NINA after 8 seconds", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  nina.mockImplementationOnce((url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
  const res = ask();
  await vi.advanceTimersByTimeAsync(7999);
  expect(nina.mock.calls[0][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await res).status).toBe(502);
});

test("only answers GET", async () => {
  const res = await ask("POST");
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("GET");
  expect(nina).not.toHaveBeenCalled();
});
