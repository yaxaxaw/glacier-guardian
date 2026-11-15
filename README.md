# Glacier Guardian Kyrgyzstan

NASA Space Apps Challenge 2026 · "Be an Earth System Trend Detective"

A trend-detective tool for Kyrgyzstan's mountains, built on a 3D map of all 7,447 glaciers.

**Trend detective (the core of the challenge):** answer three questions (where, what, which season) and the page builds a NASA MERRA-2 time series for 1980–2025, computes the rate of change and tests whether the trend is significant:
- linear regression slope with a 95% confidence interval and a t-test,
- Mann–Kendall trend test (the verdict uses p < 0.05),
- Sen's slope,
- the same variable and season compared across 7 regions, to show that one process can push regions in opposite directions,
- a table view and CSV download of every series shown,
- plain-language definitions of each variable and two demo walkthroughs.

Around it: the glacier map (click a glacier → "Trends in this area"), glacier facts and projections, and citizen-science tools.

**User journey:** SEE → TREND DETECTIVE → UNDERSTAND → FUTURE → HELP → JOIN

## Run it
- **With accounts (full site):** `python3 server.py`, then open http://localhost:8000. Only the Python standard library is needed.
  - Users sign up / sign in (top-right button) and send glacier photos + locations to their personal account.
  - Passwords are stored as PBKDF2-SHA256 hashes with a per-user salt; sessions are HttpOnly cookies (30 days).
  - Data lives in `server_data/` (`gg.db` SQLite + `photos/`). It is never served to the browser; back it up, and don't upload it anywhere public.
  - Each user sees only their own observations and photos.
  - Before running it on the public internet: put it behind HTTPS (e.g. a reverse proxy) and add rate limiting of sign-in attempts.
- **Quick look without accounts:** double-click `index.html`. Everything works except sending observations, which needs `server.py`.
- **Publish on GitHub Pages (static, no accounts):**
  1. Create a public repository and upload `index.html`, `app.js`, `data.js`, `trends.js`, `stats.js`, `i18n.js`, `README.md` and the `assets` folder.
  2. In the repository, go to Settings → Pages → Source: "Deploy from a branch", choose `main` and `/ (root)`, then Save.
  3. After about a minute the site is live at `https://<user>.github.io/<repo>/`.
- **Deep link to a glacier:** `index.html#g-18096` opens Abramov (the number is the RGI60-13.xxxxx ID).

## Data
### Trend detective: NASA MERRA-2 monthly (also available in [Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/))
| Variable | Collection |
|---|---|
| Air temperature at 2 m (T2M) | M2TMNXSLV ([doi](https://doi.org/10.5067/AP1B0BA5PD2K)) |
| Precipitation (PRECTOTCORR) | M2TMNXFLX ([doi](https://doi.org/10.5067/0JRLVL8YV2Y4)) |
| Snow water (SNOMAS), snow cover (FRSNO) | M2TMNXLND ([doi](https://doi.org/10.5067/8S35XF81C28F)) |
| Glacier runoff (RUNOFF), glacier albedo (SNICEALB), Alay only | M2TMNXGLC ([doi](https://doi.org/10.5067/5W8Q3I9WUFGX)) |

Rebuild `trends.js`: `python3 fetch_trends.py <cache_folder>` (Earthdata login in `~/.netrc`; downloads only a small box over Kyrgyzstan from NASA's cloud OPeNDAP, ~2,200 files of ~30 KB). Check the statistics: `node stats.test.js`.

### Glacier map: NASA Earthdata glacier datasets
All glacier numbers come from datasets listed on [NASA Earthdata: Glaciers data access and tools](https://www.earthdata.nasa.gov/topics/cryosphere/glaciers/data-access-tools#toc-glaciers-datasets).

| What | Dataset |
|---|---|
| 7,447 glaciers inside Kyrgyzstan, area, elevation, slope, aspect, names | Randolph Glacier Inventory 6.0, NASA NSIDC (NSIDC-0770, [doi](https://doi.org/10.7265/4m1f-gd79)) |
| Extra glacier names | GLIMS Glacier Database, NASA NSIDC (NSIDC-0272, [doi](https://doi.org/10.7265/N5V98602)) |
| Mass change 2000–2020, mean ice thickness, year a glacier is almost gone, scenarios SSP1-2.6 / 2-4.5 / 5-8.5 | Global PyGEM-OGGM Glacier Projections, NASA NSIDC (HMA2_GGP, [doi](https://doi.org/10.5067/P8BN9VO9N5C7)) |

Map background only (not glacier data): NASA GIBS imagery (Landsat WELD, HLS, ASTER GDEM relief) and AWS Terrain Tiles for 3D relief.

### Rebuild data.js
1. Get a free [Earthdata login](https://urs.earthdata.nasa.gov/users/new) and download into one folder: `nsidc0770_13.rgi60.CentralAsia.zip` (RGI 6.0), `R13_glac_mass_annual_50sets_2000_2100-ssp126.nc`, `-ssp245.nc`, `-ssp585.nc`, `R13_glac_mass_annual_mad_50sets_2000_2100-ssp245.nc` (HMA2_GGP) optionally the GLIMS `glims_db_north` zip renamed to `glims_north.zip`.
2. `pip install numpy netCDF4 pyshp`, then `python3 build_data.py <folder>`.

Honest limits are shown on the site itself:
- Past mass change is a model result (PyGEM-OGGM, calibrated on satellite elevation change), not a direct measurement. For small glaciers the uncertainty is often larger than the change; the panel flags this.
- MERRA-2 is a ~50 km model grid, so each region is the average of 1–3 grid cells, not a single valley or glacier. Glacier variables exist only for the Alay, where MERRA-2 marks glaciated surface.
- "Almost gone" means less than 10% of the year-2000 ice is left in the model (median of 12 climate models).
- The impact tracker counts only real actions recorded on the platform. It does not estimate ecological effect.

## Demo mode
Observations, photos and initiatives are stored in the visitor's browser (localStorage + IndexedDB). Teams can combine data with **Export / Import (JSON)**. Next step: a shared backend (for example Supabase or Firebase) so everyone sees the same community data.

## Files
- `index.html`: layout and styles
- `assets/mountains.webp`: page background photo
- `app.js`: map, glacier panel, then/now slider, trend detective, citizen science, community, impact tracker
- `stats.js`: regression, t-test, Mann–Kendall, Sen's slope; `stats.test.js` checks them
- `trends.js`: MERRA-2 monthly series per region, generated by `fetch_trends.py`
- `i18n.js`: Russian and English text, list of sources
- `data.js`: 7,447 glaciers, generated by `build_data.py` from the datasets above
- `build_data.py`: rebuilds `data.js` from the NASA files

NASA does not endorse this project.

## Team
Built together by the whole team for NASA Space Apps 2026, challenge "Be An Earth System Trend Detective":

- [yaxaxaw](https://github.com/yaxaxaw)
- [AbdrasulovAdilet](https://github.com/AbdrasulovAdilet)
- [abdykadyrturduev](https://github.com/abdykadyrturduev)
- [aidartakenov](https://github.com/aidartakenov)
- [Kutman (ksulaimanov)](https://github.com/ksulaimanov)
- [rus5sp](https://github.com/rus5sp)
