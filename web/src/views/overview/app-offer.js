// "Als App speichern": on phones and tablets, Übersicht offers to put the site on the home screen. Android
// browsers that can install it (Chrome, Edge, Samsung Internet) say so with "beforeinstallprompt", only while
// it isn't installed yet, and the button opens their own install window. iPhones and iPads have no such window
// and can't tell whether the icon exists, so there the button opens a short guide; "Erledigt" or × hide the
// offer on that device. Nothing shows on computers, in other browsers, or when the site runs as the app.
// It sets itself up when the page loads; Overview.jsx only has to load this file.

import { $ } from "../../dom.js";
import "./app-offer.css";

const APP_OFFER_KEY = "app-offer-hidden";
const appOffer = {
  ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  android: /Android/.test(navigator.userAgent),
  install: null, // the browser's install window, while it offers one
};
function showAppOffer() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(APP_OFFER_KEY) === "1"; } catch {}
  const asApp = matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone === true;
  $("#app-offer").hidden = dismissed || asApp || !(appOffer.ios || appOffer.install);
}
function dismissAppOffer() {
  try { localStorage.setItem(APP_OFFER_KEY, "1"); } catch {}
  showAppOffer();
}
window.addEventListener("beforeinstallprompt", (e) => {
  if (!appOffer.android) return; // computers keep the browser's own install symbol
  e.preventDefault(); // the button takes the place of Chrome's own install bar
  appOffer.install = e;
  showAppOffer();
});
window.addEventListener("appinstalled", () => { appOffer.install = null; showAppOffer(); });
$("#app-offer-btn").addEventListener("click", async () => {
  if (appOffer.ios) {
    const guide = $("#app-offer-guide");
    guide.hidden = !guide.hidden;
    $("#app-offer-btn").setAttribute("aria-expanded", String(!guide.hidden));
    return;
  }
  const install = appOffer.install;
  appOffer.install = null; // the window opens only once; the browser offers it again on a later visit
  try { await install.prompt(); await install.userChoice; } catch {}
  showAppOffer();
});
$("#app-offer-close").addEventListener("click", dismissAppOffer);
$("#app-offer-done").addEventListener("click", dismissAppOffer);
if (appOffer.ios) {
  $("#app-offer-sub").textContent = "Mit eigenem Symbol auf dem Home-Bildschirm.";
  // The guide names the buttons as the phone shows them, so a phone set to another language gets the English names.
  if (!/^de\b/i.test(navigator.language || "")) document.querySelectorAll("#app-offer-guide [data-en]").forEach((b) => (b.textContent = b.dataset.en));
  $("#app-offer-btn").setAttribute("aria-expanded", "false");
  $("#app-offer-btn").setAttribute("aria-controls", "app-offer-guide");
}
showAppOffer();
