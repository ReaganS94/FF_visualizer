"""Look up coordinates for every street in docs/data/alarms.json (and manual.json).

Results are cached in docs/data/geo.json, so each street is only looked up once. Uses the free
OpenStreetMap Nominatim service, which allows at most one request per second.
Streets that can't be found (e.g. "A2 AK Ost -> AK Buchholz") are stored as null and not retried.
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"
GEO = DATA / "geo.json"
# Rough box around Hannover so a street name can't match another town.
VIEWBOX = "9.60,52.47,9.93,52.30"


def key(row):
    return f"{row['street']}|{row['district']}"


def lookup(street, district):
    q = urllib.parse.urlencode({
        "q": f"{street}, {district}, Hannover", "format": "jsonv2", "limit": 1,
        "viewbox": VIEWBOX, "bounded": 1, "countrycodes": "de",
    })
    req = urllib.request.Request(f"https://nominatim.openstreetmap.org/search?{q}",
                                 headers={"User-Agent": "FF_visualizer (github.com/ReaganS94/FF_visualizer)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        hits = json.load(resp)
    return [round(float(hits[0]["lat"]), 5), round(float(hits[0]["lon"]), 5)] if hits else None


def main():
    cache = json.loads(GEO.read_text("utf-8")) if GEO.exists() else {}
    rows = json.loads((DATA / "alarms.json").read_text("utf-8"))["rows"]
    if (DATA / "manual.json").exists():
        rows += json.loads((DATA / "manual.json").read_text("utf-8"))["rows"]
    todo = sorted({key(r) for r in rows if r.get("street")} - cache.keys())
    for i, k in enumerate(todo):
        street, district = k.split("|", 1)
        try:
            cache[k] = lookup(street, district)
        except OSError as e:  # network hiccup: skip, retry on the next run
            print(f"failed {k}: {e}")
            continue
        time.sleep(1.1)
        if i % 25 == 24:
            GEO.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True) + "\n", "utf-8")
    GEO.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True) + "\n", "utf-8")
    print(f"looked up {len(todo)} streets, {sum(v is not None for v in cache.values())}/{len(cache)} found")


if __name__ == "__main__":
    main()
