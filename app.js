/* Glacier Guardian Kyrgyzstan — application logic.
   Data: window.GG_DATA (built by build_data.py from RGI 6.0, PyGEM-OGGM HMA2_GGP and GLIMS), window.KG_OUTLINE. */
(() => {
"use strict";

/* ---------- data ---------- */
const COLS = GG_DATA.cols;
const G = GG_DATA.g.map(r => { const o = {}; COLS.forEach((c, i) => o[c] = r[i]); o.rgi = "RGI60-13." + o.id; return o; });
const byId = new Map(G.map(g => [g.id, g]));
const robust = g => g.mb != null && g.mbs != null && Math.abs(g.mb) > 2 * g.mbs;
const TOTAL_AREA = G.reduce((s, g) => s + g.area, 0);
const SC = ["126", "245", "585"]; // SSP1-2.6, SSP2-4.5, SSP5-8.5
const META = GG_DATA.meta, YRS = META.y1 - META.y0;
const THINNING_SHARE = G.filter(g => g.mb < 0).length / G.length;

/* ---------- i18n ---------- */
let LANG = (() => { try { return localStorage.getItem("gg-lang") || ((navigator.language || "").startsWith("ru") ? "ru" : "en"); } catch (e) { return "ru"; } })();
if (!I18N[LANG]) LANG = "ru";
const t = k => I18N[LANG][k];
const nf = (x, d = 1) => (x == null || !isFinite(x)) ? "–" : x.toLocaleString(LANG === "ru" ? "ru-RU" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (x, d = 2) => (x > 0 ? "+" : "") + nf(x, d);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gname = g => g.name || t("unnamed");
const aspectName = a => { if (a == null) return "–"; const ru = ["С","СВ","В","ЮВ","Ю","ЮЗ","З","СЗ"], en = ["N","NE","E","SE","S","SW","W","NW"]; return (LANG === "ru" ? ru : en)[Math.round(((a % 360) / 45)) % 8]; };

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("gg-" + k)) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("gg-" + k, JSON.stringify(v)); } catch (e) { console.warn("storage", e); } }
};
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { try { const r = indexedDB.open("gg-photos", 1); r.onupgradeneeded = () => r.result.createObjectStore("p"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const s = db.transaction("p", mode).objectStore("p"); const q = fn(s); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  return { put: (k, v) => tx("readwrite", s => s.put(v, k)).catch(() => null), get: k => tx("readonly", s => s.get(k)).catch(() => null), del: k => tx("readwrite", s => s.delete(k)).catch(() => null) };
})();
let OBS = store.get("obs", []), INI = store.get("ini", []), ADOPT = store.get("adopt", []), JOINED = store.get("joined", []);
const save = () => { store.set("obs", OBS); store.set("ini", INI); store.set("adopt", ADOPT); store.set("joined", JOINED); };

/* ---------- NASA GIBS tiles ---------- */
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
const weldURL = yr => `${GIBS}Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/${yr}-12-01/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg`;
const hlsURL = d => `${GIBS}HLS_L30_Nadir_BRDF_Adjusted_Reflectance/default/${d}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`;
const modisURL = d => `${GIBS}MODIS_Terra_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const reliefURL = `${GIBS}ASTER_GDEM_Color_Shaded_Relief/default/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg`;
const fill = (u, z, x, y) => u.replace("{z}", z).replace("{x}", x).replace("{y}", y);
const lonlat2px = (lon, lat, z) => { const n = 256 * 2 ** z, r = lat * Math.PI / 180; return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n]; };
const zoomFor = a => a > 60 ? 10 : a > 8 ? 11 : 12;

function mosaic(urlTpl, lon, lat, z, box) {
  const [px, py] = lonlat2px(lon, lat, z);
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const el = document.createElement("div"); el.className = "mosaic";
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const im = new Image(); im.alt = ""; im.loading = "lazy"; im.src = fill(urlTpl, z, tx + i, ty + j); im.onerror = () => { im.style.visibility = "hidden"; }; el.appendChild(im); }
  const s = box / 512; // show a 512 px window
  el.style.transformOrigin = "0 0";
  el.style.transform = `translate(${box / 2 - (px - (tx - 1) * 256) * s}px, ${box / 2 - (py - (ty - 1) * 256) * s}px) scale(${s})`;
  return el;
}

const hlsCache = new Map();
async function bestHLS(lon, lat, z) {
  const key = `${lon.toFixed(2)},${lat.toFixed(2)},${z}`;
  if (hlsCache.has(key)) return hlsCache.get(key);
  const [px, py] = lonlat2px(lon, lat, z), tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  let best = null;
  for (const yr of [2025, 2024, 2023]) {
    const dates = []; for (let m = 7; m <= 9; m++) for (let d = 2; d <= 30; d += 3) dates.push(`${yr}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    for (let i = 0; i < dates.length; i += 8) {
      const res = await Promise.all(dates.slice(i, i + 8).map(async d => { try { const r = await fetch(fill(hlsURL(d), z, tx, ty)); if (!r.ok) return [d, 0]; return [d, (await r.blob()).size]; } catch (e) { return [d, 0]; } }));
      for (const [d, s] of res) if (!best || s > best.size) best = { date: d, size: s };
    }
    if (best && best.size > 30000) break;
  }
  const out = best && best.size > 8000 ? best.date : null;
  hlsCache.set(key, out); return out;
}

function compareWidget(lon, lat, area) {
  const wrap = document.createElement("div");
  const z = zoomFor(area);
  wrap.innerHTML = `<div class="yearbtns" role="group"><button type="button" class="btn small" data-y="1990" aria-pressed="false">1990</button><button type="button" class="btn small" data-y="2000" aria-pressed="true">2000</button></div>
    <div class="compare"><div class="layer bot"></div><div class="layer top"></div><div class="handle" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div><span class="tag l"></span><span class="tag r"></span><span class="pin"></span></div>
    <p class="note">${t("satNote")}</p>`;
  const cmp = wrap.querySelector(".compare"), bot = wrap.querySelector(".bot"), top = wrap.querySelector(".top"), h = wrap.querySelector(".handle"), tl = wrap.querySelector(".tag.l"), tr = wrap.querySelector(".tag.r");
  let year = 2000;
  const draw = () => { const W = cmp.clientWidth || 420; bot.innerHTML = ""; bot.appendChild(mosaic(weldURL(year), lon, lat, z, W)); tl.textContent = `Landsat WELD · ${year}`; };
  requestAnimationFrame(draw);
  tr.textContent = t("loadingNow");
  bestHLS(lon, lat, z).then(d => {
    const W = cmp.clientWidth || 420; top.innerHTML = "";
    if (d) { top.appendChild(mosaic(hlsURL(d), lon, lat, z, W)); tr.textContent = `HLS · ${d}`; }
    else { const zz = Math.min(z, 9); top.appendChild(mosaic(modisURL("2025-08-20"), lon, lat, zz, W)); tr.textContent = "MODIS · 2025-08-20"; tr.title = t("noNow"); }
  });
  wrap.querySelectorAll("[data-y]").forEach(b => b.onclick = () => { year = +b.dataset.y; wrap.querySelectorAll("[data-y]").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); });
  const setPos = p => { p = Math.max(0, Math.min(100, p)); top.style.clipPath = `inset(0 0 0 ${p}%)`; h.style.left = p + "%"; h.setAttribute("aria-valuenow", Math.round(p)); };
  let drag = false;
  const move = e => { if (!drag) return; const r = cmp.getBoundingClientRect(); setPos(((e.clientX ?? e.touches?.[0]?.clientX) - r.left) / r.width * 100); };
  cmp.addEventListener("pointerdown", e => { drag = true; cmp.setPointerCapture(e.pointerId); move(e); });
  cmp.addEventListener("pointermove", move); cmp.addEventListener("pointerup", () => drag = false);
  h.addEventListener("keydown", e => { const v = +h.getAttribute("aria-valuenow"); if (e.key === "ArrowLeft") setPos(v - 5); if (e.key === "ArrowRight") setPos(v + 5); });
  return wrap;
}

