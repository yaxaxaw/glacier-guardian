"""Download NASA MERRA-2 monthly variables for a few Kyrgyz regions and write trends.js.

MERRA-2 is one of the models named in the challenge and every variable here is also in Giovanni.
Only a small box over Kyrgyzstan is requested from NASA's cloud OPeNDAP, so each month is ~30 KB.

Usage: python3 fetch_trends.py <cache_folder>      (needs an Earthdata login in ~/.netrc, plus curl)
Needs: numpy, netCDF4. Re-running reuses files already in the cache folder.
"""
import json, os, re, subprocess, sys, urllib.parse, urllib.request, datetime
from concurrent.futures import ThreadPoolExecutor
import numpy as np, netCDF4

Y0, Y1 = 1980, 2025
LAT = (258, 267)   # MERRA-2 grid rows 39.0..43.5 N
LON = (398, 417)   # MERRA-2 grid cols 68.75..80.625 E

# collection short name -> variables to fetch
COLL = {"M2TMNXSLV": ["T2M"], "M2TMNXFLX": ["PRECTOTCORR"], "M2TMNXLND": ["SNOMAS", "FRSNO"],
        "M2TMNXGLC": ["RUNOFF", "SNICEALB"]}
# variable -> (collection, unit, conversion from file units)
VARS = {"T2M": ("M2TMNXSLV", "°C", lambda v: v - 273.15),
        "PRECTOTCORR": ("M2TMNXFLX", "mm/day", lambda v: v * 86400),
        "SNOMAS": ("M2TMNXLND", "mm", lambda v: v),
        "FRSNO": ("M2TMNXLND", "%", lambda v: v * 100),
        "RUNOFF": ("M2TMNXGLC", "mm/day", lambda v: v * 86400),
        "SNICEALB": ("M2TMNXGLC", "", lambda v: v)}
# region id -> bounding box (lat0, lat1, lon0, lon1); grid cells whose centres fall inside are averaged
REGIONS = {"alaarcha": (42.3, 42.7, 74.2, 75.1), "inylchek": (41.8, 42.2, 79.2, 80.2),
           "akshiirak": (41.8, 42.2, 77.8, 78.5), "naryn": (41.3, 41.7, 75.5, 76.4),
           "issykkul": (42.3, 42.7, 76.8, 78.2), "fergana": (40.3, 40.7, 72.3, 73.2),
           "alay": (39.3, 39.7, 71.7, 73.2)}

cache = sys.argv[1]
os.makedirs(cache, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))


def granules(short):
    url = (f"https://cmr.earthdata.nasa.gov/search/granules.umm_json?short_name={short}"
           f"&temporal={Y0}-01-01T00:00:00Z,{Y1}-12-31T23:59:59Z&page_size=2000")
    out = {}
    for it in json.load(urllib.request.urlopen(url))["items"]:
        ym = re.search(r"\.(\d{6})\.nc4$", it["umm"]["GranuleUR"]).group(1)
        dap = next(u["URL"] for u in it["umm"]["RelatedUrls"] if u["URL"].startswith("https://opendap.earthdata.nasa.gov"))
        out[ym] = dap
    return out


def fetch(job):
    short, ym, dap = job
    path = os.path.join(cache, f"{short}.{ym}.nc4")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return None
    sel = f"[0:1:0][{LAT[0]}:1:{LAT[1]}][{LON[0]}:1:{LON[1]}]"
    ce = ";".join([f"/{v}{sel}" for v in COLL[short]] + [f"/lat[{LAT[0]}:1:{LAT[1]}]", f"/lon[{LON[0]}:1:{LON[1]}]"])
    url = dap + ".dap.nc4?dap4.ce=" + urllib.parse.quote(ce, safe="/;:=")
    for _ in range(3):
        r = subprocess.run(["curl", "-s", "-f", "-n", "-L", "-c", os.path.join(cache, ".cj"), "-b", os.path.join(cache, ".cj"),
                            "-m", "120", "-o", path + ".part", url])
        if r.returncode == 0:
            os.replace(path + ".part", path)
            return None
    return f"{short} {ym}"


jobs = []
for short in COLL:
    g = granules(short)
    missing = [f"{y}{m:02d}" for y in range(Y0, Y1 + 1) for m in range(1, 13) if f"{y}{m:02d}" not in g]
    assert not missing, f"{short}: CMR has no granule for {missing[:5]}"
    jobs += [(short, ym, dap) for ym, dap in sorted(g.items())]
with ThreadPoolExecutor(8) as ex:
    failed = [f for f in ex.map(fetch, jobs) if f]
assert not failed, f"downloads failed: {failed[:10]}"

# ---------- monthly area means per region ----------
series = {r: {} for r in REGIONS}
cells = {}
months = [f"{y}{m:02d}" for y in range(Y0, Y1 + 1) for m in range(1, 13)]
for v, (short, unit, conv) in VARS.items():
    for r in REGIONS:
        series[r][v] = []
    for ym in months:
        d = netCDF4.Dataset(os.path.join(cache, f"{short}.{ym}.nc4"))
        la, lo = d["lat"][:], d["lon"][:]
        a = np.ma.filled(np.ma.masked_invalid(d[v][0]).astype(float), np.nan)
        for r, (a0, a1, o0, o1) in REGIONS.items():
            iy = np.flatnonzero((la >= a0) & (la <= a1)); ix = np.flatnonzero((lo >= o0) & (lo <= o1))
            assert len(iy) and len(ix), f"region {r} has no MERRA-2 cell"
            cells[r] = [[float(la[j]), float(lo[i])] for j in iy for i in ix]
            sub = a[np.ix_(iy, ix)]
            val = float(np.nanmean(sub)) if np.isfinite(sub).any() else None
            series[r][v].append(None if val is None else round(float(conv(val)), 3))
# a variable a region does not have (e.g. glacier runoff outside the Alay) is dropped for that region
for r in REGIONS:
    for v in list(series[r]):
        if sum(x is not None for x in series[r][v]) < 0.9 * len(months):
            del series[r][v]

out = {"built": datetime.date.today().isoformat(), "y0": Y0, "y1": Y1, "cells": cells,
       "units": {v: VARS[v][1] for v in VARS}, "series": series}
with open(os.path.join(here, "trends.js"), "w") as f:
    f.write("/* NASA MERRA-2 monthly area means for Kyrgyz regions, built by fetch_trends.py. */\nwindow.TRENDS="
            + json.dumps(out, separators=(",", ":"), ensure_ascii=False) + ";\n")
print({r: sorted(series[r]) for r in REGIONS})
