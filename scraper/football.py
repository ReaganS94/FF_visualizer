"""Download the dates of Hannover 96 home games into web/public/data/heimspiele.json (for the Mythen-Check).

League games from OpenLigaDB (free, no API key), for the current and the previous season. A season is
only replaced when the answer has home games in it, so a failed or empty answer keeps what is already
there. Standard library only.
"""

import datetime as dt
import json
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "heimspiele.json"
TEAM = "Hannover 96"
LEAGUES = ("bl1", "bl2", "bl3")


def home_games(league, season):
    req = urllib.request.Request(f"https://api.openligadb.de/getmatchdata/{league}/{season}", headers={"User-Agent": "FF_visualizer"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        matches = json.load(resp)
    return {m["matchDateTime"][:10] for m in matches if m["team1"]["teamName"].strip() == TEAM}


def main():
    data = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {"seasons": {}}
    today = dt.date.today()
    current = today.year if today.month >= 7 else today.year - 1  # a season starts in summer
    for season in (current - 1, current):
        games = set()
        for league in LEAGUES:
            try:
                games |= home_games(league, season)
            except Exception as e:  # one league failing shouldn't stop the others
                print(f"::warning::{league} {season}: {e}")
        if games:
            data["seasons"][str(season)] = sorted(games)
            print(f"{season}: {len(games)} home games")
        else:
            print(f"::warning::No {TEAM} home games found for {season}, keeping the old list")
    # One season per line keeps the diff readable.
    seasons = ",\n".join(f'"{k}": {json.dumps(v)}' for k, v in sorted(data["seasons"].items()))
    OUT.write_text(f'{{"seasons": {{\n{seasons}}}}}\n', "utf-8")


if __name__ == "__main__":
    main()