/* ---------- map ---------- */
const outline = { type: "Feature", geometry: KG_OUTLINE, properties: {} };
const glFeatures = { type: "FeatureCollection", features: G.map(g => ({ type: "Feature", id: +g.id, geometry: { type: "Point", coordinates: [g.lon, g.lat] }, properties: { id: g.id, area: g.area, mb: g.mb, name: g.name } })) };
const obsFC = () => ({ type: "FeatureCollection", features: OBS.map(o => ({ type: "Feature", geometry: { type: "Point", coordinates: [o.lon, o.lat] }, properties: { id: o.id } })) });

const AREA_R = ["interpolate", ["linear"], ["get", "area"], 0, 2, 1, 3.2, 10, 6, 100, 11, 380, 17];
let map, is3D = true, base = "land", pickMode = false;
function initMap() {
  if (!window.maplibregl) { document.getElementById("map").innerHTML = '<p style="padding:20px">Map library failed to load. Check your internet connection.</p>'; return; }
  map = new maplibregl.Map({
    container: "map", center: [75.2, 41.45], zoom: 6.2, pitch: 50, bearing: -8, maxPitch: 75, attributionControl: false,
    style: {
      version: 8, glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        weld: { type: "raster", tiles: [weldURL(2000)], tileSize: 256, maxzoom: 12, attribution: "NASA GIBS · Landsat WELD" },
        relief: { type: "raster", tiles: [reliefURL], tileSize: 256, maxzoom: 12, attribution: "NASA GIBS · ASTER GDEM" },
        dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 13, attribution: "Terrain: AWS Terrain Tiles (SRTM)" },
        kg: { type: "geojson", data: outline },
        gl: { type: "geojson", data: glFeatures },
        obs: { type: "geojson", data: obsFC() }
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0b1520" } },
        { id: "weld", type: "raster", source: "weld", paint: { "raster-saturation": -0.1, "raster-contrast": 0.1 } },
        { id: "relief", type: "raster", source: "relief", layout: { visibility: "none" } },
        { id: "hill", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0b1520" } },
        { id: "kg-line", type: "line", source: "kg", paint: { "line-color": "#7fd8f0", "line-width": 1.6, "line-opacity": 0.85 } },
        { id: "gl", type: "circle", source: "gl", filter: [">=", ["get", "area"], 0.5],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", 0.6, AREA_R], 9, ["*", 1.3, AREA_R], 13, ["*", 2.4, AREA_R]],
            "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "mb"], 0], -1, "#b2182b", -0.5, "#ef8a62", -0.2, "#fddbc7", 0, "#f2f2f2", 0.3, "#67a9cf"],
            "circle-stroke-color": ["case", ["boolean", ["feature-state", "sel"], false], "#7fd8f0", "#0b1520"],
            "circle-stroke-width": ["case", ["boolean", ["feature-state", "sel"], false], 3, 0.6], "circle-opacity": 0.92
          } },
        { id: "gl-name", type: "symbol", source: "gl", filter: ["!=", ["get", "name"], ""], minzoom: 7,
          layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
          paint: { "text-color": "#e8f1f7", "text-halo-color": "#0b1520", "text-halo-width": 1.4 } },
        { id: "obs", type: "circle", source: "obs", paint: { "circle-radius": 7, "circle-color": "#7fd8f0", "circle-stroke-color": "#06202b", "circle-stroke-width": 2 } }
      ]
    }
  });
  let demFails = 0;
  map.on("error", e => { if (e && e.sourceId === "dem" && ++demFails === 3 && is3D) { console.warn("Terrain tiles unavailable, switching to 2D"); set3D(false); } });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.on("load", () => { map.setTerrain({ source: "dem", exaggeration: 1.4 }); try { map.setSky({ "sky-color": "#0f2a40", "horizon-color": "#28506c", "fog-color": "#0b1520", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.6 }); } catch (e) {} });
  const pop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  map.on("mousemove", "gl", e => { map.getCanvas().style.cursor = "pointer"; const g = byId.get(e.features[0].properties.id); pop.setLngLat([g.lon, g.lat]).setHTML(`<b>${esc(gname(g))}</b><br>${nf(g.area, 2)} km² · <span class="mono">${sgn(g.mb)} ${t("mwe")}</span>`).addTo(map); });
  map.on("mouseleave", "gl", () => { map.getCanvas().style.cursor = ""; pop.remove(); });
  map.on("click", e => {
    if (pickMode) { setObsLoc(e.lngLat.lat, e.lngLat.lng); togglePick(false); document.getElementById("science").scrollIntoView(); return; }
    const f = map.queryRenderedFeatures(e.point, { layers: ["gl"] })[0];
    if (f) openGlacier(f.properties.id, false);
  });
  map.on("click", "obs", e => { const o = OBS.find(x => x.id === e.features[0].properties.id); if (o) openCompare(o); });
}
function setBase(b) { base = b; if (!map) return; map.setLayoutProperty("weld", "visibility", b === "land" ? "visible" : "none"); map.setLayoutProperty("relief", "visibility", b === "relief" ? "visible" : "none"); paintControls(); }
function set3D(on) { is3D = on; if (!map) return; if (on) { map.setTerrain({ source: "dem", exaggeration: 1.4 }); map.easeTo({ pitch: 55 }); } else { map.setTerrain(null); map.easeTo({ pitch: 0, bearing: 0 }); } paintControls(); }
function paintControls() {
  const L = document.getElementById("bm-land"), R = document.getElementById("bm-relief"), D = document.getElementById("bm-3d");
  L.textContent = t("land"); R.textContent = t("relief"); D.textContent = is3D ? t("d3off") : t("d3on");
  L.setAttribute("aria-pressed", base === "land"); R.setAttribute("aria-pressed", base === "relief");
}
let selId = null;
function select(id) { if (!map) return; if (selId != null) map.setFeatureState({ source: "gl", id: +selId }, { sel: false }); selId = id; if (id != null) map.setFeatureState({ source: "gl", id: +id }, { sel: true }); }
function flyTo(g) { if (!map) return; const z = g.area > 60 ? 10.2 : g.area > 8 ? 11.5 : 12.6; map.flyTo({ center: [g.lon, g.lat], zoom: z, pitch: is3D ? 62 : 0, bearing: map.getBearing(), speed: 1.2, essential: true }); }

