# The admin page

[Back to the README](../README.md)

## How it works

The admin page lives at https://ff-linden-admin.ff-statistik.workers.dev/, a Cloudflare Worker
(`admin/worker.js`) behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/).
Access asks for a login (an emailed code, or GitHub) before the page loads, and lets in only the people its
policy lists: that list is the list of admins. The Worker serves the page and saves the entries into
`web/public/data/manual.json` with a GitHub key that only it knows; the browser keeps no key. Every save checks
again that Access signed the request for this application. When the login runs out (after 24 hours, unless
Access is set otherwise) the page says so and asks to load it again; "Abmelden" ends the login.
The statistics page shows its "Einsatz nachtragen" link only in browsers that came from the admin page
("Zur Statistik" there). The old `/admin.html` on the public site only sends people to the new address, and
both pages delete the key the old page kept in the browser.
The website's list and the keywords come from the public site, which always has the newest.

A manual entry is ignored once the website lists an alarm with the same keyword within an hour of
it, so nothing is counted twice. Each website alarm stands in for at most one hand entry (closest in time
first), so two alarms with the same keyword within an hour both stay until the website lists both.
The street field suggests the spellings the website uses, and "Strasse" or "Str." is saved as "Straße".
Entries can be edited in place (one commit). Before saving, the page asks for confirmation if the same keyword
within an hour is already on the website or among the hand entries.
Each entry's status is "auf der Website" once matched, "nur hier" while the website hasn't reached it, and
"bitte prüfen" when the website already lists later alarms but none matching this one (probably written with
another keyword or time; then it would count twice). On the statistics page, hand entries that
aren't matched yet are called "vorläufig" (tag in the list and on the "Letzter Einsatz" tile, and in the notes).

## Setting up the admin page

Once, in this order. Until step 3 is done the Worker refuses every save, so nothing can go wrong in between.

1. **Create the Worker.** In the Cloudflare dashboard: Workers & Pages → Create → start from "Hello World",
   name it `ff-linden-admin`, Deploy. Its address is `https://ff-linden-admin.<your subdomain>.workers.dev`.
2. **Put Access in front of it.** Zero Trust must be switched on (the Free plan is enough). Open the Worker →
   the **Access** tab → switch Access on. This creates an application called "ff-linden-admin - Cloudflare
   Workers". Then Zero Trust → Access controls → Applications → that application → its policy → add your
   email (one per admin). Its first policy only lets in Cloudflare account members.
   - **AUD tag:** a long code shown on that application's page. (Its exact spot is from Cloudflare's docs, not
     checked: the application → Additional settings / Overview.)
   - **Team domain:** this is Cloudflare's name for your Zero Trust team, not a name you make up. The easiest
     way to see it: open the admin page logged out. The login page's address starts with
     `https://<team>.cloudflareaccess.com/`, and that part is the team domain. A wrong one makes every save
     fail with "Dieses Konto darf keine Einsätze nachtragen", and the Worker's log says "fetching the keys
     answered 404".
   - Login methods are under Zero Trust → Settings → Authentication. "One-time PIN" (a code by email) is on by
     default.
3. **The Worker's settings.** The Worker → Settings → Runtime variables and secrets → + Add variable:
   - `TEAM_DOMAIN` (type Text): the team domain without `https://`, like `myteam.cloudflareaccess.com`
   - `ACCESS_AUD` (type Text): the AUD tag. It is not a secret.
   - `GITHUB_TOKEN` (type **Secret**, not Text, or it is shown to anyone with dashboard access): a new
     [fine-grained token](https://github.com/settings/personal-access-tokens/new), Repository access "Only
     select repositories" → FF_visualizer, Permissions → Contents: Read and write, nothing else. When it
     expires, make a new one and replace this secret.

   Changing these takes effect right away, no new deploy needed.
4. **Let GitHub deploy it.** Cloudflare: your profile → API Tokens → Create Token → template "Edit Cloudflare
   Workers" → Account Resources: your account; remove the Zone Resources / Workers Routes row (there is no
   own domain) → Continue → Create. GitHub: the repository's Settings → Secrets and variables → Actions → New
   repository secret: `CLOUDFLARE_API_TOKEN` (that token) and `CLOUDFLARE_ACCOUNT_ID` (Cloudflare: Workers &
   Pages → Account ID on the right). Paste both without a line break at the end: a stray line break makes the
   deploy fail with "Invalid account ID".
5. **Publish.** "Publish admin page" (`.github/workflows/admin.yml`) runs when this code reaches `main`, and
   by hand under Actions → Publish admin page → Run workflow. It replaces "Hello World" with the admin page and
   keeps the settings from step 3.
6. **Check, then retire the old key.** Open the admin page, log in with the emailed code, save and delete a
   test entry. Then delete the token the old admin page used: GitHub → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens.

A new admin: add their email to the application's policy (step 2); they log in with a code sent to that email. If the Worker's address isn't
`ff-linden-admin.ff-statistik.workers.dev`, change `ADMIN` in `web/src/lib/links.js` and the link in `web/index.html`.
