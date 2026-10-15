// Counts visits with Cloudflare Web Analytics: no cookies, nothing saved on the visitor's device, no profile.
// It only runs on the public site, so visits from `npm run dev`, the tests and the admin page don't count.
// The token comes from Cloudflare's dashboard (Analytics & Logs → Web Analytics); it isn't a secret, it is
// visible in every page that counts. datenschutz.html tells visitors about it.
import { SITE } from "./links.js";

export const ANALYTICS_TOKEN = "84b94133c10a4368bcacfabc8d508cd2"; // ggignore: public site token, not a secret

// Adds Cloudflare's counting script to the page; true when it did.
export function startAnalytics(host = location.hostname, token = ANALYTICS_TOKEN) {
  if (!token || host !== new URL(SITE).hostname) return false;
  const s = document.createElement("script");
  s.type = "module"; // as in Cloudflare's snippet; it runs after the page is read
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.dataset.cfBeacon = JSON.stringify({ token });
  document.head.append(s);
  return true;
}