/* ---------- glacier panel ---------- */
let openId = null;
function openGlacier(id, fly = true) {
  const g = byId.get(id); if (!g) return;
  openId = id; select(id); if (fly) flyTo(g);
  const P = document.getElementById("panel");
  const rb = robust(g), dir = g.mb < 0 ? "loss" : "gain";
  const water = Math.abs(g.mb * g.area * 1e6 * YRS); // m3 water over the model's past window
  const adopted = ADOPT.includes(id);
  P.innerHTML = `<div class="head"><button type="button" class="btn small close" id="pclose" aria-label="${t("close")}">✕</button>
      <h2>${esc(gname(g))}</h2><div class="sub mono">${g.rgi} · ${nf(g.lat, 3)}° N, ${nf(g.lon, 3)}° E</div></div>
    <section><h3>${t("p_change")}</h3>
      <div class="big"><b style="color:${g.mb < 0 ? "var(--loss)" : "var(--gain)"}">${sgn(g.dh)} ${t("perYr")}</b><span class="pill ${rb ? dir : "unc"}">${rb ? t(dir) : t("conf_lo")}</span></div>
      <div class="kv" style="margin-top:10px">
        <div>${t("mbLabel")}<b>${sgn(g.mb)} ± ${nf(g.mbs, 2)}</b>${t("mwe")}</div>
        <div>${t("total18")}<b>${sgn(g.dh * YRS, 1)} m</b></div>
        <div>${t("water")}<b>${nf(water / 1e6, 1)} ${t("mln")}</b>≈ ${nf(water / 2500, 0)} ${t("pools")}</div>
        <div>${rb ? t("conf_hi") : t("conf_lo")}<b style="font-size:13px;font-family:var(--body);font-weight:400;color:var(--muted)">${rb ? t("conf_hi_t") : t("conf_lo_t")}</b></div>
      </div>
      <p class="note">${t("model_note")} · ${t("pool_note")}</p></section>
    <section><h3>${t("p_sat")}</h3><div id="cmpSlot"></div></section>
    <section><h3>${t("p_size")}</h3><div class="kv">
      <div>${t("area")}<b>${nf(g.area, 2)} km²</b></div>
      <div>${t("elev")}<b>${nf(g.zmin, 0)}–${nf(g.zmax, 0)} m</b></div>
      <div>${t("elevMed")}<b>${nf(g.zmed, 0)} m</b></div>
      <div>${t("slope")} / ${t("aspect")}<b>${nf(g.slope, 0)}° · ${aspectName(g.aspect)}</b></div>
      ${g.H ? `<div>${t("thick")}<b>${nf(g.H, 0)} m</b>PyGEM-OGGM</div>` : ""}
    </div></section>
    <section><h3>${t("p_future")}</h3><div class="kv">${SC.map(s => `<div>${t("scen_" + s)}<b>${g["g" + s] ? t("fut_by")(g["g" + s]) : g["l" + s] != null ? t("fut_after") : "–"}</b>${g["l" + s] != null ? t("fut_left")(nf(g["l" + s], 0)) : ""}</div>`).join("")}</div><p class="note">${t("fut_note")}</p></section>
    <section><h3>${t("p_risk")}</h3><ul style="margin:0;padding-left:18px;font-size:14px">${t("risk_list").map(x => `<li>${x}</li>`).join("")}</ul><p class="note">${t("risk_note")}</p></section>
    <section><h3>${t("p_act")}</h3><div class="cta">
      <button type="button" class="btn ${adopted ? "" : "primary"}" id="pAdopt">${adopted ? t("act_adopted") : t("act_adopt")}</button>
      <button type="button" class="btn" id="pTrend">📈 ${t("act_trend")}</button>
      <button type="button" class="btn" id="pObs">${t("act_obs")}</button>
      <button type="button" class="btn" id="pIni">${t("act_ini")}</button>
    </div></section>`;
  P.classList.add("open");
  document.getElementById("cmpSlot").appendChild(compareWidget(g.lon, g.lat, g.area));
  document.getElementById("pclose").onclick = closePanel;
  document.getElementById("pAdopt").onclick = () => { if (ADOPT.includes(id)) ADOPT = ADOPT.filter(x => x !== id); else ADOPT.push(id); save(); renderImpact(); openGlacier(id, false); };
  document.getElementById("pTrend").onclick = () => detectiveNear(g);
  document.getElementById("pObs").onclick = () => { setObsLoc(g.lat, g.lon); document.getElementById("science").scrollIntoView(); };
  document.getElementById("pIni").onclick = () => { const f = document.getElementById("iniForm"); f.elements.glacier.value = id; f.elements.title.focus(); document.getElementById("community").scrollIntoView(); };
}
function closePanel() { document.getElementById("panel").classList.remove("open"); openId = null; select(null); }

/* ---------- search ---------- */
function initSearch() {
  const q = document.getElementById("q"), ul = document.getElementById("qres");
  q.oninput = () => {
    const s = q.value.trim().toLowerCase(); if (s.length < 2) { ul.style.display = "none"; return; }
    const hits = G.filter(g => (g.name && g.name.toLowerCase().includes(s)) || g.rgi.toLowerCase().includes(s) || g.id.includes(s)).sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || b.area - a.area).slice(0, 12);
    ul.innerHTML = hits.map(g => `<li role="option" data-id="${g.id}">${esc(gname(g))} <span class="mono" style="color:var(--muted)">· ${nf(g.area, 1)} km² · ${g.rgi}</span></li>`).join("") || `<li>—</li>`;
    ul.style.display = "block";
    ul.querySelectorAll("li[data-id]").forEach(li => li.onclick = () => { ul.style.display = "none"; q.value = ""; openGlacier(li.dataset.id); });
  };
  q.onkeydown = e => { if (e.key === "Enter") { const li = ul.querySelector("li[data-id]"); if (li) li.click(); } if (e.key === "Escape") ul.style.display = "none"; };
}

