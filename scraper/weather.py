"""Download daily weather for Hannover from Open-Meteo into docs/data/weather.json.

Past days come from the archive API (it lags a few days behind), today and tomorrow
from the forecast API. Free, no API key. Standard library only.
"""

import datetime as dt
import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "weather.json"
START = "2024-01-01"
PARAMS = {
    "latitude": 52.3705,   # Hannover-Linden
    "longitude": 9.7160,
    "timezone": "Europe/Berlin",
    "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max",
}
FIELDS = {"temperature_2m_max": "tmax", "temperature_2m_min": "tmin", "precipitation_sum": "rain", "wind_gusts_10m_max": "gust"}


def get(url, **params):
    q = urllib.parse.urlencode({**PARAMS, **params})
    req = urllib.request.Request(f"{url}?{q}", headers={"User-Agent": "FF_visualizer"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        daily = json.load(resp)["daily"]
    out = {}
    for i, day in enumerate(daily["time"]):
        values = {short: daily[long][i] for long, short in FIELDS.items()}
        if all(v is not None for v in values.values()):
            out[day] = values
    return out


def main():
    today = dt.date.today()
    days = get("https://archive-api.open-meteo.com/v1/archive", start_date=START, end_date=str(today - dt.timedelta(days=1)))
    forecast = get("https://api.open-meteo.com/v1/forecast", past_days=7, forecast_days=2)
    days.update({d: v for d, v in forecast.items() if d not in days or d >= str(today - dt.timedelta(days=7))})
    # "updated" on its own line keeps the day-by-day diff readable.
    updated = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    OUT.write_text(f'{{"updated": "{updated}",\n"days": {json.dumps(dict(sorted(days.items())), separators=(",", ":"))}}}\n', "utf-8")
    print(f"{len(days)} days of weather")


if __name__ == "__main__":
    main()
