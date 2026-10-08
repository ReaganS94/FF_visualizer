// Leaflet, the map library of the Karte and the Einsatzradius. It loads from unpkg when one of them first
// shows, so visitors who never open a map don't download it. Its stylesheet is linked in index.html, with
// the same version.
// Each script loads once, however many views ask for it.
const scripts = {};
export function loadScript(src) {
  return (scripts[src] ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok;
    s.onerror = (e) => { delete scripts[src]; fail(e); };
    document.head.appendChild(s);
  }));
}
export const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