/* ---------- static sections ---------- */
function renderStatic() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-t]").forEach(e => { const v = t(e.dataset.t); if (typeof v === "string") e.innerHTML = v; });
  document.getElementById("journey").innerHTML = t("journey").map(([id, l]) => `<a href="#${id}">${l}</a>`).join("");
  document.getElementById("l-ru").setAttribute("aria-pressed", LANG === "ru"); document.getElementById("l-en").setAttribute("aria-pressed", LANG === "en");
  document.getElementById("stats").innerHTML = `<div><b>${nf(G.length, 0)}</b><span>${t("st_n")}</span></div><div><b>${nf(TOTAL_AREA, 0)}</b><span>${t("st_a")}</span></div><div><b class="loss">${nf(Math.abs(META.lossGt), 1)}</b><span>${t("st_loss")}</span></div><div><b class="loss">${nf(THINNING_SHARE * 100, 0)}%</b><span>${t("st_thin")}</span></div>`;
  document.getElementById("q").placeholder = t("search");
  document.getElementById("legend").innerHTML = `${t("legendT")}<div class="bar"></div><div class="ticks"><span>−1</span><span>−0,5</span><span>0</span><span>+0,3</span></div><div style="margin-top:6px">${t("legendS")}</div>`;
  document.getElementById("pickhint").textContent = t("pickHint");
  document.getElementById("minareaV").textContent = nf(+document.getElementById("minarea").value, 1);
  document.getElementById("exportBtn").textContent = t("export");
  paintControls();
  document.getElementById("whyCards").innerHTML = t("why")(META, nf).map(([h, p, s]) => `<div class="card"><h3>${h}</h3><p>${p}</p><span class="src">${s}</span></div>`).join("");
  const famous = G.filter(g => g.name).sort((a, b) => b.area - a.area).slice(0, 12);
  document.getElementById("famous").innerHTML = famous.map(g => `<button type="button" class="card" style="text-align:left;cursor:pointer" data-id="${g.id}"><h3>${esc(g.name)}</h3><p class="mono" style="margin:0">${nf(g.area, 1)} km² · <span style="color:${g.mb < 0 ? "var(--loss)" : "var(--gain)"}">${sgn(g.mb)}</span> ${t("mwe")}</p></button>`).join("");
  document.querySelectorAll("#famous [data-id]").forEach(b => b.onclick = () => { document.getElementById("see").scrollIntoView(); openGlacier(b.dataset.id); });
  renderAcct(); renderFuture(); renderDetective(); renderActions(); renderObsForm(); renderObsList(); renderIniForm(); renderIniList(); renderImpact();
  document.getElementById("sources").innerHTML = SOURCES.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(n)}</a></li>`).join("");
  if (openId) openGlacier(openId, false);
}

function renderFuture() {
  const sel = G.filter(g => g.area >= 2 && g.mb != null);
  const bins = [0, 0, 0, 0]; sel.forEach(g => { const y = g.g245; bins[!y ? 3 : y < 2050 ? 0 : y < 2075 ? 1 : 2]++; });
  const mx = Math.max(...bins, 1);
  document.getElementById("histCard").innerHTML = `<h3>${t("hist_h")}</h3><p>${t("hist_p")(nf(sel.length, 0))}</p>
    <div class="hist">${bins.map((b, i) => `<div><em>${b}</em><i style="height:${(b / mx * 100).toFixed(0)}%;opacity:${1 - i * 0.18}"></i><span>${t("hist_bins")[i]}</span></div>`).join("")}</div>
    <span class="src">${t("hist_note")}</span>`;
  const sc = document.getElementById("scenCard");
  const drawScen = which => {
    const m = META.scen[which], remain = Math.round(m.left2100);
    sc.innerHTML = `<h3>${t("scen_h")}</h3><p>${t("scen_p")}</p>
      <div class="seg" role="group">${SC.map(s => `<button type="button" data-s="${s}" aria-pressed="${which === s}">${t("scen_" + s)}</button>`).join("")}</div>
      <div class="dots">${Array.from({ length: 100 }, (_, i) => `<i class="${i < remain ? "" : "gone"}"></i>`).join("")}</div>
      <p style="color:var(--ink)">${t("scen_txt")(nf(m.left2050, 0), nf(m.left2100, 0), nf(m.goneShare, 0))}</p><span class="src">${t("scen_dots")} · PyGEM-OGGM, NASA NSIDC doi:10.5067/P8BN9VO9N5C7</span>`;
    sc.querySelectorAll("[data-s]").forEach(b => b.onclick = () => drawScen(b.dataset.s));
  };
  drawScen("245");
}

function renderActions() {
  document.getElementById("actions").innerHTML = t("acts").map(([h, tag, p, steps, link]) => `<div class="card"><span class="tagline">${tag}</span><h3>${h}</h3><p>${p}</p><ol>${steps.map(s => `<li>${s}</li>`).join("")}</ol>${link ? `<p style="margin:12px 0 0"><a class="btn small" href="${link}" ${link.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>→</a></p>` : ""}</div>`).join("");
}

/* ---------- trend detective: variable + region + season -> time series, trend, significance ---------- */
const DV = ["T2M", "PRECTOTCORR", "SNOMAS", "FRSNO", "RUNOFF", "SNICEALB"];
const SEASONS = { year: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], djf: [12, 1, 2], mam: [3, 4, 5], jja: [6, 7, 8], son: [9, 10, 11] };
const DS = { region: "alaarcha", v: "T2M", season: "jja", narr: null };
// seasonal (or annual) mean per year; winter (DJF) takes December of the previous year
function seasonal(monthly, season) {
  const T = window.TRENDS, years = [], vals = [];
  for (let yr = T.y0; yr <= T.y1; yr++) {
    const idx = SEASONS[season].map(m => (season === "djf" && m === 12 ? yr - 1 - T.y0 : yr - T.y0) * 12 + m - 1);
    if (idx.some(i => i < 0)) continue;
    const v = idx.map(i => monthly[i]);
    years.push(yr); vals.push(v.some(x => x == null) ? null : v.reduce((a, b) => a + b, 0) / v.length);
  }
  return { years, vals };
}
const pTxt = p => p < 0.001 ? "p < " + nf(0.001, 3) : "p = " + nf(p, 3);
const level = p => p < 0.05 ? "sig" : p < 0.1 ? "weak" : "ns";
function renderDetective() {
  const T = window.TRENDS;
  if (!T || !window.STATS) { document.getElementById("detective").hidden = true; return; }
  const unit = v => T.units[v] ? " " + (t("units")[T.units[v]] || T.units[v]) : "";
  const dec = v => v === "SNICEALB" ? 3 : 2;
  const has = (r, v) => !!T.series[r][v];
  if (!has(DS.region, DS.v)) DS.v = DV.find(v => has(DS.region, v));
  const chip = (grp, val, label, on, dis) => `<button type="button" class="btn small" data-g="${grp}" data-v="${val}" aria-pressed="${on}"${dis ? " disabled" : ""}>${label}</button>`;
  document.getElementById("dRegion").innerHTML = Object.keys(T.series).map(r => chip("region", r, t("reg")[r], r === DS.region)).join("");
  document.getElementById("dVar").innerHTML = DV.map(v => chip("v", v, t("var")[v][0], v === DS.v, !has(DS.region, v))).join("");
  document.getElementById("dSeason").innerHTML = Object.keys(SEASONS).map(s => chip("season", s, t("sea")[s], s === DS.season)).join("");
  document.getElementById("dDef").innerHTML = `${t("var")[DS.v][1]} <span class="mono">${t("var")[DS.v][2]}</span>`;
  document.querySelectorAll("#detective [data-g]").forEach(b => b.onclick = () => { DS[b.dataset.g] = b.dataset.v; DS.narr = null; renderDetective(); });
  document.getElementById("dDemos").innerHTML = t("demos").map((d, i) => `<button type="button" class="btn" data-demo="${i}">▶ ${d.title}</button>`).join("");
  document.querySelectorAll("[data-demo]").forEach(b => b.onclick = () => { const d = t("demos")[+b.dataset.demo]; Object.assign(DS, d.set, { narr: +b.dataset.demo }); renderDetective(); document.getElementById("detective").scrollIntoView(); });
  const N = document.getElementById("dNarr");
  N.hidden = DS.narr == null; if (DS.narr != null) N.innerHTML = t("demos")[DS.narr].text;

  // series, statistics, chart
  const { years, vals } = seasonal(T.series[DS.region][DS.v], DS.season);
  const A = STATS.analyse(years, vals), V = DS.v;
  const ttl = `${t("var")[V][0]} · ${t("reg")[DS.region]} · ${t("sea")[DS.season]}`;
  if (!A) { document.getElementById("dChart").innerHTML = `<h3>${ttl}</h3><p>${t("d_nodata")}</p>`; document.getElementById("dVerdict").innerHTML = ""; return; }
  const narrow = matchMedia("(max-width:640px)").matches; // labels are 26px there, so leave room for them
  const W = 760, H = narrow ? 360 : 300, L = narrow ? 120 : 52, R = 14, Tp = narrow ? 40 : 16, B = narrow ? 44 : 30;
  const lo = Math.min(...A.y), hi = Math.max(...A.y), pad = (hi - lo) * 0.12 || 1, y0 = lo - pad, y1 = hi + pad;
  const x = yr => L + (yr - A.x[0]) / (A.x[A.n - 1] - A.x[0]) * (W - L - R), y = v => Tp + (y1 - v) / (y1 - y0) * (H - Tp - B);
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const fit = yr => A.senIcpt + A.sen * yr; // Sen line: robust to single unusual years
  const line = A.x.map((yr, i) => `${i ? "L" : "M"}${x(yr).toFixed(1)},${y(A.y[i]).toFixed(1)}`).join("");
  document.getElementById("dChart").innerHTML = `<h3>${ttl}</h3><div class="mchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ttl}">
    <g class="ax">${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${nf(v, dec(V) - 1)}</text>`).join("")}
      ${A.x.filter(yr => yr % 10 === 0).map(yr => `<text x="${x(yr)}" y="${H - 8}" text-anchor="middle">${yr}</text>`).join("")}<text x="${L}" y="${Tp - 4}" class="unit">${unit(V).trim()}</text></g>
    <path d="${line}" fill="none" stroke="var(--ice)" stroke-width="2"/>
    <line x1="${x(A.x[0])}" x2="${x(A.x[A.n - 1])}" y1="${y(fit(A.x[0]))}" y2="${y(fit(A.x[A.n - 1]))}" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 5"/>
    <text x="${x(A.x[A.n - 1]) - 4}" y="${y(fit(A.x[A.n - 1])) - 8}" text-anchor="end" class="unit" fill="var(--ink)">${t("d_trendLbl")}</text>
    <line class="xh" y1="${Tp}" y2="${H - B}" stroke="var(--muted)" visibility="hidden"/><circle class="xd" r="5" fill="var(--ice)" stroke="var(--bg)" stroke-width="2" visibility="hidden"/>
    <rect x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}" fill="transparent" class="hit"/></svg><div class="tip" hidden></div></div>
    <details style="margin-top:8px;font-size:13px;color:var(--muted)"><summary>${t("d_table")}</summary><table class="stt mono">${A.x.map((yr, i) => `<tr><td>${yr}</td><td>${nf(A.y[i], dec(V))}${unit(V)}</td></tr>`).join("")}</table></details>
    <p style="margin:8px 0"><button type="button" class="btn small" id="dCsv">⬇ ${t("d_csv")}</button></p>
    <span class="src">${t("d_src")(T.y0, T.y1)}</span>`;
  document.getElementById("dCsv").onclick = () => {
    const csv = `# NASA MERRA-2 ${V}, ${DS.region}, ${DS.season}, unit: ${T.units[V] || "-"}\nyear,value\n` + A.x.map((yr, i) => `${yr},${A.y[i]}`).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `merra2_${V}_${DS.region}_${DS.season}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };
  const svg = document.querySelector("#dChart svg"), tip = document.querySelector("#dChart .tip"), xh = svg.querySelector(".xh"), xd = svg.querySelector(".xd");
  svg.querySelector(".hit").onpointermove = e => {
    const bx = svg.getBoundingClientRect(), px = (e.clientX - bx.left) / bx.width * W;
    let i = 0; A.x.forEach((yr, k) => { if (Math.abs(x(yr) - px) < Math.abs(x(A.x[i]) - px)) i = k; });
    xh.setAttribute("x1", x(A.x[i])); xh.setAttribute("x2", x(A.x[i])); xd.setAttribute("cx", x(A.x[i])); xd.setAttribute("cy", y(A.y[i]));
    xh.setAttribute("visibility", "visible"); xd.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${A.x[i]}</b> · ${nf(A.y[i], dec(V))}${unit(V)}`; tip.hidden = false;
    tip.style.left = Math.min(Math.max(x(A.x[i]) / W * bx.width, 70), bx.width - 70) + "px"; tip.style.top = (y(A.y[i]) / H * bx.height - 36) + "px";
  };
  svg.onpointerleave = () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); xd.setAttribute("visibility", "hidden"); };

  // verdict in plain words + the numbers behind it
  const per10 = A.sen * 10, lv = level(A.mk.p), span = A.x[A.n - 1] - A.x[0];
  document.getElementById("dVerdict").innerHTML = `<h3>${t("d_vh")}</h3>
    <div class="verdict">${sgn(per10, dec(V))}${unit(V)}<span style="font:500 14px var(--body);color:var(--muted)"> ${t("d_per10")}</span></div>
    <span class="pill ${lv === "sig" ? (per10 > 0 ? "gain" : "loss") : "unc"}">${t("d_lv")[lv]}</span>
    <p style="margin:12px 0 0">${t("d_explain")[lv](sgn(per10, dec(V)) + unit(V), sgn(A.sen * span, dec(V)) + unit(V), A.x[0], A.x[A.n - 1], pTxt(A.mk.p))}</p>
    <table class="stt">
      <tr><td>${t("d_s_sen")}</td><td>${sgn(per10, dec(V))}${unit(V)} ${t("d_per10")}</td></tr>
      <tr><td>${t("d_s_ols")}</td><td>${sgn(A.ols.slope * 10, dec(V))}${unit(V)} ${t("d_per10")}</td></tr>
      <tr><td>${t("d_s_ci")}</td><td>${sgn(A.ols.ci[0] * 10, dec(V))} … ${sgn(A.ols.ci[1] * 10, dec(V))}</td></tr>
      <tr><td>${t("d_s_t")}</td><td>t = ${nf(A.ols.t, 2)}, ${pTxt(A.ols.p)}</td></tr>
      <tr><td>${t("d_s_mk")}</td><td>Z = ${nf(A.mk.z, 2)}, ${pTxt(A.mk.p)}</td></tr>
      <tr><td>${t("d_s_n")}</td><td>${A.n} (${A.x[0]}–${A.x[A.n - 1]})</td></tr>
    </table>
    <details style="margin-top:10px;font-size:13px;color:var(--muted)"><summary>${t("d_how_h")}</summary><p>${t("d_how")}</p></details>`;

  // same variable and season in every region: the same process can push regions in opposite directions
  const rows = Object.keys(T.series).filter(r => has(r, V)).map(r => { const s = seasonal(T.series[r][V], DS.season), a = STATS.analyse(s.years, s.vals); return a && { r, k: a.sen * 10, lv: level(a.mk.p) }; }).filter(Boolean);
  const mx = Math.max(...rows.map(o => Math.abs(o.k)), 1e-9);
  document.getElementById("dCompare").innerHTML = `<h3>${t("d_cmp_h")(t("var")[V][0], t("sea")[DS.season])}</h3><p class="def">${t("d_cmp_p")}</p>
    <div class="cmp">${rows.map(o => `<button type="button" class="btn small ${o.r === DS.region ? "sel" : ""}" data-g="region" data-v="${o.r}" style="justify-content:flex-start">${t("reg")[o.r]}</button>
      <div class="bar"><span class="zero"></span><i class="${o.lv === "sig" ? "" : "ns"}" style="${o.k >= 0 ? `left:50%;width:${o.k / mx * 50}%` : `right:50%;width:${-o.k / mx * 50}%`}"></i></div>
      <span class="mono">${sgn(o.k, dec(V))}${unit(V)} · ${t("d_lv_short")[o.lv]}</span>`).join("")}</div>`;
  document.querySelectorAll("#dCompare [data-g]").forEach(b => b.onclick = () => { DS.region = b.dataset.v; DS.narr = null; renderDetective(); });
}
// from a glacier on the map to the nearest detective region
function detectiveNear(g) {
  const T = window.TRENDS; if (!T) return;
  let best = null, bd = 1e9;
  for (const r in T.cells) { const c = T.cells[r][0], d = (c[0] - g.lat) ** 2 + ((c[1] - g.lon) * Math.cos(g.lat * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = r; } }
  DS.region = best; DS.narr = null; renderDetective(); document.getElementById("detective").scrollIntoView();
}

/* ---------- citizen science ---------- */
function nearest(lat, lon) { let best = null, bd = 1e9; const k = Math.cos(lat * Math.PI / 180); for (const g of G) { const d = (g.lat - lat) ** 2 + ((g.lon - lon) * k) ** 2; if (d < bd) { bd = d; best = g; } } return { g: best, km: Math.sqrt(bd) * 111 }; }
function setObsLoc(lat, lon) { const f = document.getElementById("obsForm"); f.elements.lat.value = lat.toFixed(5); f.elements.lon.value = lon.toFixed(5); updNearest(); }
function updNearest() { const f = document.getElementById("obsForm"); const lat = parseFloat(f.elements.lat.value), lon = parseFloat(f.elements.lon.value); const el = document.getElementById("nearestOut"); if (!isFinite(lat) || !isFinite(lon)) { el.textContent = ""; return; } const n = nearest(lat, lon); el.innerHTML = `${t("o_nearest")}: <b>${esc(gname(n.g))}</b> (${nf(n.km, 1)} km)`; }
function togglePick(on) { pickMode = on; document.getElementById("pickhint").style.display = on ? "block" : "none"; if (on) document.getElementById("see").scrollIntoView(); }
function renderObsForm() {
  const f = document.getElementById("obsForm"); const keep = f.elements.lat ? { lat: f.elements.lat.value, lon: f.elements.lon.value } : {};
  const today = new Date().toISOString().slice(0, 10);
  f.innerHTML = `<label>${t("o_type")}<select name="type">${t("o_types").map((x, i) => `<option value="${i}">${x}</option>`).join("")}</select></label>
    <div class="two"><label>${t("o_date")}<input type="date" name="date" value="${today}" max="${today}" required></label><label>${t("o_photo")}<input type="file" name="photo" accept="image/*"></label></div>
    <div class="two"><label>${t("o_lat")}<input name="lat" inputmode="decimal" value="${keep.lat || ""}"></label><label>${t("o_lon")}<input name="lon" inputmode="decimal" value="${keep.lon || ""}"></label></div>
    <div class="row"><button type="button" class="btn small" id="gpsBtn">${t("o_gps")}</button><button type="button" class="btn small" id="pickBtn">${t("o_pick")}</button><span class="note" id="nearestOut" style="margin:0"></span></div>
    <label>${t("o_note")}<textarea name="note" rows="3"></textarea></label>
    <div class="row"><button class="btn primary" type="submit">${t("o_save")}</button><span class="note" id="obsMsg" style="margin:0"></span></div>`;
  f.elements.lat.oninput = f.elements.lon.oninput = updNearest; updNearest();
  document.getElementById("pickBtn").onclick = () => togglePick(true);
  document.getElementById("gpsBtn").onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => setObsLoc(p.coords.latitude, p.coords.longitude), err => { document.getElementById("obsMsg").textContent = err.message; }) : null;
  f.onsubmit = async e => {
    e.preventDefault();
    const lat = parseFloat(f.elements.lat.value), lon = parseFloat(f.elements.lon.value);
    if (!isFinite(lat) || !isFinite(lon)) { document.getElementById("obsMsg").textContent = t("o_err"); return; }
    if (!USER) { openAuth("login", t("a_need")); return; }
    const id = "o" + Date.now().toString(36); const n = nearest(lat, lon);
    const file = f.elements.photo.files[0]; let hasPhoto = false;
    const photoData = file ? await resizeImage(file, 1200) : null;
    const o = await api("POST", "/api/obs", { id, type: +f.elements.type.value, date: f.elements.date.value, lat, lon, note: f.elements.note.value.trim(), glacier: n.g.id, km: +n.km.toFixed(2), photoData, created: new Date().toISOString() });
    if (!o) { document.getElementById("obsMsg").textContent = t("a_fail"); return; }
    OBS.unshift(o); alertMsg(t("a_sent"));
    save(); f.reset(); f.elements.date.value = today; updNearest(); renderObsList(); renderImpact(); refreshObsLayer();
  };
}
function resizeImage(file, max) { return new Promise(res => { const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement("canvas"); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.82)); }; im.onerror = () => res(null); im.src = r.result; }; r.onerror = () => res(null); r.readAsDataURL(file); }); }
function refreshObsLayer() { if (map && map.getSource("obs")) map.getSource("obs").setData(obsFC()); }
async function renderObsList() {
  const L = document.getElementById("obsList");
  if (!OBS.length) { L.innerHTML = `<div class="empty">${t("o_empty")}</div>`; return; }
  L.innerHTML = OBS.map(o => { const g = byId.get(o.glacier); return `<div class="item ${o.photo ? "" : "noimg"}" data-id="${o.id}">${o.photo ? `<img alt="" data-ph="${o.id}">` : ""}<div><h4>${esc(t("o_types")[o.type] || "")}</h4><div class="meta">${o.date} · ${nf(o.lat, 4)}, ${nf(o.lon, 4)}${o.who ? " · " + esc(o.who) : ""}</div><div class="meta">${t("o_nearest")}: ${esc(g ? gname(g) : "–")} (${nf(o.km, 1)} km)</div>${o.note ? `<p style="margin:6px 0 0;font-size:14px">${esc(o.note)}</p>` : ""}<div class="acts"><button type="button" class="btn small" data-a="cmp">${t("o_cmp")}</button><button type="button" class="btn small" data-a="gl">→ ${esc(g ? gname(g) : "")}</button><button type="button" class="btn small" data-a="del">${t("o_del")}</button></div></div></div>`; }).join("");
  for (const img of L.querySelectorAll("img[data-ph]")) { const u = await photoSrc(OBS.find(x => x.id === img.dataset.ph)); if (u) img.src = u; }
  L.querySelectorAll(".item").forEach(it => it.querySelectorAll("button").forEach(b => b.onclick = async () => {
    const o = OBS.find(x => x.id === it.dataset.id);
    if (b.dataset.a === "cmp") openCompare(o);
    if (b.dataset.a === "gl") { document.getElementById("see").scrollIntoView(); openGlacier(o.glacier); }
    if (b.dataset.a === "del") { if (o.srv && !(await api("DELETE", "/api/obs/" + o.id))) return; OBS = OBS.filter(x => x.id !== o.id); await idb.del(o.id); save(); renderObsList(); renderImpact(); refreshObsLayer(); }
  }));
}
async function openCompare(o) {
  const d = document.getElementById("cmp"), B = document.getElementById("cmpB");
  document.getElementById("cmpT").textContent = `${t("o_types")[o.type]} · ${o.date}`;
  const photo = o.photo ? await photoSrc(o) : null;
  B.innerHTML = `<figure>${photo ? `<img class="photo" src="${photo}" alt="">` : `<div class="empty">—</div>`}<figcaption>${t("cmp_photo")} · ${nf(o.lat, 4)}, ${nf(o.lon, 4)}</figcaption></figure><figure><div class="compare" id="cmpMap" style="aspect-ratio:1"></div><figcaption id="cmpCap">${t("cmp_nasa")}</figcaption></figure>`;
  d.showModal();
  const box = document.getElementById("cmpMap"), W = box.clientWidth;
  box.appendChild(Object.assign(document.createElement("div"), { className: "layer" })).appendChild(mosaic(weldURL(2000), o.lon, o.lat, 12, W));
  const pin = document.createElement("span"); pin.className = "pin"; box.appendChild(pin);
  const tg = document.createElement("span"); tg.className = "tag l"; tg.textContent = "Landsat WELD · 2000"; box.appendChild(tg);
  const tr = document.createElement("span"); tr.className = "tag r"; tr.textContent = t("loadingNow"); box.appendChild(tr);
  const dd = await bestHLS(o.lon, o.lat, 12);
  if (dd && d.open) { const top = document.createElement("div"); top.className = "layer top"; top.appendChild(mosaic(hlsURL(dd), o.lon, o.lat, 12, W)); box.insertBefore(top, pin); tr.textContent = `HLS · ${dd}`; document.getElementById("cmpCap").textContent = `${t("cmp_nasa")} | ${t("cmp_now")} (${dd})`; }
  else tr.textContent = t("noNow");
}

