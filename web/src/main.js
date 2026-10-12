// Starts the page: draws it (App.jsx), loads the data, and draws it again with the data. Each tab's code is in
// views/<tab>/.

import { $ } from "./dom.js";
import { loadData } from "./data.js";
import "./components/tooltip.js"; // the box that follows the pointer over charts and maps sets itself up
import "./components/warnings.js"; // the warnings load and refresh themselves; Warnings.jsx in App.jsx draws them
import { show } from "./show.js"; // before the page, so React's file stays the same (browsers keep it)
import App from "./App.jsx";

// The admin link only shows in a browser that is signed in on the admin page (same site, so the
// saved key is visible here). Everyone else never sees it.
try { $("#admin-link").hidden = !localStorage.getItem("gh-token"); } catch {}

show($("#app"), App, {});
loadData().then((status) => show($("#app"), App, { status }));
