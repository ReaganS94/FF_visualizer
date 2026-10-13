// Starts the page: draws it (App.jsx), loads the data, and draws it again with the data. Each tab's code is in
// views/<tab>/.

import { $ } from "./dom.js";
import { loadData } from "./data.js";
import { ADMIN } from "./lib/links.js";
import "./components/tooltip.js"; // the box that follows the pointer over charts and maps sets itself up
import "./components/warnings.js"; // the warnings load and refresh themselves; Warnings.jsx in App.jsx draws them
import { show } from "./show.js"; // before the page, so React's file stays the same (browsers keep it)
import App from "./App.jsx";

// The admin link only shows in a browser that came here from the admin page ("Zur Statistik" there adds
// #admin), or that still has the key of the old admin page saved. That key is removed: the admin page has
// its own login now. Everyone else never sees the link.
try {
  const fromAdmin = location.hash === "#admin";
  if (fromAdmin || localStorage.getItem("gh-token")) localStorage.setItem("admin-link", "1");
  localStorage.removeItem("gh-token");
  if (fromAdmin) history.replaceState(null, "", location.pathname + location.search);
  $("#admin-link a").href = ADMIN;
  $("#admin-link").hidden = !localStorage.getItem("admin-link");
} catch {}

show($("#app"), App, {});
loadData().then((status) => show($("#app"), App, { status }));