/* ---------- community ---------- */
function renderIniForm() {
  const f = document.getElementById("iniForm"); const keepG = f.elements.glacier ? f.elements.glacier.value : "";
  const named = G.filter(g => g.name).sort((a, b) => a.name.localeCompare(b.name));
  f.innerHTML = `<label>${t("i_title")}<input name="title" required maxlength="120"></label>
    <div class="two"><label>${t("i_type")}<select name="type">${t("i_types").map((x, i) => `<option value="${i}">${x}</option>`).join("")}</select></label><label>${t("i_date")}<input type="date" name="date" required></label></div>
    <label>${t("i_place")}<input name="place" required maxlength="120"></label>
    <label>${t("i_glacier")}<select name="glacier"><option value="">—</option>${ADOPT.concat(named.map(g => g.id)).filter((v, i, a) => a.indexOf(v) === i).map(id => { const g = byId.get(id); return g ? `<option value="${id}">${esc(gname(g))} · ${g.rgi}</option>` : ""; }).join("")}</select></label>
    <label>${t("i_desc")}<textarea name="desc" rows="3" maxlength="800"></textarea></label>
    <label>${t("i_contact")}<input name="contact" maxlength="120"></label>
    <div><button class="btn primary" type="submit">${t("i_save")}</button></div>`;
  if (keepG && ![...f.elements.glacier.options].some(o => o.value === keepG)) { const g = byId.get(keepG); if (g) f.elements.glacier.insertAdjacentHTML("beforeend", `<option value="${keepG}">${esc(gname(g))} · ${g.rgi}</option>`); }
  f.elements.glacier.value = keepG;
  f.onsubmit = e => { e.preventDefault(); INI.unshift({ id: "i" + Date.now().toString(36), title: f.elements.title.value.trim(), type: +f.elements.type.value, date: f.elements.date.value, place: f.elements.place.value.trim(), glacier: f.elements.glacier.value, desc: f.elements.desc.value.trim(), contact: f.elements.contact.value.trim(), people: 1, done: false, created: new Date().toISOString() }); save(); f.reset(); renderIniList(); renderImpact(); };
}
// keep glacier choice when panel button sets a non-listed glacier
document.addEventListener("click", e => { if (e.target && e.target.id === "pIni" && openId) { const f = document.getElementById("iniForm"); if (![...f.elements.glacier.options].some(o => o.value === openId)) { const g = byId.get(openId); f.elements.glacier.insertAdjacentHTML("beforeend", `<option value="${openId}">${esc(gname(g))} · ${g.rgi}</option>`); } f.elements.glacier.value = openId; } }, true);
function renderIniList() {
  const L = document.getElementById("iniList");
  if (!INI.length) { L.innerHTML = `<div class="empty">${t("i_empty")}</div>`; return; }
  L.innerHTML = INI.map(x => { const g = byId.get(x.glacier); const j = JOINED.includes(x.id); return `<div class="item noimg" data-id="${x.id}"><div><h4>${esc(x.title)} ${x.done ? `<span class="pill gain">${t("i_isdone")}</span>` : ""}</h4><div class="meta">${esc(t("i_types")[x.type])} · ${x.date} · ${esc(x.place)}${g ? " · " + esc(gname(g)) : ""} · ${t("i_people")(x.people)}</div>${x.desc ? `<p style="margin:6px 0 0;font-size:14px">${esc(x.desc)}</p>` : ""}${x.contact ? `<div class="meta">${esc(x.contact)}</div>` : ""}<div class="acts"><button type="button" class="btn small" data-a="join" ${j ? 'aria-pressed="true"' : ""}>${j ? t("i_joined") : t("i_join")}</button>${x.done ? "" : `<button type="button" class="btn small" data-a="done">${t("i_done")}</button>`}${g ? `<button type="button" class="btn small" data-a="gl">→ ${esc(gname(g))}</button>` : ""}<button type="button" class="btn small" data-a="del">${t("o_del")}</button></div></div></div>`; }).join("");
  L.querySelectorAll(".item").forEach(it => it.querySelectorAll("button").forEach(b => b.onclick = () => {
    const x = INI.find(y => y.id === it.dataset.id); const a = b.dataset.a;
    if (a === "join") { if (JOINED.includes(x.id)) { JOINED = JOINED.filter(y => y !== x.id); x.people = Math.max(1, x.people - 1); } else { JOINED.push(x.id); x.people++; } }
    if (a === "done") x.done = true;
    if (a === "gl") { document.getElementById("see").scrollIntoView(); openGlacier(x.glacier); return; }
    if (a === "del") INI = INI.filter(y => y.id !== x.id);
    save(); renderIniList(); renderImpact();
  }));
}

