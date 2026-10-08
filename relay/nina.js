// The relay for the warnings box, a Cloudflare Worker on the free plan. It hands NINA's list of current
// warnings for the Region Hannover to the site with the header that lets another website read it: NINA's own
// answer doesn't carry that header, so browsers throw the list away when the site asks NINA directly.
// It passes on this one list only, and keeps it for a minute, so NINA gets at most one request a minute
// however many people have the site open. README.md, "Warnungen", says how to put it online.
// NINA lists warnings per district; 032410000000 is the Region Hannover (its key with the last 7 digits 0).
const NINA = "https://warnung.bund.de/api31/dashboard/032410000000.json";
const KEEP = 60 * 1000;
// Any website may read it, like Bright Sky's DWD warnings: the list is public anyway, and the site keeps
// working if it ever moves to another address.
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=60", "access-control-allow-origin": "*" };

let kept = null; // NINA's last list: { at, body }

export default {
  async fetch(request) {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...HEADERS, allow: "GET" } });
    if (!kept || Date.now() - kept.at >= KEEP) {
      const body = await load();
      if (body === null) return new Response(null, { status: 502, headers: HEADERS });
      kept = { at: Date.now(), body };
    }
    return new Response(kept.body, { headers: HEADERS });
  },
};

// NINA's list as text, or null when NINA doesn't answer with a list within 8 seconds.
async function load() {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(NINA, { headers: { accept: "application/json" }, signal: ctl.signal });
    const body = res.ok ? await res.text() : null;
    return body !== null && Array.isArray(JSON.parse(body)) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
