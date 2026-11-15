"""Build data.js only from datasets listed on
https://www.earthdata.nasa.gov/topics/cryosphere/glaciers/data-access-tools#toc-glaciers-datasets

Inputs (download from NASA NSIDC with an Earthdata login), all in one folder:
  nsidc0770_13.rgi60.CentralAsia.zip                       RGI 6.0 region 13 (NSIDC-0770)
  R13_glac_mass_annual_50sets_2000_2100-ssp{126,245,585}.nc Global PyGEM-OGGM Glacier Projections (HMA2_GGP)
  R13_glac_mass_annual_mad_50sets_2000_2100-ssp245.nc       same, parameter uncertainty (MAD)
  glims_north.zip  (optional)                               GLIMS Glacier Database (NSIDC-0272), for names

Usage: python3 build_data.py <input_folder>
Needs: numpy, netCDF4, pyshp. Keeps the country outline (KG_OUTLINE) from the existing data.js.
"""
import json, math, os, re, sys, zipfile, io, datetime
import numpy as np, netCDF4, shapefile

RHO_W, RHO_ICE, RHO_DH = 1000.0, 900.0, 850.0   # kg/m3; 850 = standard volume-to-mass conversion (Huss 2013)
Y0, Y1 = 2000, 2020                              # "past" window of the model run
GONE = 0.10                                      # "almost gone" = less than 10% of the year-2000 ice left
SCEN = ["126", "245", "585"]

src_dir = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
old = open(os.path.join(here, "data.js")).read()
outline_js = re.search(r"window\.KG_OUTLINE=.*", old, re.S).group(0)
rings = json.loads(re.search(r"window\.KG_OUTLINE=(\{.*\});?", old, re.S).group(1))["coordinates"]


def in_ring(x, y, r):
    c = False
    for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def in_kg(x, y):
    return in_ring(x, y, rings[0]) and not any(in_ring(x, y, h) for h in rings[1:])


def clean_name(n):
    # RGI/GLIMS names often start with a USSR catalogue code, e.g. "SU5X14307150 Korzheniovskij"
    n = re.sub(r"^SU\w*\s*", "", (n or "").strip())
    n = re.sub(r"^[\d\s\-–,]+", "", n).strip()
    n = re.sub(r"\s+(Glacier|Gl\.?|lednik)$", "", n, flags=re.I).strip()   # "Abramov Glacier" -> "Abramov"
    if re.fullmatch(r"[A-Z]{2}\d[\w\-]*", n) or len(n) < 3:              # catalogue codes like CN5Y671N0017, "a"
        return ""
    return "" if n.lower() in ("none", "null") or n.lower().startswith("unnamed") else n


assert clean_name("SU5X14307150 Korzheniovskij") == "Korzheniovskij"
assert clean_name("Abramov Glacier") == "Abramov" and clean_name("Akshiirak Gl") == "Akshiirak"
assert clean_name("Unnamed 68") == "" and clean_name("CN5Y671N0017") == "" and clean_name("b") == "" and clean_name("North Karasay") == "North Karasay"


# ---------- RGI 6.0: inventory attributes ----------
z = zipfile.ZipFile(os.path.join(src_dir, "nsidc0770_13.rgi60.CentralAsia.zip"))
base = [n[:-4] for n in z.namelist() if n.endswith(".shp")][0]
rdr = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")),
                       shx=io.BytesIO(z.read(base + ".shx")))
F = ["RGIId", "GLIMSId", "CenLon", "CenLat", "Area", "Zmin", "Zmax", "Zmed", "Slope", "Aspect", "Name"]
gl = [dict(zip(F, r)) for r in rdr.iterRecords(fields=F) if in_kg(r[2], r[3])]
print("RGI 6.0 glaciers in Kyrgyzstan:", len(gl))

# ---------- GLIMS: names (optional) ----------
# Match by GLIMS ID first; GLIMS often stores Kyrgyz glaciers under other IDs, so fall back to the nearest
# RGI glacier within ~1.5 km of the GLIMS ID point (the ID encodes a lon/lat on the glacier).
glims_names, near = {}, []
gz = os.path.join(src_dir, "glims_north.zip")
if os.path.exists(gz):
    z2 = zipfile.ZipFile(gz)
    want = {g["GLIMSId"] for g in gl}
    lo0, la0 = min(g["CenLon"] for g in gl) - .1, min(g["CenLat"] for g in gl) - .1
    lo1, la1 = max(g["CenLon"] for g in gl) + .1, max(g["CenLat"] for g in gl) + .1
    for s in [n for n in z2.namelist() if n.endswith("polygons.dbf")]:
        r2 = shapefile.Reader(dbf=z2.open(s), encodingErrors="replace")  # streamed: the GLIMS table is ~5 GB unpacked
        for rec in r2.iterRecords(fields=["glac_id", "glac_name"]):
            d = rec.as_dict(); nm = clean_name(d["glac_name"])
            if not nm:
                continue
            if d["glac_id"] in want:
                glims_names.setdefault(d["glac_id"], nm)
            try:
                lon, lat = int(d["glac_id"][1:7]) / 1000, int(d["glac_id"][8:13]) / 1000
            except ValueError:
                continue
            if lo0 < lon < lo1 and la0 < lat < la1:
                near.append((lon, lat, nm))
    by_loc = {}
    for lon, lat, nm in near:
        k = math.cos(math.radians(lat))
        dist, j = min((((g["CenLon"] - lon) * k) ** 2 + (g["CenLat"] - lat) ** 2, j) for j, g in enumerate(gl))
        if dist < 0.0135 ** 2:  # ~1.5 km
            by_loc.setdefault(gl[j]["GLIMSId"], nm)
    for gid, nm in by_loc.items():
        glims_names.setdefault(gid, nm)
    print("GLIMS names found:", len(glims_names))


