// The small box that follows the pointer over charts and maps: it shows the data-tip of whatever the pointer
// is over. placeTip() shows a text at a given point (the Einsatzradius map uses it when a dot is tapped).
import "./tooltip.css";
import { $ } from "../dom.js";

export const tip = $("#tip");
export function placeTip(html, cx, cy) {
  tip.innerHTML = html;
  tip.hidden = false;
  const x = Math.min(cx + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = cy + 14 + tip.offsetHeight > window.innerHeight ? cy - tip.offsetHeight - 10 : cy + 14;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  placeTip(t.dataset.tip, e.clientX, e.clientY);
});
