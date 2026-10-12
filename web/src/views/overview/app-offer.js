// "Als App speichern": on phones and tablets, Übersicht offers to put the site on the home screen. Android
// browsers that can install it (Chrome, Edge, Samsung Internet) say so with "beforeinstallprompt", only while
// it isn't installed yet, and the button opens their own install window. iPhones and iPads have no such window
// and can't tell whether the icon exists, so there the button opens a short guide; "Erledigt" or × hide the
// offer on that device. Nothing shows on computers, in other browsers, or when the site runs as the app.
// This file listens for the browser from the moment the page loads; AppOffer.jsx draws the offer.

const APP_OFFER_KEY = "app-offer-hidden";
export const appOffer = {
  ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  android: /Android/.test(navigator.userAgent),
  install: null, // the browser's install window, while it offers one
};

// Whether the offer shows, for AppOffer.jsx, which reads it with useSyncExternalStore.
let shown = false;
const listeners = new Set();
export const appOfferShown = () => shown;
export function appOfferSubscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function showAppOffer() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(APP_OFFER_KEY) === "1"; } catch {}
  const asApp = matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone === true;
  shown = !(dismissed || asApp || !(appOffer.ios || appOffer.install));
  listeners.forEach((fn) => fn());
}
export function dismissAppOffer() {
  try { localStorage.setItem(APP_OFFER_KEY, "1"); } catch {}
  showAppOffer();
}
// Opens the browser's install window (Android).
export async function installApp() {
  const install = appOffer.install;
  appOffer.install = null; // the window opens only once; the browser offers it again on a later visit
  try { await install.prompt(); await install.userChoice; } catch {}
  showAppOffer();
}
window.addEventListener("beforeinstallprompt", (e) => {
  if (!appOffer.android) return; // computers keep the browser's own install symbol
  e.preventDefault(); // the button takes the place of Chrome's own install bar
  appOffer.install = e;
  showAppOffer();
});
window.addEventListener("appinstalled", () => { appOffer.install = null; showAppOffer(); });
showAppOffer();
