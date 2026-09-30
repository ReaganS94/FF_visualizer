"""Fetch the FF Linden activity list and merge new rows into docs/data/alarms.json.

Usage:
    python scraper/scrape.py                 # fetch current year from the website
    python scraper/scrape.py --year 2025     # fetch a specific year
    python scraper/scrape.py --all           # fetch the unfiltered page (full history)
    python scraper/scrape.py --file page.html  # parse a saved copy instead of fetching

Only the standard library is used, so the GitHub Action needs no installs.
For every year that was fetched, the stored rows are replaced by the site's rows, so corrections
made on the site (e.g. a changed keyword or an added press link) don't leave duplicates behind.
If the site suddenly shows far fewer rows for a year than we have, nothing is removed.
"""

import argparse
import datetime as dt
import html
import json
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

URL = "https://www.ff-linden.de/veranstaltungsliste/"
DATA = Path(__file__).resolve().parent.parent / "docs" / "data" / "alarms.json"

# data-label on the site -> field name in our JSON
FIELDS = {
    "Datum": "date",
    "Uhrzeit": "time",
    "Kategorie": "category",
    "Stichwort": "keyword",
    "Ereignis": "event",
    "Straße": "street",
    "Stadtteil": "district",
    "Bemerkungen": "remarks",
}


class ActivityTableParser(HTMLParser):
    """Collects rows of <table class="activity-table"> keyed by each cell's data-label."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found = False
        self.closed = False
        self.in_table = False
        self.label = None
        self.row = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table" and "activity-table" in (a.get("class") or "").split():
            self.in_table = self.found = True
        elif self.in_table and tag == "tr":
            self.row = {}
        elif self.in_table and tag == "td" and self.row is not None:
            self.label = a.get("data-label")
            self.row.setdefault(self.label, "")

    def handle_endtag(self, tag):
        if tag == "table" and self.in_table:
            self.in_table = False
            self.closed = True
        elif tag == "td":
            self.label = None
        elif tag == "tr" and self.row:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        # Text inside nested tags (e.g. a link in Bemerkungen) is kept as plain text.
        if self.label and self.row is not None:
            self.row[self.label] += data


def parse(page):
    p = ActivityTableParser()
    p.feed(page)
    # An empty table is fine (e.g. a new year without alarms yet); a missing table is not.
    if not p.found:
        raise SystemExit("Alarm table not found: the page layout may have changed.")
    # A download cut off midway would otherwise drop the oldest rows of the year.
    if not p.closed:
        raise SystemExit("Alarm table has no end: the page looks cut off.")
    out = []
    for r in p.rows:
        if "Datum" not in r:
            if any(k in FIELDS for k in r):
                raise SystemExit(f"A row has no date, the page layout may have changed: {r}")
            continue  # e.g. a "no entries" row without labels
        row = {FIELDS[k]: " ".join(html.unescape(v).split()) for k, v in r.items() if k in FIELDS}
        d = dt.datetime.strptime(row["date"], "%d.%m.%Y").date()
        row["date"] = d.isoformat()  # store ISO so sorting and JS parsing are trivial
        out.append(row)
    return out


def fetch(params=""):
    req = urllib.request.Request(URL + params, headers={"User-Agent": "FF_visualizer (github.com/ReaganS94/FF_visualizer)"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def key(row):
    return tuple(row.get(f, "") for f in FIELDS.values())


KEEP_RATIO = 0.9  # a synced year may shrink by at most 10 % (site-side deletions/merges)


def merge(new_rows):
    """Replace each fetched year's rows with the site's version; returns (added, removed)."""
    existing = json.loads(DATA.read_text("utf-8"))["rows"] if DATA.exists() else []
    fetched = {}
    for r in new_rows:
        fetched.setdefault(r["date"][:4], {})[key(r)] = r  # the site lists some alarms twice; keep one copy
    rows, added, removed = [], [], []
    by_year = {}
    for r in existing:
        by_year.setdefault(r["date"][:4], []).append(r)
    for year in sorted(set(by_year) | set(fetched)):
        old, new = by_year.get(year, []), fetched.get(year)
        if new is None:
            rows += old
            continue
        old_keys = {key(r) for r in old}
        if len(new) < KEEP_RATIO * len(old):
            # "::warning::" shows up on the workflow run's summary page
            print(f"::warning::site shows {len(new)} rows for {year}, we have {len(old)}; only adding new ones")
            rows += old + [r for k, r in new.items() if k not in old_keys]
            added += [r for k, r in new.items() if k not in old_keys]
            continue
        rows += new.values()
        added += [r for k, r in new.items() if k not in old_keys]
        removed += [r for r in old if key(r) not in new]
    rows.sort(key=lambda r: (r["date"], r["time"]), reverse=True)
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(
        json.dumps({"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "rows": rows},
                   ensure_ascii=False, indent=1) + "\n",
        "utf-8",
    )
    return added, removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--year", type=int)
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    if args.file:
        pages = [Path(args.file).read_text("utf-8")]
    elif args.all:
        pages = [fetch()]
    else:
        today = dt.date.today()
        years = [args.year] if args.year else [today.year]
        if not args.year and today.month == 1:
            years.append(today.year - 1)  # catch late entries for December
        pages = [fetch(f"?filter_year={y}") for y in years]

    added, removed = merge([r for page in pages for r in parse(page)])
    print(f"{len(added)} new or changed row(s), {len(removed)} replaced or removed")
    for sign, rows in (("+", added), ("-", removed)):
        for r in rows:
            print(f"  {sign}", r["date"], r["time"], r["keyword"], r["event"])


if __name__ == "__main__":
    sys.exit(main())
