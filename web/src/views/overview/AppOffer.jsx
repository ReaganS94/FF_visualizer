// The offer to put the site on the home screen, on Übersicht above the numbers; app-offer.js says when it shows.
import { useState, useSyncExternalStore } from "react";
import { appOffer, appOfferShown, appOfferSubscribe, dismissAppOffer, installApp } from "./app-offer.js";
import "./app-offer.css";

export default function AppOffer() {
  const shown = useSyncExternalStore(appOfferSubscribe, appOfferShown);
  const [guide, setGuide] = useState(false); // iPhone and iPad: the steps, opened with the button
  const { ios } = appOffer;
  // The guide names the buttons as the phone shows them, so a phone set to another language gets the English names.
  const en = ios && !/^de\b/i.test(navigator.language || "");
  const name = (de, english) => <b data-en={english}>{en ? english : de}</b>;
  const share = name("Teilen", "Share");
  return (
    <div className="app-offer" id="app-offer" hidden={!shown}>
      <div className="app-offer-row">
        <button type="button" className="app-offer-btn" id="app-offer-btn" aria-expanded={ios ? String(guide) : undefined}
          aria-controls={ios ? "app-offer-guide" : undefined} onClick={ios ? () => setGuide(!guide) : installApp}>
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width="36" height="36" />
          <span><b>Als App speichern</b><small id="app-offer-sub">{`Mit eigenem Symbol auf dem ${ios ? "Home-Bildschirm" : "Startbildschirm"}.`}</small></span>
        </button>
        <button type="button" className="app-offer-close" id="app-offer-close" aria-label="Ausblenden" title="Ausblenden" onClick={dismissAppOffer}>×</button>
      </div>
      <div className="app-offer-guide" id="app-offer-guide" hidden={!guide}>
        <ol>
          <li>Öffne die Seite in Safari. Kommst du über einen Link aus einer anderen App, etwa aus einem Chat, tippe dort auf {share} und dann auf {name("In Safari öffnen", "Open in Safari")}.</li>
          <li>Tippe auf <b>•••</b> neben der Adresszeile und dann auf {share} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"></path></svg>. Gibt es kein <b>•••</b>, tippe gleich auf {share}.</li>
          <li>Scrolle in der Liste nach unten bis {name("Zum Home-Bildschirm", "Add to Home Screen")} und tippe darauf.</li>
          <li>Tippe auf {name("Hinzufügen", "Add")}. Danach öffnet das Symbol die Seite wie eine App.</li>
        </ol>
        <button type="button" className="app-offer-done" id="app-offer-done" onClick={dismissAppOffer}>Erledigt</button>
      </div>
    </div>
  );
}
