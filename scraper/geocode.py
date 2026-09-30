"""Look up coordinates for every street in docs/data/alarms.json (and manual.json).

Results are cached in docs/data/geo.json, so each street is only looked up once. First asks the
OpenStreetMap Nominatim service for "street, district, Hannover". The alarm list often has typos
("Königsstraße"), a district that OSM files differently, crossings ("NieschlagS/WittekindS") or
notes ("Moltkeplatz (Bus)"), which Nominatim can't match. Those go to Photon, a search on the same
OSM data that tolerates typos; its answer only counts if the found name is close to ours.
Streets that still can't be found (e.g. "A2 AK Ost -> AK Buchholz") are stored as null and not
retried. Both services are free and ask for at most about one request per second.
"""

import difflib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"
GEO = DATA / "geo.json"
# Rough box around Hannover so a street name can't match another town.
WEST, NORTH, EAST, SOUTH = 9.60, 52.47, 9.93, 52.30
UA = {"User-Agent": "FF_visualizer (github.com/ReaganS94/FF_visualizer)"}


def key(row):
    return f"{row['street']}|{row['district']}"


def get(url, params):
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def norm(name):
    """Compare street names without case, spaces, hyphens or "Str." vs "Straße"."""
    name = name.lower().replace("strasse", "straße")
    name = re.sub(r"str\.?$", "straße", name)
    return re.sub(r"[\s\-.]", "", name)


def variants(street):
    """Plain street names hidden in an entry: drop notes, split crossings, expand "S"/"W"/"A"."""
    names = []
    for part in re.split(r"\s*/\s*", street):
        part = re.sub(r"\(.*?\)|\[.*?\]|^.*\bHöhe\s", " ", part)
        part = re.split(r"\s+(?:Ri\.?|FR|->)\s", part)[0]
        part = re.sub(r"(?<=[a-zäöüß])(?:S|Str\.?)$", "straße", part.strip())
        part = re.sub(r"(?<=[a-zäöüß])W$", "weg", part)
        part = re.sub(r"(?<=[a-zäöüß])A$", "allee", part)
        part = " ".join(part.split())
        if len(part) >= 4 and part not in names:
            names.append(part)
    return names


def nominatim(street, district):
    hits = get("https://nominatim.openstreetmap.org/search", {
        "q": f"{street}, {district}, Hannover", "format": "jsonv2", "limit": 1,
        "viewbox": f"{WEST},{NORTH},{EAST},{SOUTH}", "bounded": 1, "countrycodes": "de",
    })
    return [round(float(hits[0]["lat"]), 5), round(float(hits[0]["lon"]), 5)] if hits else None


def photon(name, district):
    res = get("https://photon.komoot.io/api/", {
        "q": f"{name}, {district}, Hannover", "limit": 3, "lang": "de", "bbox": f"{WEST},{SOUTH},{EAST},{NORTH}",
    })
    for f in res.get("features", []):
        props = f["properties"]
        found = props.get("name") or props.get("street") or ""
        # Same name in a neighbouring town (Seelze, Laatzen, ...) inside the box doesn't count.
        if props.get("city") == "Hannover" and difflib.SequenceMatcher(None, norm(name), norm(found)).ratio() >= 0.8:
            lon, lat = f["geometry"]["coordinates"]
            return [round(lat, 5), round(lon, 5)]
    return None


def lookup(street, district):
    p = nominatim(street, district)
    for name in variants(street) if p is None else []:
        time.sleep(1.1)
        p = photon(name, district)
        if p:
            break
    return p


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
        except urllib.error.HTTPError as e:
            print(f"failed {k}: {e}")
            if e.code in (403, 429):  # asked to slow down or blocked: stop, the rest waits for the next run
                print("::warning::geocoding stopped early:", e)
                break
        except (OSError, ValueError) as e:  # network hiccup or error page: skip, retry on the next run
            print(f"failed {k}: {e}")
        time.sleep(1.1)
        if i % 25 == 24:
            GEO.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True) + "\n", "utf-8")
    GEO.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True) + "\n", "utf-8")
    print(f"looked up {len(todo)} streets, {sum(v is not None for v in cache.values())}/{len(cache)} found")
    print("not found:", ", ".join(k for k in todo if k in cache and cache[k] is None) or "none")


if __name__ == "__main__":
    main()