/* ---------- impact ---------- */
function renderImpact() {
  const vals = [OBS.length, OBS.filter(o => o.photo).length, new Set(OBS.map(o => o.glacier)).size, INI.length, INI.filter(x => x.done).length, INI.reduce((s, x) => s + x.people, 0)];
  document.getElementById("impactGrid").innerHTML = vals.map((v, i) => `<div><b class="mono">${v}</b><span>${t("imp")[i]}</span></div>`).join("");
  const A = document.getElementById("adoptList");
  A.innerHTML = ADOPT.length ? ADOPT.map(id => { const g = byId.get(id); return g ? `<div class="item noimg"><div><h4>${esc(gname(g))}</h4><div class="meta mono">${g.rgi} · ${nf(g.area, 2)} km² · ${sgn(g.mb)} ${t("mwe")}</div><div class="acts"><button type="button" class="btn small" data-id="${id}">→</button></div></div></div>` : ""; }).join("") : `<div class="empty">${t("adopt_empty")}</div>`;
  A.querySelectorAll("[data-id]").forEach(b => b.onclick = () => { document.getElementById("see").scrollIntoView(); openGlacier(b.dataset.id); });
}

/* ---------- export / import ---------- */
async function doExport() {
  const obs = []; for (const o of OBS) obs.push({ ...o, photoData: o.photo ? await idb.get(o.id) : null });
  const blob = new Blob([JSON.stringify({ app: "glacier-guardian-kg", version: 1, exported: new Date().toISOString(), observations: obs, initiatives: INI }, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `glacier-guardian-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function doImport(file) {
  try {
    const j = JSON.parse(await file.text()); let n = 0;
    for (const o of j.observations || []) { if (OBS.some(x => x.id === o.id) || !isFinite(o.lat) || !isFinite(o.lon)) continue; const { photoData, ...rest } = o; if (photoData && /^data:image\//.test(photoData)) { await idb.put(o.id, photoData); rest.photo = true; } else rest.photo = false; if (!byId.has(rest.glacier)) { const nn = nearest(rest.lat, rest.lon); rest.glacier = nn.g.id; rest.km = +nn.km.toFixed(2); } OBS.push(rest); n++; }
    for (const x of j.initiatives || []) { if (INI.some(y => y.id === x.id) || !x.title) continue; INI.push({ ...x, people: Math.max(1, +x.people || 1) }); n++; }
    save(); renderObsList(); renderIniList(); renderImpact(); refreshObsLayer(); alertMsg(t("imported")(n));
  } catch (e) { alertMsg("Import error: " + e.message); }
}
function alertMsg(m) { const el = document.getElementById("obsMsg"); if (el) { el.textContent = m; setTimeout(() => { el.textContent = ""; }, 5000); } }

/* ---------- accounts (server.py) ---------- */
let USER = null;
// JSON call to our server; returns the parsed reply, or null on any failure (error code kept in api.err)
async function api(method, path, body) {
  try {
    const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    api.err = r.ok ? null : (j && j.error) || "net"; return r.ok ? (j ?? {}) : null;
  } catch (e) { api.err = "net"; return null; }
}
const photoSrc = o => !o ? null : o.srv ? Promise.resolve("/api/photo/" + o.id) : idb.get(o.id);
async function syncObs() {
  const mine = await api("GET", "/api/obs"); if (!mine) return;
  OBS = [...mine, ...OBS.filter(o => !o.srv && !mine.some(m => m.id === o.id))];
  save(); renderObsList(); renderImpact(); refreshObsLayer();
}
function renderAcct() {
  const el = document.getElementById("acct");
  el.innerHTML = USER ? `<button type="button" class="btn small" id="acctBtn" title="${esc(USER.email)}">👤 ${esc(USER.name)}</button>` : `<button type="button" class="btn small primary" id="acctBtn">${t("a_login")}</button>`;
  document.getElementById("acctBtn").onclick = () => USER ? openAuth("me") : openAuth("login");
}
function openAuth(mode, msg = "") {
  const d = document.getElementById("auth"), F = document.getElementById("authForm"), T = document.getElementById("authTabs");
  if (mode === "me") {
    const n = OBS.filter(o => o.srv).length;
    T.innerHTML = `<b>${t("a_account")}</b>`;
    F.innerHTML = `<p style="margin:0"><b>${esc(USER.name)}</b><br><span class="note">${esc(USER.email)}</span></p><p style="margin:0">${t("a_mine")(n)}</p>
      <div class="row" style="display:flex;gap:8px"><a class="btn small" href="#science" id="aGo">${t("a_go")}</a><button type="button" class="btn small" id="aOut">${t("a_logout")}</button></div>`;
    document.getElementById("aGo").onclick = () => d.close();
    document.getElementById("aOut").onclick = async () => { await api("POST", "/api/logout"); USER = null; OBS = OBS.filter(o => !o.srv); save(); renderAcct(); renderObsList(); renderImpact(); refreshObsLayer(); d.close(); };
  } else {
    const up = mode === "signup";
    T.innerHTML = `<button type="button" class="btn small" aria-pressed="${!up}" data-m="login">${t("a_login")}</button><button type="button" class="btn small" aria-pressed="${up}" data-m="signup">${t("a_signup")}</button>`;
    T.querySelectorAll("button").forEach(b => b.onclick = () => openAuth(b.dataset.m));
    F.innerHTML = `${msg ? `<p class="note" style="margin:0">${esc(msg)}</p>` : ""}
      ${up ? `<label>${t("a_name")}<input name="name" autocomplete="name" required maxlength="60"></label>` : ""}
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>${t("a_pw")}<input name="password" type="password" autocomplete="${up ? "new-password" : "current-password"}" required minlength="${up ? 8 : 1}"></label>
      <div class="row"><button class="btn primary" type="submit">${up ? t("a_signup") : t("a_login")}</button><span class="note" id="authMsg" style="margin:0"></span></div>`;
    F.onsubmit = async e => {
      e.preventDefault();
      const body = { email: F.elements.email.value, password: F.elements.password.value }; if (up) body.name = F.elements.name.value;
      const u = await api("POST", up ? "/api/signup" : "/api/login", body);
      if (!u) { document.getElementById("authMsg").textContent = t("a_err")[api.err] || t("a_fail"); return; }
      USER = u; renderAcct(); syncObs(); d.close();
    };
  }
  if (!d.open) d.showModal();
}

/* ---------- boot ---------- */
function boot() {
  initMap(); initSearch(); renderStatic();
  document.getElementById("bm-land").onclick = () => setBase("land");
  document.getElementById("bm-relief").onclick = () => setBase("relief");
  document.getElementById("bm-3d").onclick = () => set3D(!is3D);
  const mr = document.getElementById("minarea");
  mr.oninput = () => { document.getElementById("minareaV").textContent = nf(+mr.value, 1); if (map && map.getLayer("gl")) map.setFilter("gl", [">=", ["get", "area"], +mr.value]); };
  document.getElementById("l-ru").onclick = () => { LANG = "ru"; try { localStorage.setItem("gg-lang", "ru"); } catch (e) {} renderStatic(); };
  document.getElementById("l-en").onclick = () => { LANG = "en"; try { localStorage.setItem("gg-lang", "en"); } catch (e) {} renderStatic(); };
  document.getElementById("exportBtn").onclick = doExport;
  document.getElementById("importFile").onchange = e => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ""; };
  document.getElementById("authX").onclick = () => document.getElementById("auth").close();
  api("GET", "/api/me").then(u => { if (u && u.email) { USER = u; renderAcct(); syncObs(); } });
  document.getElementById("cmpX").onclick = () => document.getElementById("cmp").close();
  document.addEventListener("keydown", e => { if (e.key === "Escape" && pickMode) togglePick(false); });
  const h = location.hash.match(/^#g-(\d{5})$/); if (h && byId.has(h[1])) { const go = () => openGlacier(h[1]); if (!map || map.isStyleLoaded()) go(); else map.once("load", go); } // setFeatureState throws before style load
}
boot();
})();
