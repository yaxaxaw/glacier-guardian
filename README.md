# Glacier Guardian Kyrgyzstan

**NASA Space Apps Challenge 2026 · "Be An Earth System Trend Detective"**

**Live demo: https://yaxaxaw.github.io/glacier-guardian/**

Pick a place in Kyrgyzstan's mountains, a climate variable and a season. Glacier Guardian builds a 1980–2025 time series from NASA MERRA-2 data, measures how fast it is changing and tests whether the trend is real or could be chance. Around this Trend Detective: a 3D map of all 7,447 glaciers of Kyrgyzstan, their ice loss and projections to 2100, and personal accounts for sending glacier photos and locations.

All data comes from NASA Earthdata. The interface is in Russian and English (RU / EN switch, top right).

---

## For judges: try it in 2 minutes

1. Open the **[live demo](https://yaxaxaw.github.io/glacier-guardian/)** (or run it locally, see below) and switch to **EN** in the top-right corner.
2. Click **"Trend detective"** in the menu, then **"▶ Demo 1"**. It sets *Ala-Archa · Air temperature · Spring* and walks you through the result step by step.
3. Read the **Verdict**: the rate of change per decade (Sen's slope) and whether it is significant (Mann–Kendall test, p < 0.05). Below it, the **region comparison** runs the same test for all 7 regions.
4. Try **"▶ Demo 2"**: winter snow cover grows in the inner Tien Shan but shrinks in the Alay. Same climate, opposite trends, both significant.
5. Scroll back up to the **map** and click any glacier. The panel shows its ice loss and future; **"Trends in this area"** opens the detective for the nearest region.
6. *(Local run only)* Click **"Sign in"**, create an account and send an observation with a photo in the **"Join"** section.

---

## Run it locally

### What you need
- **Python 3.7 or newer.** Nothing to install with pip: the server uses only the standard library.
  Check it: `python3 --version` (on Windows: `py --version`).
- **Internet connection.** The map library and NASA satellite tiles load from the web.
- *(Optional)* **Node.js**, only to run the statistics tests.

### Copy, paste, run

Paste the whole block into a terminal. It downloads the project, creates a clean Python environment, installs the requirements and starts the site.

**macOS / Linux**

```bash
git clone https://github.com/yaxaxaw/glacier-guardian.git
cd glacier-guardian
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

**Windows (PowerShell or Command Prompt)**

```powershell
git clone https://github.com/yaxaxaw/glacier-guardian.git
cd glacier-guardian
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python server.py
```

The terminal prints `Glacier Guardian: http://localhost:8000`. Open **http://localhost:8000** in your browser. That's it: the full site, including sign-up, sign-in and photo uploads, now works on your computer.

The site needs no third-party packages, so the install step finishes in a second ([requirements.txt](requirements.txt) explains why). Next time, start it with the last line only: `.venv/bin/python server.py` (Windows: `.venv\Scripts\python server.py`).

No `git`? Download the ZIP from GitHub (**Code → Download ZIP**), unpack it, open a terminal in that folder and run the last three lines.

To stop the server, press **Ctrl + C** in the terminal.

### If something goes wrong

| Problem | Fix |
|---|---|
| `Address already in use` | Port 8000 is busy. Run `python3 server.py 8080` and open http://localhost:8080 |
| `python3: command not found` | Install Python from [python.org](https://www.python.org/downloads/). On Windows try `py` instead of `python3` |
| The map is grey or empty | Check the internet connection: map tiles come from NASA GIBS |
| Old version of the page after an update | Hard-reload the page: **Cmd + Shift + R** (Mac) or **Ctrl + F5** (Windows) |

### Without Python
Double-click `index.html`. The map and the Trend Detective work. Sign-in is hidden, because accounts need `server.py`. The live demo on GitHub Pages works the same way.

### Run the statistics tests

```bash
node stats.test.js
```

The tests check every statistical function against textbook values. They print `stats.js: all checks passed`.

---

## What it does

### Trend Detective (the core of the challenge)
- **3 questions.** *Where?* 7 glacier regions of the Tien Shan and Pamir-Alay. *What?* Air temperature, precipitation, snow water, snow cover, glacier runoff, glacier albedo. *When?* The whole year or one season.
- **Time series 1980–2025.** Monthly NASA MERRA-2 values are averaged into one value per year for the chosen season. Winter (DJF) uses December of the previous year.
- **Three tests side by side:**
  - **Sen's slope** is the headline number: the median slope between all pairs of years, robust to single unusual years.
  - **Mann–Kendall test** gives the verdict at p < 0.05. It does not assume a straight line or a normal distribution.
  - **Linear regression** with a t-test and 95% confidence interval is shown for comparison. When it disagrees with Sen's slope, the series has outliers. Example from Demo 2: one unusual winter in Naryn (2022).
- **Plain-language verdict**, a definition of every variable, the stated limitations, a table view and **CSV download** of every series shown.
- **Region comparison**: the same variable and season tested in all 7 regions.

### Glacier map
- A 3D map with all **7,447 glaciers** inside Kyrgyzstan (RGI 6.0, names from GLIMS), over NASA GIBS satellite imagery.
- For each glacier: area, elevation, mass change 2000–2020 and projections to 2100 under three emission scenarios (PyGEM-OGGM).
- Then / now comparison with NASA imagery and a deep link to every glacier, for example [`#g-18096`](https://yaxaxaw.github.io/glacier-guardian/#g-18096) opens Abramov.

### Accounts and citizen science
- Sign up and sign in with email and password.
- Send a glacier photo with its location (GPS, map click or coordinates). It is matched to the nearest glacier and can be compared with NASA imagery of the same spot.
- Each user sees only their own observations.

---

## Data: all from NASA Earthdata

### Trend Detective: NASA MERRA-2 monthly (also available in [Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/))
| Variable | Collection |
|---|---|
| Air temperature at 2 m (T2M) | M2TMNXSLV ([doi](https://doi.org/10.5067/AP1B0BA5PD2K)) |
| Precipitation (PRECTOTCORR) | M2TMNXFLX ([doi](https://doi.org/10.5067/0JRLVL8YV2Y4)) |
| Snow water (SNOMAS), snow cover (FRSNO) | M2TMNXLND ([doi](https://doi.org/10.5067/8S35XF81C28F)) |
| Glacier runoff (RUNOFF), glacier albedo (SNICEALB), Alay only | M2TMNXGLC ([doi](https://doi.org/10.5067/5W8Q3I9WUFGX)) |

### Glaciers: datasets listed on [NASA Earthdata: Glaciers data access and tools](https://www.earthdata.nasa.gov/topics/cryosphere/glaciers/data-access-tools#toc-glaciers-datasets)
| What | Dataset |
|---|---|
| 7,447 glaciers inside Kyrgyzstan: outline, area, elevation, slope, aspect, names | Randolph Glacier Inventory 6.0, NASA NSIDC (NSIDC-0770, [doi](https://doi.org/10.7265/4m1f-gd79)) |
| Extra glacier names | GLIMS Glacier Database, NASA NSIDC (NSIDC-0272, [doi](https://doi.org/10.7265/N5V98602)) |
| Mass change 2000–2020, ice thickness, year a glacier is almost gone, scenarios SSP1-2.6 / 2-4.5 / 5-8.5 | Global PyGEM-OGGM Glacier Projections, NASA NSIDC (HMA2_GGP, [doi](https://doi.org/10.5067/P8BN9VO9N5C7)) |

Map background only (not used as data): NASA GIBS imagery (Landsat WELD, HLS, ASTER GDEM relief) and AWS Terrain Tiles for 3D relief.

### Limitations (also shown on the site)
- MERRA-2 is a ~50 km model grid, so each region is the average of 1–3 grid cells, not a single valley. Glacier variables exist only for the Alay, where MERRA-2 marks glaciated surface.
- The tests assume neighbouring years are independent. Strong autocorrelation can make p too small.
- Past glacier mass change is a model result (PyGEM-OGGM, calibrated on satellite elevation change), not a direct measurement. For small glaciers the uncertainty is often larger than the change, and the panel says so.
- "Almost gone" means less than 10% of the year-2000 ice is left in the model (median of 12 climate models).

### Rebuild the data yourself
Both scripts need a free [Earthdata login](https://urs.earthdata.nasa.gov/users/new) saved in `~/.netrc`.

- **`trends.js`:** `python3 fetch_trends.py <cache_folder>`. It downloads only a small box over Kyrgyzstan from NASA's cloud OPeNDAP, about 2,200 files of ~30 KB.
- **`data.js`:**
  1. Download into one folder:
     - `nsidc0770_13.rgi60.CentralAsia.zip` (RGI 6.0)
     - `R13_glac_mass_annual_50sets_2000_2100-ssp126.nc`, `-ssp245.nc`, `-ssp585.nc`, `R13_glac_mass_annual_mad_50sets_2000_2100-ssp245.nc` (HMA2_GGP)
     - optionally the GLIMS `glims_db_north` zip, renamed to `glims_north.zip`
  2. Install the exact package versions the data was built with: `python -m pip install -r requirements-data.txt` (numpy 2.0.2, netCDF4 1.7.2, cftime 1.6.4.post1, pyshp 3.1.8; tested on Python 3.9). Then run `python3 build_data.py <folder>`.

---

## How it is built

| Part | Technology |
|---|---|
| Web page | HTML, CSS, JavaScript; [MapLibre GL](https://maplibre.org/) for the 3D map; NASA GIBS WMTS tiles |
| Statistics | Written from scratch in JavaScript (`stats.js`), checked by `stats.test.js` |
| Data pipeline | Python, NumPy, netCDF4, pyshp; NASA CMR search, OPeNDAP subsetting, Earthdata Login |
| Server and accounts | Python standard library + SQLite (`server.py`) |

### Files
- `index.html`: layout and styles
- `app.js`: map, glacier panel, Trend Detective, accounts, observations
- `stats.js`: Sen's slope, Mann–Kendall, regression with t-test; `stats.test.js` checks them
- `i18n.js`: Russian and English text, list of sources
- `server.py`: serves the site and the account API
- `requirements.txt`: packages to run the site (none, standard library only)
- `requirements-data.txt`: pinned packages for the data scripts
- `trends.js`: MERRA-2 series per region, made by `fetch_trends.py`
- `data.js`: 7,447 glaciers, made by `build_data.py`
- `assets/mountains.webp`: background photo

### Security of accounts
- Passwords are stored only as PBKDF2-SHA256 hashes with a per-user salt. Sessions use HttpOnly cookies (30 days).
- Requests from other websites are rejected.
- User data lives in `server_data/` (SQLite database + photos). It is never served to the browser and is excluded from git.
- Before running on the public internet: put the server behind HTTPS and add a limit on sign-in attempts.

---

## Team
Built together by the whole team for NASA Space Apps 2026:

- [yaxaxaw](https://github.com/yaxaxaw)
- [AbdrasulovAdilet](https://github.com/AbdrasulovAdilet)
- [abdykadyrturduev](https://github.com/abdykadyrturduev)
- [aidartakenov](https://github.com/aidartakenov)
- [Kutman (ksulaimanov)](https://github.com/ksulaimanov)
- [rus5sp](https://github.com/rus5sp)

NASA does not endorse this project.