# ---------- PyGEM-OGGM: mass 2000-2100, 12 climate models ----------
def load(fn, var="glac_mass_annual"):
    d = netCDF4.Dataset(os.path.join(src_dir, fn))
    idx = {rid: i for i, rid in enumerate(d["RGIId"][:])}
    yrs = [int(y) for y in d["year"][:]]
    rows = [idx.get(g["RGIId"]) for g in gl]
    ok = [r for r in rows if r is not None]
    m = np.ma.filled(d[var][:], np.nan)[:, ok, :]  # (model, glacier, year); whole read is far faster than fancy indexing
    full = np.full((m.shape[0], len(gl), m.shape[2]), np.nan)
    full[:, [i for i, r in enumerate(rows) if r is not None], :] = m
    return full, yrs


mass, yrs = {}, None
for s in SCEN:
    mass[s], yrs = load(f"R13_glac_mass_annual_50sets_2000_2100-ssp{s}.nc")
mad, _ = load("R13_glac_mass_annual_mad_50sets_2000_2100-ssp245.nc", "glac_mass_annual_mad")
iy0, iy1, i2100 = yrs.index(Y0), yrs.index(Y1), yrs.index(2100)
A = np.array([g["Area"] for g in gl]) * 1e6  # m2

m = mass["245"]
rate = (m[:, :, iy1] - m[:, :, iy0]) / (RHO_W * A * (Y1 - Y0))       # per model, m w.e./yr
mb = np.nanmedian(rate, axis=0)
param_unc = np.nanmedian(mad[:, :, iy1], axis=0) / (RHO_W * A * (Y1 - Y0))
mbs = np.sqrt(np.nanstd(rate, axis=0) ** 2 + param_unc ** 2)
M0 = np.nanmedian(m[:, :, iy0], axis=0)
H = M0 / (RHO_ICE * A)                                               # mean ice thickness, m

fut = {}
for s in SCEN:
    med = np.nanmedian(mass[s], axis=0)                               # (glacier, year)
    left = med / med[:, [iy0]]
    gone = [None if not np.isfinite(left[i, iy0]) else next((yrs[j] for j in range(iy0, i2100 + 1) if left[i, j] < GONE), None)
            for i in range(len(gl))]
    fut[s] = dict(left=left[:, i2100], gone=gone, med=med)


def r(x, d):
    return None if x is None or not np.isfinite(x) else round(float(x), d)


cols = ["id", "lon", "lat", "area", "mb", "mbs", "dh", "dhs", "zmin", "zmax", "zmed", "slope", "aspect", "H", "name",
        "g126", "g245", "g585", "l126", "l245", "l585"]
rows = []
for i, g in enumerate(gl):
    name = clean_name(g["Name"]) or glims_names.get(g["GLIMSId"], "")
    rows.append([g["RGIId"][-5:], round(g["CenLon"], 4), round(g["CenLat"], 4), round(g["Area"], 3),
                 r(mb[i], 3), r(mbs[i], 3), r(mb[i] / RHO_DH * RHO_W, 3), r(mbs[i] / RHO_DH * RHO_W, 3),
                 g["Zmin"], g["Zmax"], g["Zmed"], g["Slope"], g["Aspect"], r(H[i], 0), name]
                + [fut[s]["gone"][i] for s in SCEN] + [r(100 * fut[s]["left"][i], 0) for s in SCEN])

# regional totals (Kyrgyzstan), from the median of the 12 climate models
ok = np.isfinite(M0)
meta = {"built": datetime.date.today().isoformat(), "y0": Y0, "y1": Y1, "gone": GONE, "nModels": int(m.shape[0]),
        "lossGt": r(float(np.nansum((mb * A * RHO_W)[ok])) * (Y1 - Y0) / 1e12, 2),
        "mass0Gt": r(float(np.nansum(M0)) / 1e12, 1), "scen": {}}
for s in SCEN:
    tot = np.nansum(fut[s]["med"][ok], axis=0)
    meta["scen"][s] = {"left2100": r(100 * tot[i2100] / tot[iy0], 0),
                       "left2050": r(100 * tot[yrs.index(2050)] / tot[iy0], 0),
                       "goneShare": r(100 * float(np.mean([fut[s]["gone"][i] is not None for i in np.flatnonzero(ok)])), 0)}

print(json.dumps(meta, indent=1))
print("glaciers missing from the model:", int((~ok).sum()))

assert len(rows) == len(gl) and all(len(x) == len(cols) for x in rows)
assert np.isfinite(mb).mean() > 0.95, "too many glaciers missing from the model"
out = ("/* Glacier data, only from NASA Earthdata glacier datasets: RGI 6.0 (NSIDC-0770), "
            "Global PyGEM-OGGM Glacier Projections (HMA2_GGP), GLIMS names (NSIDC-0272). Built by build_data.py on "
            f"{meta['built']}. */\nwindow.GG_DATA=" + json.dumps({"cols": cols, "meta": meta, "g": rows},
                                                                  separators=(",", ":")) + ";\n" + outline_js)
with open(os.path.join(here, "data.js"), "w") as f:  # write only after the whole file is built
    f.write(out)
print("wrote data.js:", len(rows), "glaciers,", sum(1 for x in rows if x[14]), "named")
