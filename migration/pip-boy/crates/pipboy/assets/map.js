/* Rust-Boy local map viewport.
 * WGS84 GeoJSON (RFC 7946) -> Web Mercator screen coordinates (EPSG:3857).
 * No third-party scripts, tiles, network calls, location persistence or background GPS.
 * RustGIS layers are imported explicitly as GeoJSON; this is not its native renderer.
 */
(function () {
  "use strict";

  const TILE = 256;
  const MAX_LAT = 85.05112878;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 19;
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_FEATURES = 2000;
  const MAX_VERTICES = 30000;
  const EARTH_RADIUS_M = 6378137;
  let active = null;
  let mapMemory = null; // volatile geographic features only; never store GPS fixes
  let webRequestCount = 0;
  let webNextRequestAt = 0;
  let webProbeAt = 0;
  let webProbeSuccess = null;
  let pendingSiteFocus = null; // numeric ID only, never raw coordinates or notes
  const MAX_LOCAL_SITES = 256;
  const SITE_PAGE_SIZE = 6;
  // Per-page preferences only: no coordinates, flags or map features on disk.
  const COUNTY_ORDER = ["tiger-areawater","tiger-linearwater",
    "tiger-roads","tiger-pointlm"];
  const COUNTY_KEYS = ["roads","water","landmarks","boundary"];
  const COUNTY_LABELS = {roads:"ROADS",water:"WATER",
    landmarks:"LANDMARKS",boundary:"BORDER"};
  let countyPreferences = {roads:true,water:true,landmarks:true,boundary:true};

  function clamp(value, lower, upper) {
    return Math.min(upper, Math.max(lower, value));
  }

  function wrapLongitude(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function project(lon, lat) {
    const phi = clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI / 180;
    return [(lon + 180) / 360 * TILE,
      (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * TILE];
  }

  function inverse(x, y) {
    const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * clamp(y, 0, TILE) / TILE))) * 180 / Math.PI;
    return { lon: wrapLongitude(x / TILE * 360 - 180), lat: latitude };
  }

  function coordinate(value) {
    if (!Array.isArray(value) || value.length < 2 ||
        typeof value[0] !== "number" || typeof value[1] !== "number" ||
        !Number.isFinite(value[0]) || !Number.isFinite(value[1]) ||
        value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
      throw new Error("Layer needs valid WGS84 [longitude, latitude] coordinates");
    }
    return [value[0], value[1]];
  }

  function parseGeoJSON(text) {
    const source = JSON.parse(text);
    if (!source || typeof source !== "object" || source.crs) {
      throw new Error("Export RustGIS layers as WGS84 GeoJSON (EPSG:4326)");
    }
    const shapes = [];
    let vertices = 0;
    let features = 0;

    function path(values, minLength) {
      if (!Array.isArray(values) || values.length < minLength) {
        throw new Error("Invalid or empty GeoJSON path");
      }
      vertices += values.length;
      if (vertices > MAX_VERTICES) throw new Error("Layer exceeds 30,000 vertices");
      return values.map(coordinate);
    }

    function geometry(item, label, depth) {
      if (depth > 6 || !item || typeof item !== "object") {
        throw new Error("Unsupported GeoJSON geometry");
      }
      const c = item.coordinates;
      switch (item.type) {
        case "Point":
          shapes.push({ kind: "point", paths: [[coordinate(c)]], label });
          vertices++;
          break;
        case "MultiPoint":
          shapes.push({ kind: "point", paths: [path(c, 1)], label });
          break;
        case "LineString":
          shapes.push({ kind: "line", paths: [path(c, 2)], label });
          break;
        case "MultiLineString":
          if (!Array.isArray(c) || !c.length) throw new Error("Empty MultiLineString");
          shapes.push({ kind: "line", paths: c.map((part) => path(part, 2)), label });
          break;
        case "Polygon":
          if (!Array.isArray(c) || !c.length) throw new Error("Empty Polygon");
          shapes.push({ kind: "polygon", paths: c.map((ring) => path(ring, 4)), label });
          break;
        case "MultiPolygon":
          if (!Array.isArray(c) || !c.length) throw new Error("Empty MultiPolygon");
          for (const polygon of c) {
            if (!Array.isArray(polygon) || !polygon.length) throw new Error("Empty polygon part");
            shapes.push({ kind: "polygon", paths: polygon.map((ring) => path(ring, 4)), label });
          }
          break;
        case "GeometryCollection":
          if (!Array.isArray(item.geometries) || !item.geometries.length) {
            throw new Error("Empty GeometryCollection");
          }
          item.geometries.forEach((child) => geometry(child, label, depth + 1));
          break;
        default:
          throw new Error("Unsupported geometry: " + String(item.type).slice(0, 30));
      }
      if (vertices > MAX_VERTICES) throw new Error("Layer exceeds 30,000 vertices");
    }

    function feature(item) {
      if (!item || item.type !== "Feature") throw new Error("Expected GeoJSON Feature");
      features++;
      if (features > MAX_FEATURES) throw new Error("Layer exceeds 2,000 features");
      const raw = item.properties && item.properties.name;
      const label = typeof raw === "string" ? raw.slice(0, 36) : "";
      geometry(item.geometry, label, 0);
    }

    if (source.type === "FeatureCollection") {
      if (!Array.isArray(source.features) || !source.features.length ||
          source.features.length > MAX_FEATURES) {
        throw new Error("FeatureCollection must contain 1 to 2,000 features");
      }
      source.features.forEach(feature);
    } else if (source.type === "Feature") {
      feature(source);
    } else {
      geometry(source, "", 0);
    }
    if (!vertices || !shapes.length) throw new Error("No drawable GeoJSON geometry");
    return { shapes, vertices, features };
  }

  function niceStep(value) {
    const v = Math.max(1e-6, value);
    const power = Math.pow(10, Math.floor(Math.log10(v)));
    const normalized = v / power;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
  }

  function screenPoint(view, lon, lat) {
    const p=project(lon,lat);
    const c=view.frameCenter||project(view.center.lon,view.center.lat);
    let dx=p[0]-c[0];
    dx-=Math.round(dx/TILE)*TILE;
    const scale=view.frameScale||Math.pow(2,view.zoom);
    return [view.width/2+dx*scale,view.height/2+(p[1]-c[1])*scale];
  }


  // Reclamation is a separate, operator-requested local overlay, never a GPS
  // fix, imported basemap, or outbound query. Only the minimal map API is read.
  function validLocalSite(value) {
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 ||
        typeof value.name !== "string" || !value.name.length || value.name.length > 64 ||
        typeof value.latitude !== "number" || !Number.isFinite(value.latitude) ||
        typeof value.longitude !== "number" || !Number.isFinite(value.longitude) ||
        Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180 ||
        value.position_source !== "manual" ||
        !["routine", "high", "urgent"].includes(value.priority) ||
        !["logged", "in_progress", "needs_assistance", "completed"].includes(value.status) ||
        !["unknown", "serviceable", "degraded", "unsafe"].includes(value.condition) ||
        !["water", "sanitation", "infrastructure", "terrain", "supplies", "other"].includes(value.kind) ||
        !(value.accuracy_m === null ||
          (Number.isFinite(value.accuracy_m) && value.accuracy_m >= 0 && value.accuracy_m <= 10000))) {
      throw new Error("Invalid local site map record");
    }
    return {
      id: value.id, name: value.name, latitude: value.latitude, longitude: value.longitude,
      accuracy_m: value.accuracy_m, priority: value.priority,
      condition: value.condition, status: value.status, kind: value.kind
    };
  }

  function rememberPreSiteCenter(view) {
    if (!view.siteCentered) {
      view.siteReturn = { center: { ...view.center }, zoom: view.zoom };
    }
    view.siteCentered = true;
    view.follow = false;
    // An earlier WEB ON must not send the new, site-derived map extent.
    if (view.webEnabled) webOff(view, false);
  }

  function focusLocalSite(view, site) {
    rememberPreSiteCenter(view);
    view.center = { lat: clamp(site.latitude, -MAX_LAT, MAX_LAT), lon: site.longitude };
    view.zoom = Math.max(view.zoom, 14);
    view.selectedSiteId = site.id;
    view.gpsState = "SITE #" + site.id + " / MANUAL, NOT GPS";
    view.sitePanel.open = false;
    refresh(view);
  }

  function fitLocalSites(view) {
    if (!view.sites.length) return;
    rememberPreSiteCenter(view);
    const anchor = view.sites[0].longitude;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const site of view.sites) {
      let offset = site.longitude - anchor;
      offset -= Math.round(offset / 360) * 360;
      const p = project(anchor + offset, site.latitude);
      left = Math.min(left, p[0]);
      right = Math.max(right, p[0]);
      top = Math.min(top, p[1]);
      bottom = Math.max(bottom, p[1]);
    }
    if (view.sites.length === 1) {
      view.center = { lat: clamp(view.sites[0].latitude, -MAX_LAT, MAX_LAT),
        lon: view.sites[0].longitude };
      view.zoom = Math.max(view.zoom, 14);
    } else {
      const width = Math.max(1e-5, right - left);
      const height = Math.max(1e-5, bottom - top);
      view.zoom = clamp(Math.floor(Math.log2(Math.min(
        Math.max(80, view.width - 50) / width,
        Math.max(60, view.height - 45) / height))), MIN_ZOOM, 16);
      view.center = inverse((left + right) / 2, (top + bottom) / 2);
    }
    view.gpsState = "LOCAL SITES / MANUAL, NOT GPS";
    refresh(view);
  }

  function renderLocalSiteList(view) {
    view.siteList.replaceChildren();
    const total = view.sites.length;
    const pages = Math.max(1, Math.ceil(total / SITE_PAGE_SIZE));
    view.sitePage = clamp(view.sitePage, 0, pages - 1);
    view.sitePageLabel.textContent = (view.sitePage + 1) + "/" + pages;
    view.sitePrev.disabled = view.sitePage === 0;
    view.siteNext.disabled = view.sitePage === pages - 1;
    for (const site of view.sites.slice(
      view.sitePage * SITE_PAGE_SIZE, (view.sitePage + 1) * SITE_PAGE_SIZE)) {
      const row = make("div", "rb-map-site-row");
      if (site.id === view.selectedSiteId) row.classList.add("selected");
      const copy = make("div", "rb-map-site-copy");
      copy.append(make("strong", "", "#" + site.id + " " + site.name),
        make("small", "", site.kind.toUpperCase() + " · " + site.priority.toUpperCase() +
          " · " + site.status.replaceAll("_", " ").toUpperCase()),
        make("small", "", site.latitude.toFixed(5) + ", " +
          site.longitude.toFixed(5) + " · MANUAL"));
      row.append(copy, control("FOCUS", () => {
        focusLocalSite(view, site);
        renderLocalSiteList(view);
      }, "Center on manually recorded site " + site.id));
      view.siteList.append(row);
    }
    view.siteRefresh.disabled = view.siteBusy;
  }

  async function loadLocalSites(view) {
    if (active !== view || !view.siteAccess || !view.sitesVisible) return;
    const version = ++view.siteVersion;
    if (view.siteAbort) view.siteAbort.abort();
    const controller = new AbortController();
    view.siteAbort = controller;
    view.siteBusy = true;
    view.siteStatus.textContent = "READING LOCAL REGISTER";
    renderLocalSiteList(view);
    try {
      const result = await fetch("/api/reclamation/map", {
        cache: "no-store", credentials: "omit", signal: controller.signal
      });
      if (!result.ok) throw new Error("Local register unavailable (" + result.status + ")");
      const response = await result.json();
      if (active !== view || version !== view.siteVersion ||
          controller.signal.aborted || !view.sitesVisible) return;
      if (!response || !Array.isArray(response.sites) ||
          response.sites.length > MAX_LOCAL_SITES ||
          response.position_source !== "manual" || response.network_used !== false) {
        throw new Error("Invalid local register response");
      }
      const seen = new Set();
      const sites = response.sites.map(validLocalSite);
      for (const site of sites) {
        if (seen.has(site.id)) throw new Error("Duplicate site identifier");
        seen.add(site.id);
      }
      view.sites = sites;
      view.siteStatus.textContent = sites.length + " SAVED · MANUAL ONLY / NOT GPS";
      if (sites.some((site) => Math.abs(site.latitude) > MAX_LAT)) {
        view.siteStatus.textContent += " · POLAR LAT CLAMPED ON MAP";
      }
      if (pendingSiteFocus !== null) {
        const site = sites.find((item) => item.id === pendingSiteFocus);
        pendingSiteFocus = null;
        if (site) focusLocalSite(view, site);
        else view.siteStatus.textContent = "SITE NOT FOUND / REFRESH REGISTER";
      } else if (sites.length && !view.siteCentered &&
                 !view.shapes.length && !view.onlineShapes.length) {
        fitLocalSites(view);
      }
      renderLocalSiteList(view);
      refresh(view);
    } catch (error) {
      if (active === view && version === view.siteVersion &&
          !controller.signal.aborted && view.sitesVisible) {
        view.siteStatus.textContent = "LOCAL SITE ERROR / " +
          (error instanceof Error ? error.message : "UNAVAILABLE");
      }
    } finally {
      if (view.siteAbort === controller) view.siteAbort = null;
      if (active === view && version === view.siteVersion) {
        view.siteBusy = false;
        renderLocalSiteList(view);
        refresh(view);
      }
    }
  }

  function hideLocalSites(view) {
    view.siteVersion++;
    if (view.siteAbort) view.siteAbort.abort();
    view.siteAbort = null;
    view.siteBusy = false;
    view.sitesVisible = false;
    view.sites = [];
    view.selectedSiteId = null;
    view.siteMarkers = [];
    view.sitePanel.hidden = true;
    pendingSiteFocus = null;
    if (view.siteCentered && view.siteReturn) {
      view.center = { ...view.siteReturn.center };
      view.zoom = view.siteReturn.zoom;
      view.gpsState = "SITE VIEW CLOSED / GPS OFF";
    }
    view.siteCentered = false;
    view.siteReturn = null;
    refresh(view);
  }

  function showLocalSites(view) {
    if (!view.siteAccess || active !== view) return;
    if (view.countyEnabled || view.countyShapes.length) disableCounty(view);
    if (view.webEnabled) webOff(view, false);
    view.sitesVisible = true;
    view.sitePanel.hidden = false;
    void loadLocalSites(view);
    refresh(view);
  }

  function queueSiteFocus(id) {
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    pendingSiteFocus = id;
    if (active && active.siteAccess) showLocalSites(active);
    return true;
  }

  function siteAtPixel(view, x, y) {
    if (!view.sitesVisible) return null;
    let nearest = null, distance = 16 * 16;
    for (const marker of view.siteMarkers) {
      const d = (x - marker.x) ** 2 + (y - marker.y) ** 2;
      if (d < distance) {
        nearest = view.sites.find((site) => site.id === marker.id) || null;
        distance = d;
      }
    }
    return nearest;
  }

  function drawGrid(ctx, view) {
    const scale = Math.pow(2, view.zoom);
    const center = project(view.center.lon, view.center.lat);
    const minLon = (center[0] - view.width / (2 * scale)) / TILE * 360 - 180;
    const maxLon = (center[0] + view.width / (2 * scale)) / TILE * 360 - 180;
    const north = inverse(center[0], center[1] - view.height / (2 * scale)).lat;
    const south = inverse(center[0], center[1] + view.height / (2 * scale)).lat;
    const lonStep = niceStep((maxLon - minLon) / Math.max(2, view.width / 85));
    const latStep = niceStep((north - south) / Math.max(2, view.height / 85));
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(111, 174, 113, 0.19)";
    ctx.fillStyle = "rgba(161, 219, 147, 0.55)";
    ctx.font = "10px monospace";
    const startLon = Math.ceil(minLon / lonStep) * lonStep;
    for (let index = 0; index < 60; index++) {
      const lon = startLon + index * lonStep;
      if (lon > maxLon + 1e-8) break;
      const x = view.width / 2 + (lon - view.center.lon) * TILE * scale / 360;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, view.height);
      ctx.stroke();
      ctx.fillText(wrapLongitude(lon).toFixed(lonStep < 1 ? 3 : 1) + "\u00b0", x + 3, 12);
    }
    const startLat = Math.ceil(south / latStep) * latStep;
    for (let index = 0; index < 60; index++) {
      const lat = startLat + index * latStep;
      if (lat > north + 1e-8) break;
      const y = screenPoint(view, view.center.lon, lat)[1];
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(view.width, y);
      ctx.stroke();
      ctx.fillText(lat.toFixed(latStep < 1 ? 3 : 1) + "\u00b0", 4, y - 4);
    }
  }


  // Index source-provided feature envelopes only. The index affects lookup,
  // never the source geometry or the authoritative census cache. Each feature
  // is assigned to a bounded number of cells; extensive shapes are scanned
  // conservatively instead of producing millions of bucket references.
  function countyFilterFor(id) {
    return id==="tiger-roads" ? "roads" :
      id==="tiger-pointlm" ? "landmarks" : "water";
  }

  function validEnvelope(b) {
    return Array.isArray(b) && b.length===4 &&
      b.every(Number.isFinite) && b[0]>=-180 && b[2]<=180 &&
      b[1]>=-90 && b[3]<=90 && b[0]<=b[2] && b[1]<=b[3];
  }

  function buildCountyIndex(shapes) {
    if (shapes.length < 128) return {shapes,cells:null};
    const bounds = [Infinity,Infinity,-Infinity,-Infinity];
    for (const shape of shapes) {
      if (!validEnvelope(shape.bounds) || shape.bounds[2]-shape.bounds[0]>180)
        continue;
      bounds[0]=Math.min(bounds[0],shape.bounds[0]);
      bounds[1]=Math.min(bounds[1],shape.bounds[1]);
      bounds[2]=Math.max(bounds[2],shape.bounds[2]);
      bounds[3]=Math.max(bounds[3],shape.bounds[3]);
    }
    if (!bounds.every(Number.isFinite)) return {shapes,cells:null};
    const size=Math.min(48,Math.max(8,Math.ceil(Math.sqrt(shapes.length/16))));
    const cols=bounds[2]-bounds[0]<1e-9 ? 1 : size;
    const rows=bounds[3]-bounds[1]<1e-9 ? 1 : size;
    const cells=new Map(), spill=[];
    const ix=lon=>clamp(Math.floor((lon-bounds[0])/
      Math.max(1e-9,bounds[2]-bounds[0])*cols),0,cols-1);
    const iy=lat=>clamp(Math.floor((lat-bounds[1])/
      Math.max(1e-9,bounds[3]-bounds[1])*rows),0,rows-1);
    let references=0;
    for (let i=0;i<shapes.length;i++) {
      const b=shapes[i].bounds;
      if (!validEnvelope(b) || b[2]-b[0]>180) {spill.push(i);continue;}
      const x0=ix(b[0]),x1=ix(b[2]),y0=iy(b[1]),y1=iy(b[3]);
      const count=(x1-x0+1)*(y1-y0+1);
      if (count>24) {spill.push(i);continue;}
      // At most 240k references for one source; no unbounded index growth.
      if (references+count>240000) return {shapes,cells:null};
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const key=y*cols+x;
        if(!cells.has(key))cells.set(key,[]);
        cells.get(key).push(i);
      }
      references+=count;
    }
    return {shapes,bounds,cols,rows,cells,spill,references};
  }

  function countyViewport(view) {
    if (!view.width || !view.height) return null;
    const center=project(view.center.lon,view.center.lat);
    const scale=Math.pow(2,view.zoom),pad=16;
    const westX=center[0]-(view.width/2+pad)/scale;
    const eastX=center[0]+(view.width/2+pad)/scale;
    // World-spanning and antimeridian viewports use the complete feature
    // list, preserving original wrap behavior rather than dropping geometry.
    if(westX<0 || eastX>TILE || eastX-westX>=TILE) return null;
    const north=inverse(center[0],center[1]-(view.height/2+pad)/scale).lat;
    const south=inverse(center[0],center[1]+(view.height/2+pad)/scale).lat;
    return [westX/TILE*360-180,south,eastX/TILE*360-180,north];
  }

  function indexedCountyShapes(index, viewport) {
    if (!index.cells || !viewport) return index.shapes;
    const b=index.bounds;
    if(viewport[0]>b[2] || viewport[2]<b[0] ||
       viewport[1]>b[3] || viewport[3]<b[1])
      return index.spill.map(i=>index.shapes[i]);
    const cx=v=>clamp(Math.floor((v-b[0])/
      Math.max(1e-9,b[2]-b[0])*index.cols),0,index.cols-1);
    const cy=v=>clamp(Math.floor((v-b[1])/
      Math.max(1e-9,b[3]-b[1])*index.rows),0,index.rows-1);
    const found=new Set(index.spill);
    for(let y=cy(viewport[1]);y<=cy(viewport[3]);y++){
      for(let x=cx(viewport[0]);x<=cx(viewport[2]);x++){
        for(const id of index.cells.get(y*index.cols+x)||[]) found.add(id);
      }
    }
    // A wide view is cheaper as a full sequential scan than sorting an
    // almost-complete set of cells. Both paths retain original record order.
    if(found.size>index.shapes.length*0.6)return index.shapes;
    return [...found].sort((a,b)=>a-b).map(i=>index.shapes[i]);
  }

  // Labels are rendered after geometry with POIs ahead of roads. A tiny
  // collision budget keeps the 480x320 display legible and prevents a crowded
  // road layer from consuming all landmark labels.
  function drawMapLabels(view,ctx,labels,stats) {
    const occupied=[];
    for(const candidate of [...labels.points,...labels.roads]) {
      if(occupied.length>=12)break;
      const name=candidate.name.slice(0,Math.min(30,Math.max(8,Math.floor(view.width/12))));
      const x=candidate.x+6,y=candidate.y-6,width=name.length*6.2+5;
      if(x<4 || y<13 || x+width>view.width-3 || y>view.height-4)continue;
      const box=[x-2,y-11,x+width,y+2];
      if(occupied.some(b=>box[0]<b[2]+3 && box[2]+3>b[0] &&
          box[1]<b[3]+3 && box[3]+3>b[1]))continue;
      occupied.push(box);
      ctx.fillStyle=candidate.point?"#f3db9a":"#d6efbd";
      ctx.font="10px monospace";
      ctx.fillText(name,x,y);
      if(candidate.point)stats.landmarkLabels++;
      else stats.roadLabels++;
    }
  }

  function shapeVisible(shape, view) {
    // Do not synthesize geometry: use only the bounded source envelope.
    if (shape.countyBase) {
      if (shape.countyLayer === "roads" && !shape.countyMajor && view.zoom < 11.4)
        return false;
      if (shape.countyLayer === "pointlm" && view.zoom < 11.5)
        return false;
    }
    if (!validEnvelope(shape.bounds) || shape.bounds[2]-shape.bounds[0]>180)
      return true; // Dateline/ambiguous envelopes cannot safely be culled.
    const sw = screenPoint(view, shape.bounds[0], shape.bounds[1]);
    const ne = screenPoint(view, shape.bounds[2], shape.bounds[3]);
    return Math.max(sw[0],ne[0]) >= -12 &&
      Math.min(sw[0],ne[0]) <= view.width + 12 &&
      Math.max(sw[1],ne[1]) >= -12 &&
      Math.min(sw[1],ne[1]) <= view.height + 12;
  }

  function monotonicNow() {
    return typeof window.performance?.now === "function" ?
      window.performance.now() : Date.now();
  }

  function draw(view) {
    const ctx = view.canvas.getContext("2d");
    if (!ctx || !view.width || !view.height) return;
    const started = monotonicNow();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = "#0b1a12";
    ctx.fillRect(0, 0, view.width, view.height);
    // Reuse the center transform for every plotted vertex in this frame.
    view.frameCenter=project(view.center.lon,view.center.lat);
    view.frameScale=Math.pow(2,view.zoom);
    drawGrid(ctx, view);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let labels = 0;
    const stats={loaded:view.countyShapes.length,candidates:0,drawn:0,
      indexedLayers:0,roadLabels:0,landmarkLabels:0,
      byLayer:{roads:0,water:0,landmarks:0,boundary:0}};
    const labelCandidates={points:[],roads:[]};
    function paintShape(shape,category) {
      if (!shapeVisible(shape,view)) return;
      const style=shape.style||{};
      ctx.globalAlpha=Number.isFinite(style.opacity)?style.opacity:1;
      if(category){
        stats.drawn++;
        stats.byLayer[category]++;
      }
      if(shape.kind==="point"){
        ctx.fillStyle=style.fill||"#bced99";
        for(const point of shape.paths[0]){
          const p=screenPoint(view,point[0],point[1]);
          if(p[0]<-8 || p[0]>view.width+8 || p[1]<-8 || p[1]>view.height+8)
            continue;
          ctx.beginPath();
          ctx.arc(p[0],p[1],3,0,Math.PI*2);
          ctx.fill();
          if(shape.label && labelCandidates.points.length<80){
            labelCandidates.points.push({
              x:p[0],y:p[1],name:shape.label,point:true
            });
          }
        }
      }else{
        ctx.beginPath();
        for(const path of shape.paths){
          path.forEach((point,index)=>{
            const p=screenPoint(view,point[0],point[1]);
            if(index===0)ctx.moveTo(p[0],p[1]);
            else ctx.lineTo(p[0],p[1]);
          });
          if(shape.kind==="polygon")ctx.closePath();
        }
        if(shape.kind==="polygon"){
          ctx.fillStyle=style.fill||"rgba(116,178,112,0.19)";
          ctx.fill("evenodd");
        }
        ctx.lineWidth=style.width||(shape.kind==="polygon"?1:1.5);
        ctx.strokeStyle=style.stroke||
          (shape.kind==="polygon"?"#6b9f6b":"#b5db90");
        ctx.stroke();
        if(shape.label && shape.kind==="line" && view.zoom>=13.5 &&
            labelCandidates.roads.length<96 &&
            shape.paths[0] && shape.paths[0].length>=2){
          const mid=shape.paths[0][Math.floor(shape.paths[0].length/2)];
          const p=screenPoint(view,mid[0],mid[1]);
          if(p[0]>5 && p[0]<view.width-65 && p[1]>16 &&
              p[1]<view.height-12)
            labelCandidates.roads.push({x:p[0],y:p[1],
              name:shape.label,point:false});
        }
      }
    }
    // Draw native county layers in stable source order. A per-source spatial
    // index selects only viewport-intersecting geometries; hidden categories
    // cost no draw work and retain their fully decoded authoritative data.
    const viewport=countyViewport(view);
    for(const id of COUNTY_ORDER){
      const category=countyFilterFor(id);
      if(!view.countyLayerVisible[category])continue;
      const layer=view.countyPackage?.layers[id];
      if(!layer || (id==="tiger-pointlm" && view.zoom<11.5))continue;
      const index=id==="tiger-roads" && view.zoom<11.4 ?
        (layer.majorRenderIndex||=buildCountyIndex(
          layer.shapes.filter(shape=>shape.countyMajor))) :
        (layer.renderIndex||=buildCountyIndex(layer.shapes));
      const candidates=indexedCountyShapes(index,viewport);
      stats.candidates+=candidates.length;
      if(index.cells && viewport)stats.indexedLayers++;
      for(const shape of candidates)paintShape(shape,category);
    }
    // Imported RustGIS and independently opted-in OSM reference are not
    // silently reclassified or hidden by the official Census layer controls.
    for(const shape of view.onlineShapes)paintShape(shape,null);
    for(const shape of view.shapes)paintShape(shape,null);
    if(view.county?.shape && view.countyLayerVisible.boundary)
      paintShape(view.county.shape,"boundary");
    // Preserve landmark labels even when numerous named roads occupy the view.
    labelCandidates.points.sort((a,b)=>
      ((a.x-view.width/2)**2+(a.y-view.height/2)**2)-
      ((b.x-view.width/2)**2+(b.y-view.height/2)**2));
    ctx.globalAlpha=1;
    drawMapLabels(view,ctx,labelCandidates,stats);
    view.renderStats=stats;

    // Site markers remain distinct from imported RustGIS and opt-in OSM layers.
    view.siteMarkers = [];
    ctx.globalAlpha = 1;
    if (view.sitesVisible) {
      for (const site of view.sites) {
        const p = screenPoint(view, site.longitude, site.latitude);
        if (p[0] < -12 || p[0] > view.width + 12 ||
            p[1] < -12 || p[1] > view.height + 12) continue;
        view.siteMarkers.push({ id: site.id, x: p[0], y: p[1] });
        ctx.beginPath();
        ctx.arc(p[0], p[1], site.id === view.selectedSiteId ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = site.priority === "urgent" ? "#f0ba77" :
          site.priority === "high" ? "#e1e09a" : "#a6e5bc";
        ctx.fill();
        ctx.strokeStyle = "#092314";
        ctx.lineWidth = 2;
        ctx.stroke();
        if (labels < 16) {
          ctx.font = "10px monospace";
          ctx.fillStyle = "#e1ffd1";
          ctx.fillText("#" + site.id, p[0] + 8, p[1] - 7);
          labels++;
        }
      }
    }

    ctx.globalAlpha = 1;
    // Center crosshair is a camera reference, never passed off as a GPS fix.
    const midX = view.width / 2;
    const midY = view.height / 2;
    ctx.strokeStyle = "rgba(190, 224, 162, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(midX - 6, midY);
    ctx.lineTo(midX + 6, midY);
    ctx.moveTo(midX, midY - 6);
    ctx.lineTo(midX, midY + 6);
    ctx.stroke();

    if (view.fix) {
      const point = screenPoint(view, view.fix.lon, view.fix.lat);
      const metersPerPixel = Math.cos(view.fix.lat * Math.PI / 180) *
        2 * Math.PI * EARTH_RADIUS_M / (TILE * Math.pow(2, view.zoom));
      if (view.fix.accuracy > 0 && metersPerPixel > 0) {
        ctx.beginPath();
        ctx.arc(point[0], point[1], Math.min(30000, view.fix.accuracy / metersPerPixel), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(121, 204, 154, 0.13)";
        ctx.fill();
        ctx.strokeStyle = "rgba(126, 229, 159, 0.65)";
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(point[0], point[1], 6, 0, Math.PI * 2);
      ctx.fillStyle = "#e5ffb2";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#153b21";
      ctx.stroke();
    }

    if (!view.countyShapes.length && !view.shapes.length &&
        !view.onlineShapes.length && !view.county) {
      ctx.textAlign = "center";
      ctx.font = "11px monospace";
      ctx.fillStyle = "#dfa96b";
      ctx.fillText(view.sitesVisible && view.sites.length ?
        "LOCAL SITES / NO BASEMAP" : "GPS OR CENTER + COUNTY / LOAD GIS",
        view.width / 2, view.height - 16);
      ctx.textAlign = "start";
    }
    // Local, volatile profiling only: canvas draw cost, NOT frame rate,
    // source download time, a GNSS reading or any remotely sent telemetry.
    const elapsed = Math.max(0,monotonicNow()-started);
    const samples=view.paintSamples;
    samples.push(Math.min(10000,elapsed));
    if(samples.length>60)samples.shift();
    const ordered=[...samples].sort((a,b)=>a-b);
    view.renderStats.drawMs=elapsed;
    view.renderStats.p95Ms=ordered[Math.ceil(ordered.length*0.95)-1];
    view.renderStats.drawSamples=samples.length;
  }

  function setLayerStatus(view) {
    const visible=COUNTY_KEYS.filter(key=>view.countyLayerVisible[key]);
    view.layerSummary.textContent="LAYERS / "+visible.length+" OF 4 VISIBLE";
    for(const key of COUNTY_KEYS){
      const button=view.layerButtons[key];
      const on=view.countyLayerVisible[key];
      button.textContent=COUNTY_LABELS[key]+" "+(on?"ON":"OFF");
      button.setAttribute("aria-pressed",String(on));
      button.className="rb-map-button rb-map-layer-button"+
        (on?"":" rb-map-layer-muted");
    }
  }

  function setStatus(view) {
    setLayerStatus(view);
    if (active !== view) return;
    const center = view.center.lat.toFixed(5) + ", " + view.center.lon.toFixed(5);
    const fix = view.fix
      ? "FIX " + view.fix.lat.toFixed(5) + ", " + view.fix.lon.toFixed(5) +
        " \u00b1" + Math.round(view.fix.accuracy) + "m"
      : view.gpsState;
    view.status.textContent = (view.siteCentered ? "MANUAL SITE / NOT GPS  |  " : "") +
      fix + "  |  Z" + view.zoom.toFixed(1) + "  |  " +
      (view.layerName || (view.sitesVisible ? "LOCAL SITES" :
        view.countyShapes.length ? "TIGER COUNTY " + view.countyPackage.geoid :
        "NO REGION / GPS OR CENTER + COUNTY")) +
      "  |  " + (view.centerSelected || view.fix || view.countyShapes.length ||
        view.shapes.length || view.onlineShapes.length ? "CENTER " + center :
        "CENTER UNSET / GRID ONLY") +
      (view.countyShapes.length &&
        !COUNTY_KEYS.some(k=>view.countyLayerVisible[k]) ?
        " / ALL COUNTY LAYERS HIDDEN" : "");
    view.locate.textContent = view.watchId === null && !view.gpsPending ? "GPS ON" : "GPS OFF";
    view.gpsHelp.hidden = !view.gpsIssue;
    if (view.gpsIssue) {
      const permission = view.gpsPermission.toUpperCase();
      view.gpsHelpSummary.textContent = "GPS HELP / " +
        (view.gpsIssue === "denied" ? "PERMISSION DENIED" :
         view.gpsIssue === "timeout" ? "LOCATION TIMED OUT" :
         view.gpsIssue === "policy" ? "PAGE POLICY" :
         view.gpsIssue === "insecure" ? "SECURE CONTEXT" : "PROVIDER");
      const problem = view.gpsIssue === "policy" ?
        "Page policy blocks geolocation; use the top-level Rust-Boy local dashboard." :
        view.gpsIssue === "insecure" ?
          "Use the local http://127.0.0.1 page or HTTPS, not an insecure remote address." :
        view.gpsIssue === "denied" ?
          (view.gpsPermission === "granted" ?
            "Browser says allowed; check OS Location Services for the browser and its location provider." :
            "Allow location for this exact site in the browser address-bar permissions; check OS Location Services for the browser.") :
          "Check that this browser/device has a working location provider; try GPS ON again.";
      view.gpsHelpText.textContent = "BROWSER PERMISSION: " + permission + " / " +
        problem + " GPS ON retries only when you press it. CENTER works without GPS.";
    }

    view.followButton.disabled = !view.fix;
    view.followButton.textContent = view.follow ? "FOLLOW" : "RECENTER";
    view.webButton.textContent = view.webEnabled ? "WEB OFF" : "WEB ON";
    view.siteButton.textContent = view.sitesVisible ? "SITES OFF" : "SITES";
    view.countyAttribution.hidden = !view.countyShapes.length && !view.county;
    view.siteSummary.textContent = "RECLAMATION / " + view.sites.length + " LOCAL SITES";
    view.webRefresh.hidden = !view.webEnabled;
    view.webStatusNode.textContent = view.webStatus;
    view.countyButton.textContent = view.countyEnabled ? "COUNTY OFF" : "COUNTY";
    view.zipCountyButton.disabled = !view.county?.id;
    view.countyNode.textContent = view.countyStatus;
    view.attribution.hidden = !view.onlineShapes.length;
    view.sourceBox.hidden = !view.county && !view.countyShapes.length &&
      !view.layers.length && !view.webMeta &&
      !(view.sitesVisible && view.sites.length);
    if (view.county || view.countyShapes.length ||
        view.layers.length || view.webMeta ||
        (view.sitesVisible && view.sites.length)) {
      view.sourceSummary.textContent = "DATA SOURCES / " + view.layers.length + " IMPORTED LAYERS" +
        (view.county ? " / CENSUS COUNTY" : "") +
        (view.countyPackage ? " / TIGER " + view.countyPackage.geoid : "") +
        (view.sitesVisible ? " / " + view.sites.length + " LOCAL SITES" : "") +
        (view.webMeta ? " / OSM WEB" : "") +
        (view.warnings.length ? " / " + view.warnings.length + " LIMITATIONS" : "");
      view.sourceLines.textContent = (view.countyPackage ?
        "COUNTY GEOID " + view.countyPackage.geoid +
        " / U.S. Census TIGER/Line 2025\n" +
        "Source datum: GCS NAD83 (geographic lon/lat); no datum shift applied.\n" +
        Object.entries(view.countyPackage.layers).map(([id,d]) =>
          id + ": " + d.features + " features, " + d.vertices +
          (id === "tiger-pointlm"
            ? " in-county named points / STATE archive, verified county clipping"
            : " original vertices / county-wide source")).join("\n") +
        (view.countyPackage.errors.length ?
          "\nPARTIAL SOURCES: " + view.countyPackage.errors.join(" | ") : "") +
        (view.countyPackage.warnings?.length ?
          "\nRESTRICTIONS: " + view.countyPackage.warnings.join(" | ") : "") +
        "\nENABLED: " + COUNTY_KEYS.filter(k=>view.countyLayerVisible[k]).join(", ") +
        (view.renderStats ?
          "\nVIEWPORT: "+view.renderStats.candidates+" candidates / "+
          view.renderStats.loaded+" loaded; "+
          view.renderStats.drawn+" drawn county features" +
          "\nLOCAL CANVAS DRAW: "+view.renderStats.drawMs.toFixed(1)+
          "ms last / "+view.renderStats.p95Ms.toFixed(1)+"ms p95 ("+
          view.renderStats.drawSamples+" frames; excludes ingestion)" : "") +
        (view.countyLoadTiming ?
          "\nSOURCE DECODE + DELIVERY: "+view.countyLoadTiming.ms.toFixed(0)+
          "ms / "+(view.countyLoadTiming.cacheOnly?"local cache-only":"network permitted")+
          " / "+view.countyLoadTiming.features+" features" : "") +
        "\nWater areas/streams are reference geometry, not surveyed coastline.\n" : "") +
        (view.county ?
        "COUNTY: " + view.county.name + " / GEOID " + view.county.id + "\n" +
        "Source: " + view.county.source + "\n" +
        "Boundary ≠ surveyed shoreline; OSM roads are viewport-limited.\n" : "") +
        (view.mapName ? view.mapName + " / " + view.mapFormat + "\n" : "") +
        view.layers.map((layer) => layer.name + " (" + layer.features + " features)\n" +
          "  Source: " + layer.source +
          (layer.originalCrs ? "\n  Original CRS: " + JSON.stringify(layer.originalCrs).slice(0, 120) : "")
        ).join("\n") +
        (view.warnings.length ? "\nLIMITS: " + view.warnings.join(" | ") : "") +
        (view.webMeta
          ? "\nREFERENCE ONLY: © OpenStreetMap contributors / ODbL" +
            "\nProvider: overpass-api.de (RustGIS OSM query source)" +
            "\nCoverage: " + view.webMeta.bounds.join(", ") +
            "\nFetched: " + new Date(view.webMeta.fetchedAt).toISOString() +
            (view.webMeta.timestamp ? "\nOSM base timestamp: " + view.webMeta.timestamp : "") +
            "\nFeatures: " + Object.entries(view.webMeta.count).map(([k,v])=>k+"="+v).join(", ") +
            (view.webMeta.warnings.length ? "\nWEB LIMITS: " + view.webMeta.warnings.join(" | ") : "")
          : "") +
        (view.sitesVisible ? "\nSITE SOURCE: local Reclamation manual observations, not GPS or verified remediation." : "") +
        "\nCoordinates drawn: WGS84 longitude/latitude.";
    }
  }

  function refresh(view) {
    if(active!==view || view.paintQueued)return;
    view.paintQueued=true;
    // Pointer-move storms resolve to one frame, keeping touch panning smooth.
    window.requestAnimationFrame(()=>{
      view.paintQueued=false;
      if(active!==view)return;
      draw(view);
      setStatus(view);
    });
  }



  // The only automatic outbound request: an infrequent, coordinate-free status
  // ping upon entering MAP. Actual bbox queries require WEB ON.
  async function probeWeb(view) {
    if (active !== view || view.webEnabled || view.webProbePromise) return;
    if (navigator.onLine === false) {
      view.webStatus = "OFFLINE / WEB MAP UNAVAILABLE";
      refresh(view);
      return;
    }
    if (Date.now() - webProbeAt < 10 * 60 * 1000 && webProbeSuccess !== null) {
      view.webStatus = webProbeSuccess ? "WEB READY / WEB ON SENDS MAP AREA" : "WEB STATUS UNAVAILABLE";
      refresh(view);
      return;
    }
    const service = window.RustBoyOnline;
    if (!service) return;
    const controller = new AbortController();
    view.webProbeAbort = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    view.webStatus = "PING WEB STATUS / NO COORDINATES SENT";
    refresh(view);
    const pending = (async () => {
      try {
        await service.ping(controller.signal);
        webProbeSuccess = true;
        webProbeAt = Date.now();
        if (active === view && !view.webEnabled) {
          view.webStatus = "WEB READY / WEB ON SENDS MAP AREA";
        }
      } catch (_) {
        if (!controller.signal.aborted || active === view) {
          webProbeSuccess = false;
          webProbeAt = Date.now();
        }
        if (active === view && !view.webEnabled) {
          view.webStatus = "WEB STATUS UNAVAILABLE / OFFLINE MAP READY";
        }
      } finally {
        clearTimeout(timeout);
        if (view.webProbeAbort === controller) view.webProbeAbort = null;
        view.webProbePromise = null;
        if (active === view && !view.webEnabled) refresh(view);
      }
    })();
    view.webProbePromise = pending;
    await pending;
  }

  function centerInside(bounds, center) {
    if (!bounds || !center) return false;
    const dx = (bounds[2] - bounds[0]) * 0.23;
    const dy = (bounds[3] - bounds[1]) * 0.23;
    return center.lon >= bounds[0] + dx && center.lon <= bounds[2] - dx &&
      center.lat >= bounds[1] + dy && center.lat <= bounds[3] - dy;
  }

  function webOff(view, preserveCache = true) {
    view.webEnabled = false;
    if (view.webAbort) view.webAbort.abort();
    view.webStatus = preserveCache && view.onlineShapes.length
      ? "WEB OFF / CACHED ROAD REFERENCE" : "WEB OFF";
    if (!preserveCache) {
      view.onlineShapes = [];
      view.webMeta = null;
    }
    refresh(view);
  }

  async function webFetch(view) {
    if (active !== view || !view.webEnabled || view.webBusy) return;
    const service = window.RustBoyOnline;
    if (!service) { view.webStatus = "WEB CONNECTOR MISSING"; refresh(view); return; }
    if (navigator.onLine === false) {
      view.webStatus = "OFFLINE / EXISTING MAP PRESERVED";
      refresh(view);
      return;
    }
    let bbox;
    try {
      bbox = service.boundsFor(view);
    } catch (error) {
      view.webStatus = error instanceof Error ? error.message : "INVALID WEB MAP AREA";
      refresh(view);
      return;
    }
    const now = Date.now();
    if (view.webMeta && now - view.webMeta.fetchedAt < 10 * 60 * 1000 &&
        centerInside(view.webMeta.bounds, view.center)) {
      view.webStatus = "OSM CACHE / " + view.onlineShapes.length + " FEATURES";
      refresh(view);
      return;
    }
    if (now < webNextRequestAt) {
      view.webStatus = "WEB COOLDOWN / MAP PRESERVED";
      refresh(view);
      return;
    }
    if (webRequestCount >= 8) {
      view.webStatus = "SESSION WEB LIMIT / RESTART TO RESET";
      refresh(view);
      return;
    }
    view.webBusy = true;
    webRequestCount++;
    webNextRequestAt = now + 2 * 60 * 1000;
    const abort = new AbortController();
    view.webAbort = abort;
    const timeout = setTimeout(() => abort.abort(), 25000);
    try {
      view.webStatus = "PING OVERPASS / NO LOCATION IN PING";
      refresh(view);
      if (view.webProbePromise) await view.webProbePromise;
      if (active !== view || !view.webEnabled || abort.signal.aborted) return;
      if (!webProbeSuccess || Date.now() - webProbeAt >= 10 * 60 * 1000) {
        await service.ping(abort.signal);
        webProbeSuccess = true;
        webProbeAt = Date.now();
      }
      if (active !== view || !view.webEnabled || abort.signal.aborted) return;
      view.webStatus = "FETCH ROADS + LANDMARKS / OSM";
      refresh(view);
      const result = await service.roads(view, abort.signal);
      if (active !== view || !view.webEnabled || abort.signal.aborted) return;
      if (!result.shapes.length) {
        view.webStatus = "NO OSM FEATURES IN AREA / LOCAL MAP PRESERVED";
      } else {
        // Atomic replacement: a failed fetch never discards the prior offline cache.
        view.onlineShapes = result.shapes;
        view.webMeta = {
          bounds: result.bounds, count: result.count, timestamp: result.timestamp,
          warnings: result.warnings, fetchedAt: Date.now()
        };
        view.webStatus = result.warnings.length
          ? "OSM PARTIAL / CHECK DATA SOURCES"
          : "OSM REFERENCE READY / " + result.shapes.length;
      }
    } catch (error) {
      if (active !== view || !view.webEnabled) return;
      const msg = error instanceof Error ? error.message : "OVERPASS UNAVAILABLE";
      if (/BUSY|429|503|504/.test(msg)) webNextRequestAt = Date.now() + 5 * 60 * 1000;
      view.webStatus = abort.signal.aborted ? "WEB TIMEOUT / MAP PRESERVED"
        : msg.slice(0, 85) + " / MAP PRESERVED";
    } finally {
      clearTimeout(timeout);
      if (view.webAbort === abort) view.webAbort = null;
      view.webBusy = false;
      if (active === view) refresh(view);
    }
  }

  function webToggle(view) {
    if (!view.webEnabled && (view.sitesVisible || view.siteCentered)) {
      view.webStatus = "WEB BLOCKED / CLOSE SITES BEFORE OSM";
      refresh(view);
      return;
    }
    if (view.webEnabled) {
      webOff(view);
    } else {
      view.webEnabled = true; // Explicit consent is never persisted across tabs.
      void webFetch(view);
    }
  }



  function clearCountyPackages(view) {
    view.countyPackageVersion++;
    if (view.countyPackageAbort) view.countyPackageAbort.abort();
    view.countyPackageAbort = null;
    view.countyShapes = [];
    view.countyPackage = null;
    view.countyLoadTiming=null;
    view.paintSamples=[];
  }

  function fitCountyPackage(view) {
    if(!view.countyPackage)return false;
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    let found=false;
    for(const id of COUNTY_ORDER){
      if(!view.countyLayerVisible[countyFilterFor(id)])continue;
      const b=view.countyPackage.layers[id]?.bounds;
      if(!validEnvelope(b))continue;
      bounds[0]=Math.min(bounds[0],b[0]);
      bounds[1]=Math.min(bounds[1],b[1]);
      bounds[2]=Math.max(bounds[2],b[2]);
      bounds[3]=Math.max(bounds[3],b[3]);
      found=true;
    }
    if(!found)return false;
    const [west,south,east,north]=bounds;
    const a=project(west,south), b=project(east,north);
    view.zoom=clamp(Math.floor(Math.log2(Math.min(
      Math.max(80,view.width-50)/Math.max(0.001,Math.abs(b[0]-a[0])),
      Math.max(60,view.height-45)/Math.max(0.001,Math.abs(b[1]-a[1]))))),MIN_ZOOM,16);
    view.center=inverse((a[0]+b[0])/2,(a[1]+b[1])/2);
    view.follow=false;
    return true;
  }

  async function loadCountyPackages(view, geoid, cacheOnly=false) {
    if (active !== view || view.sitesVisible || view.siteCentered ||
        !window.RustBoyCounty?.validGeoid(geoid)) return;
    // Stage each new county separately. No request or parse failure may
    // discard the previous valid county geometry.
    if (view.countyPackageAbort) view.countyPackageAbort.abort();
    const version = ++view.countyPackageVersion;
    const controller = new AbortController();
    view.countyPackageAbort = controller;
    const staged = {geoid,layers:Object.create(null),errors:[]};
    const ingestStarted=monotonicNow();
    view.countyStatus = "COUNTY "+geoid+" / LOADING / OLD MAP KEPT";
    refresh(view);
    try {
      const report = await window.RustBoyCounty.load(geoid,{
        cacheOnly,signal:controller.signal,
        clipRings: view.county?.id === geoid ? view.county.shape.paths : null,
        onStatus: message => {
          if(active===view && view.countyPackageVersion===version) {
            view.countyStatus=message+" / OLD MAP KEPT";refresh(view);
          }
        },
        onLayer: (id,data) => {
          if(active!==view || view.countyPackageVersion!==version ||
              controller.signal.aborted)return;
          // Index built once on validated ingest, not on every pan/zoom.
          if(!Object.keys(staged.layers).length)view.paintSamples=[];
          data.renderIndex=buildCountyIndex(data.shapes);
          if(id==="tiger-roads")
            data.majorRenderIndex=buildCountyIndex(
              data.shapes.filter(shape=>shape.countyMajor));
          staged.layers[id]=data;
          // Hand over after the first validated source; subsequent layers
          // belong to this same GEOID, never a mixture of two counties.
          view.countyPackage=staged;
          view.countyShapes=[
            ...(staged.layers["tiger-areawater"]?.shapes||[]),
            ...(staged.layers["tiger-linearwater"]?.shapes||[]),
            ...(staged.layers["tiger-roads"]?.shapes||[]),
            ...(staged.layers["tiger-pointlm"]?.shapes||[])
          ];
          if(cacheOnly && !view.fix && !view.centerSelected &&
              !view.shapes.length && !view.onlineShapes.length)
            fitCountyPackage(view);
          refresh(view);
        }
      });
      if(active!==view || view.countyPackageVersion!==version)return;
      staged.errors=report.errors;
      staged.warnings=report.warnings || [];
      view.countyLoadTiming={
        ms:Math.max(0,monotonicNow()-ingestStarted),
        features:report.features,cacheOnly
      };
      view.countyStatus="COUNTY "+geoid+" / "+report.features+" REAL FEATURES / "+
        (cacheOnly?"LOCAL CACHE":"CENSUS 2025")+
        (report.errors.length?" / PARTIAL - SEE SOURCES":" / SOURCES LOADED") +
        (staged.warnings.length?" / "+staged.warnings.join("; ").slice(0,90):"");
      refresh(view);
      return Boolean(view.countyPackage?.geoid===geoid);
    }catch(error){
      if(active!==view || view.countyPackageVersion!==version ||
         controller.signal.aborted)return false;
      view.countyStatus="COUNTY "+geoid+" / "+
        (error instanceof Error?error.message:"SOURCE FAILED").slice(0,75)+
        " / PREVIOUS MAP KEPT";
      refresh(view);
      return false;
    }finally{
      if(view.countyPackageAbort===controller)view.countyPackageAbort=null;
    }
  }

  async function restoreCachedCounty(view) {
    if(!window.RustBoyCounty)return;
    const version=++view.countyCacheReadVersion;
    const current=() => active===view && version===view.countyCacheReadVersion &&
      !view.countyEnabled && !view.sitesVisible && !view.centerSelected && !view.fix;
    try {
      const cache=await window.RustBoyCounty.active();
      if(!current() || !cache.active_geoid ||
          (!cache.cached_sources.length && !cache.boundary_cached))return;
      // A county-boundary cache, fetched independently from official TIGERweb
      // by the Rust host, restores POI clipping safely on a cold offline start.
      if(cache.boundary_cached && typeof window.RustBoyCounty.boundary==="function") {
        try {
          const polygon=await window.RustBoyCounty.boundary(cache.active_geoid,{cacheOnly:true});
          if(!current())return;
          view.county=polygon;
          view.countyStatus=polygon.name.toUpperCase()+" / OFFLINE VERIFIED COUNTY";
          if(!cache.cached_sources.length && !view.shapes.length)
            fitLayer(view,[polygon.shape]);
          refresh(view);
        } catch (_) {
          if(!current())return;
          view.countyStatus="COUNTY BOUNDARY CACHE INVALID / LANDMARKS HIDDEN";
          refresh(view);
        }
      }
      if(current() && cache.cached_sources.length)
        void loadCountyPackages(view,cache.active_geoid,true);
    } catch (_) {
      // Missing loopback cache leaves the operator's existing map untouched.
    }
  }

  function invalidateZipLookup(view) {
    view.zipVersion++;
    view.zipChoiceVersion++;
    if(view.zipAbort)view.zipAbort.abort();
    view.zipAbort=null;
    view.zipPageVersion++;
  }

  // ZIP/ZCTA membership is statistical, not a town or position. Fit the
  // verified county polygon rather than inventing a postal ZIP centroid.
  async function selectZipCounty(view,choice,zip,version,controller) {
    if(active!==view||view.zipVersion!==version||controller.signal.aborted)return;
    const choiceVersion=++view.zipChoiceVersion;
    if(view.sitesVisible||view.siteCentered){
      view.zipStatus.textContent="CLOSE SITES BEFORE ZIP COUNTY GIS";return;
    }
    const geoid=choice.geoid;
    view.zipStatus.textContent="ZCTA "+zip+" / COUNTY "+geoid+" / GIS LOADING";
    try {
      const cacheOnly=navigator.onLine===false;
      const county=await window.RustBoyCounty.boundary(geoid,{
        cacheOnly,signal:controller.signal
      });
      if(active!==view||view.zipVersion!==version||view.zipChoiceVersion!==choiceVersion||controller.signal.aborted)return;
      if(county.id!==geoid)throw new Error("COUNTY GEOID MISMATCH");
      const old={county:view.county,enabled:view.countyEnabled,
        package:view.countyPackage,shapes:view.countyShapes,
        center:{...view.center},zoom:view.zoom,follow:view.follow,
        selected:view.centerSelected,last:view.countyLastLookup};
      view.countyRequest++;
      if(view.countyAbort)view.countyAbort.abort();
      view.countyAbort=null;
      view.county=county;view.countyEnabled=true;view.countyLastLookup=null;
      view.countyPackage=null;view.countyShapes=[];
      view.follow=false;view.centerSelected=false;
      fitLayer(view,[county.shape]);
      view.countyStatus="ZIP "+zip+" / 2020 ZCTA → 2025 COUNTY "+geoid;
      refresh(view);
      const loaded=await loadCountyPackages(view,geoid,cacheOnly);
      if(active!==view||view.zipVersion!==version||view.zipChoiceVersion!==choiceVersion||controller.signal.aborted)return;
      if(!loaded){
        view.county=old.county;view.countyEnabled=old.enabled;
        view.countyPackage=old.package;view.countyShapes=old.shapes;
        view.center=old.center;view.zoom=old.zoom;view.follow=old.follow;
        view.centerSelected=old.selected;view.countyLastLookup=old.last;
        view.zipStatus.textContent="ZCTA "+zip+" / GIS FAILED / PREVIOUS MAP KEPT";
        view.countyStatus="COUNTY GIS UNAVAILABLE / PREVIOUS MAP KEPT";
      }else{
        if (view.root.className.includes("rb-map-settings")) stopGps(view);
        view.zipStatus.textContent="ZCTA "+zip+" → "+county.name.toUpperCase()+
          " / "+geoid+" / GIS READY";
      }
      refresh(view);
    }catch(error){
      if(active!==view||view.zipVersion!==version||view.zipChoiceVersion!==choiceVersion||controller.signal.aborted)return;
      view.zipStatus.textContent="ZCTA "+zip+" / "+
        (error instanceof Error?error.message:"COUNTY UNAVAILABLE").slice(0,90);
    }
  }

  async function submitZip(view) {
    if(active!==view)return;
    invalidateZipLookup(view);
    view.zipCandidates.replaceChildren();
    const zip=view.zipInput.value.trim();
    if(!window.RustBoyZip||!window.RustBoyCounty){
      view.zipStatus.textContent="ZIP LOOKUP MODULE UNAVAILABLE";return;
    }
    if(!window.RustBoyZip.validateZip(zip)){
      view.zipStatus.textContent="ENTER FIVE-DIGIT ZIP";return;
    }
    if(view.sitesVisible||view.siteCentered){
      view.zipStatus.textContent="CLOSE SITES BEFORE ZIP LOOKUP";return;
    }
    const version=view.zipVersion,controller=new AbortController();
    view.zipAbort=controller;
    view.zipCandidates.replaceChildren();
    view.zipList.textContent="";
    view.zipStatus.textContent="ZCTA "+zip+" / RESOLVING COUNTIES";
    try {
      const result=await window.RustBoyZip.lookup(zip,{
        cacheOnly:navigator.onLine===false,signal:controller.signal
      });
      if(active!==view||view.zipVersion!==version||controller.signal.aborted)return;
      if(!result.counties.length){
        view.zipStatus.textContent="ZIP "+zip+
          " / NO 2020 ZCTA MATCH (USPS-ONLY ZIP POSSIBLE)";return;
      }
      if(result.counties.length===1){
        await selectZipCounty(view,result.counties[0],zip,version,controller);
        return;
      }
      view.zipStatus.textContent="ZCTA "+zip+" INTERSECTS "+
        result.counties.length+" COUNTIES / CHOOSE ONE";
      for(const county of result.counties){
        const option=control(county.name+" / "+county.geoid+
          " / "+county.zcta_land_share_pct.toFixed(1)+"% AREA",
          ()=>void selectZipCounty(view,county,zip,version,controller),
          "Select "+county.name+" GIS; 2020 ZCTA overlap, not USPS delivery");
        option.className+=" rb-map-zip-choice";
        view.zipCandidates.append(option);
      }
    }catch(error){
      if(active!==view||view.zipVersion!==version||controller.signal.aborted)return;
      view.zipStatus.textContent="ZIP LOOKUP / "+
        (error instanceof Error?error.message:"UNAVAILABLE").slice(0,100);
    }
  }

  async function listCountyZctas(view,offset=0) {
    if(active!==view||!window.RustBoyZip)return;
    const geoid=view.county?.id;
    if(!geoid){
      view.zipStatus.textContent="LOAD COUNTY BEFORE LISTING ZCTAS";return;
    }
    const version=++view.zipPageVersion;
    view.zipListPrev.disabled=true;
    view.zipListNext.disabled=true;
    view.zipList.textContent="COUNTY "+geoid+" / ZCTA INDEX LOADING";
    try {
      const result=await window.RustBoyZip.countyZctas(geoid,{
        offset,cacheOnly:navigator.onLine===false
      });
      if(active!==view||view.zipPageVersion!==version||
        view.county?.id!==geoid)return;
      // Each intersecting ZCTA is a touch target. Selecting one only fills
      // the ZIP input and resolves its county candidates; cross-county ZCTAs
      // still require an explicit choice, never an assumed membership.
      view.zipList.replaceChildren();
      if(result.zctas.length){
        view.zipList.append(make("div","rb-map-zip-list-heading",
          "2020 ZCTAs / COUNTY "+geoid+" / "+(offset+1)+"-"+
          (offset+result.zctas.length)+" OF "+result.total));
        const grid=make("div","rb-map-zip-list-grid");
        for(const zcta of result.zctas){
          const button=control(zcta,()=>{
            view.zipInput.value=zcta;
            void submitZip(view);
          },"Resolve Census ZCTA "+zcta+" to intersecting counties");
          button.className+=" rb-map-zip-list-item";
          grid.append(button);
        }
        view.zipList.append(grid);
      }else{
        view.zipList.textContent="NO 2020 ZCTA INTERSECTIONS";
      }
      view.zipListPrev.disabled=offset===0;
      view.zipListNext.disabled=offset+result.zctas.length>=result.total;
      view.zipOffset=offset;
      view.zipStatus.textContent="2020 ZCTA AREAS / NOT A USPS DELIVERY INVENTORY";
    }catch(error){
      if(active!==view||view.zipPageVersion!==version)return;
      view.zipList.textContent="COUNTY ZCTA LIST / "+
        (error instanceof Error?error.message:"UNAVAILABLE").slice(0,100);
    }
  }

  function disableCounty(view) {
    view.countyEnabled=false;
    invalidateZipLookup(view);
    view.countyRequest++;
    if(view.countyAbort)view.countyAbort.abort();
    view.countyAbort=null;
    view.county=null;
    view.countyLastLookup=null;
    view.countyCacheReadVersion++;
    clearCountyPackages(view);
    view.countyStatus="COUNTY OFF / CACHE PRESERVED";
    refresh(view);
  }
  async function loadCounty(view, location) {
    if(active!==view || !view.countyEnabled || !window.RustBoyOnline) return;
    if(view.county && view.countyLastLookup &&
        Math.abs(view.countyLastLookup.lat-location.lat)<0.012 &&
        Math.abs(view.countyLastLookup.lon-location.lon)<0.012)return;
    if (view.sitesVisible || view.siteCentered) {
      view.countyStatus="CLOSE SITES BEFORE COUNTY LOOKUP";
      refresh(view); return;
    }
    if (navigator.onLine===false) {
      if(view.county && window.RustBoyCounty?.contains &&
          window.RustBoyCounty.contains(view.county.shape.paths,
            location.lon,location.lat)) {
        view.countyStatus="OFFLINE / VERIFIED CACHED COUNTY "+view.county.id;
        refresh(view);
        void loadCountyPackages(view,view.county.id,true);
      } else {
        view.countyStatus="OFFLINE / NO MATCHING CACHED COUNTY / IMPORT LOCAL GIS";
        refresh(view);
      }
      return;
    }
    const version=++view.countyRequest;
    if(view.countyAbort)view.countyAbort.abort();
    const controller=new AbortController();
    view.countyAbort=controller;
    view.countyStatus="CENSUS COUNTY LOOKUP / LOCATION SENT";
    refresh(view);
    try {
      const county=await window.RustBoyOnline.countyAt(location.lon,location.lat,controller.signal);
      if(active!==view || !view.countyEnabled || version!==view.countyRequest) return;
      view.county=county;
      view.countyLastLookup={...location};
      view.countyStatus=county.name.toUpperCase()+" COUNTY / VERIFIED BOUNDARY";
      view.center={lat:location.lat,lon:location.lon};
      view.follow=false;
      view.zoom=Math.max(view.zoom,10);
      refresh(view);
      if(window.RustBoyCounty) {
        // The host independently fetches the exact GEOID boundary and caches
        // it; no GPS coordinate is sent to the loopback boundary endpoint.
        // It is safe to fall back to the live Census polygon for this session
        // if boundary storage or the second Census request is unavailable.
        if(typeof window.RustBoyCounty.boundary==="function") {
          try {
            const saved=await window.RustBoyCounty.boundary(county.id,{
              cacheOnly:false,signal:controller.signal
            });
            if(active!==view || !view.countyEnabled ||
                version!==view.countyRequest || controller.signal.aborted)return;
            view.county=saved;
            view.countyStatus=county.name.toUpperCase()+
              (saved.cacheHit?" / BOUNDARY CACHE REUSED":" / BOUNDARY CACHED");
            refresh(view);
          } catch (error) {
            if(active!==view || !view.countyEnabled ||
                version!==view.countyRequest || controller.signal.aborted)return;
            view.countyStatus=county.name.toUpperCase()+
              " / BOUNDARY CACHE UNAVAILABLE / LIVE CENSUS POLYGON";
            refresh(view);
          }
        }
        if(active===view && view.countyEnabled && version===view.countyRequest)
          void loadCountyPackages(view,county.id,false);
      } else if(view.webEnabled) {
        void webFetch(view);
      } else {
        view.countyStatus += " / NO CENSUS PACKAGE CLIENT / WEB OPTIONAL";
        refresh(view);
      }
    } catch(error) {
      if(active===view && view.countyEnabled && version===view.countyRequest &&
         !controller.signal.aborted){
        view.countyStatus="COUNTY UNAVAILABLE / "+
          (error instanceof Error?error.message:"LOOKUP FAILED").slice(0,90);
        refresh(view);
      }
    } finally {
      if(view.countyAbort===controller)view.countyAbort=null;
    }
  }
  function fitLayer(view, shapes = view.shapes) {
    const points = shapes.flatMap((shape) => shape.paths.flat());
    if (!points.length) return;
    const anchor = points[0][0];
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const point of points) {
      let offset = point[0] - anchor;
      offset -= Math.round(offset / 360) * 360;
      const projected = project(anchor + offset, point[1]);
      left = Math.min(left, projected[0]);
      right = Math.max(right, projected[0]);
      top = Math.min(top, projected[1]);
      bottom = Math.max(bottom, projected[1]);
    }
    const width = Math.max((right - left), 1e-5) * TILE / TILE;
    const height = Math.max((bottom - top), 1e-5) * TILE / TILE;
    const usableWidth = Math.max(80, view.width - 50);
    const usableHeight = Math.max(60, view.height - 45);
    view.zoom = clamp(Math.floor(Math.log2(Math.min(usableWidth / width,
      usableHeight / height))), MIN_ZOOM, 17);
    view.center = inverse((left + right) / 2, (top + bottom) / 2);
    view.follow = false;
  }

  function fitMap(view) {
    if (view.sitesVisible && view.sites.length) fitLocalSites(view);
    else if (fitCountyPackage(view)) { /* Only loaded, enabled layers. */ }
    else if (view.county?.shape && view.countyLayerVisible.boundary)
      fitLayer(view, [view.county.shape]);
    else if (view.shapes.length) fitLayer(view);
    else if (view.onlineShapes.length) fitLayer(view, view.onlineShapes);
    else {
      view.gpsState = "NO GEOGRAPHY TO FIT";
    }
    refresh(view);
  }

  function gpsPolicyAllowed() {
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (!policy || typeof policy.allowsFeature !== "function") return true;
    try { return policy.allowsFeature("geolocation"); } catch (_) { return true; }
  }

  // Read-only permission check; never invokes geolocation or opens a prompt.
  // Browser permissions are separate from OS/app Location Services.
  async function gpsPermissionState(view, attempt) {
    let state = "unknown";
    try {
      if (navigator.permissions && typeof navigator.permissions.query === "function") {
        const result = await navigator.permissions.query({name:"geolocation"});
        if (["granted", "prompt", "denied"].includes(result?.state)) {
          state = result.state;
        }
      }
    } catch (_) {
      // Some browsers and device shells do not support permission introspection.
    }
    if (active === view && view.gpsAttempt === attempt) {
      view.gpsPermission = state;
      refresh(view);
    }
  }

  function stopGps(view, status, issue = null) {
    // Invalidate any late callbacks from a cancelled watch or previous map.
    view.gpsAttempt++;
    const id = view.watchId;
    view.watchId = null;
    view.gpsPending = false;
    if (id !== null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(id); } catch (_) { /* Already stopped. */ }
    }
    view.fix = null;
    view.gpsState = status || "GPS OFF";
    view.gpsIssue = issue;
    if (!issue) view.gpsHelp.open = false;
    refresh(view);
    if (issue) void gpsPermissionState(view, view.gpsAttempt);
  }

  function startGps(view) {
    if (active !== view) return;
    // Clear the prior error only on an explicit GPS ON user action.
    view.gpsIssue = null;
    view.gpsPermission = "checking";
    view.gpsHelp.open = false;
    if (!window.isSecureContext) {
      stopGps(view, "GPS REQUIRES SECURE LOCAL PAGE", "insecure");
      return;
    }
    if (!navigator.geolocation) {
      stopGps(view, "BROWSER HAS NO LOCATION PROVIDER", "unsupported");
      return;
    }
    if (!gpsPolicyAllowed()) {
      stopGps(view, "GPS BLOCKED BY PAGE POLICY", "policy");
      return;
    }
    const attempt = ++view.gpsAttempt;
    view.gpsPending = true;
    view.follow = true;
    view.gpsState = "WAITING FOR BROWSER LOCATION";
    refresh(view);
    // The geolocation call occurs directly in the button event, so any
    // browser permission prompt retains the original user gesture.
    try {
      const id = navigator.geolocation.watchPosition((position) => {
        if (active !== view || view.gpsAttempt !== attempt) return;
        const c = position?.coords;
        const timestamp = position?.timestamp;
        if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) ||
            Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180 ||
            !Number.isFinite(timestamp) || Date.now() - timestamp > 60000 ||
            (view.fix && timestamp < view.fix.timestamp)) {
          view.gpsState = "INVALID OR STALE LOCATION FIX";
          refresh(view);
          return;
        }
        view.gpsPending = false;
        view.gpsIssue = null;
        view.gpsHelp.open = false;
        view.fix = {
          lat: c.latitude, lon: c.longitude, accuracy:
            Number.isFinite(c.accuracy) && c.accuracy >= 0 ? c.accuracy : 0,
          timestamp
        };
        view.gpsState = "BROWSER LOCATION";
        if (view.follow) {
          view.center = { lat: c.latitude, lon: c.longitude };
          view.zoom = Math.max(view.zoom, 14);
          view.centerSelected = false;
        }
        refresh(view);
        if (view.countyEnabled) void loadCounty(view,{lat:c.latitude,lon:c.longitude});
        if (view.webEnabled && (!view.webMeta ||
            !centerInside(view.webMeta.bounds, view.center))) {
          void webFetch(view);
        }
      }, (error) => {
        if (active !== view || view.gpsAttempt !== attempt) return;
        const code = error?.code;
        if (code === 1) {
          stopGps(view, "GPS DENIED / SEE GPS HELP", "denied");
        } else if (code === 3) {
          stopGps(view, "GPS TIMEOUT / SEE GPS HELP", "timeout");
        } else {
          stopGps(view, "GPS POSITION UNAVAILABLE / SEE GPS HELP", "unavailable");
        }
      }, {enableHighAccuracy:false, maximumAge:0, timeout:20000});
      if (active === view && view.gpsAttempt === attempt) {
        view.watchId = id;
      } else {
        // Defend against synchronous callback/error implementations.
        try { navigator.geolocation.clearWatch(id); } catch (_) { /* No watch. */ }
      }
      refresh(view);
      void gpsPermissionState(view, attempt);
    } catch (_) {
      if (active === view && view.gpsAttempt === attempt) {
        stopGps(view, "GPS PROVIDER FAILED / SEE GPS HELP", "unavailable");
      }
    }
  }

  function resize(view) {
    if (active !== view) return;
    const rect = view.settingsMode ? {
      width: mapMemory?.viewportWidth || view.host.getBoundingClientRect().width || 480,
      height: mapMemory?.viewportHeight || Math.max(160, (window.innerHeight || 320) - 90)
    } : view.stage.getBoundingClientRect();
    view.width = Math.max(1, Math.round(rect.width));
    view.height = Math.max(1, Math.round(rect.height));
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.canvas.width = Math.round(view.width * view.dpr);
    view.canvas.height = Math.round(view.height * view.dpr);
    refresh(view);
  }

  function make(tag, className, label) {
    const node = document.createElement(tag);
    node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  }

  function control(text, action, title) {
    const node = make("button", "rb-map-button", text);
    node.type = "button";
    node.title = title || text;
    node.setAttribute("aria-label", title || text);
    node.addEventListener("click", action);
    return node;
  }

  function unmount() {
    if (!active) return;
    const view = active;
    // Keep the accepted area and bounded geography in this page session only.
    // A live fix is never retained; an opted-in visible map gets a fresh watch.
    mapMemory = {
      center: view.siteReturn ? { ...view.siteReturn.center } : { ...view.center },
      zoom: view.siteReturn ? view.siteReturn.zoom : view.zoom,
      shapes: view.shapes, layers: view.layers, warnings: view.warnings,
      layerName: view.layerName, mapName: view.mapName, mapFormat: view.mapFormat,
      onlineShapes: view.onlineShapes, webMeta: view.webMeta,
      county: view.county, countyEnabled: view.countyEnabled,
      countyPackage: view.countyPackage, countyShapes: view.countyShapes,
      countyStatus: view.countyStatus, centerSelected: view.centerSelected,
      countyLastLookup: view.countyLastLookup,
      viewportWidth: view.width, viewportHeight: view.height,
      gpsRequested: view.watchId !== null || view.gpsPending
    };
    // Cancels the GPS watch, clears the live fix, and invalidates late callbacks.
    stopGps(view);
    if (view.observer) view.observer.disconnect();
    if (view.windowResize) window.removeEventListener("resize", view.windowResize);
    if (view.webReconnect) window.removeEventListener("online", view.webReconnect);
    if (view.webDisconnect) window.removeEventListener("offline", view.webDisconnect);
    if (view.webAbort) view.webAbort.abort();
    if (view.webProbeAbort) view.webProbeAbort.abort();
    view.countyRequest++;
    if (view.countyAbort) view.countyAbort.abort();
    invalidateZipLookup(view);
    view.countyCacheReadVersion++;
    clearCountyPackages(view);
    view.siteVersion++;
    if (view.siteAbort) view.siteAbort.abort();
    active = null;
    if (view.host.isConnected) view.host.replaceChildren();
  }

  function mount(host, options) {
    unmount();
    if (!host) return;
    const settingsMode = Boolean(options && options.settingsMode);
    const navigationOnly = Boolean(options && options.navigationOnly);
    const root = make("section", "rb-map" + (settingsMode ? " rb-map-settings" : ""));
    root.setAttribute("aria-label", "Local WGS84 map with imported RustGIS GeoJSON layers");
    const toolbar = make("div", "rb-map-toolbar");
    const stage = make("div", "rb-map-stage");
    const canvas = make("canvas", "rb-map-canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Georeferenced WGS84 map. Pan with a finger or pointer; use zoom buttons.");
    stage.append(canvas);
    const status = make("div", "rb-map-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const file = make("input", "");
    file.type = "file";
    file.accept = ".rgismap,.rgis,.rgislyr,.rgismpk,.rgispkg,.geojson,.json,application/geo+json";
    file.hidden = true;
    const attribution = make("a", "rb-map-attribution",
      "© OpenStreetMap contributors · ODbL");
    attribution.href = "https://www.openstreetmap.org/copyright";
    attribution.target = "_blank";
    attribution.rel = "noopener noreferrer";
    attribution.hidden = true;
    stage.append(attribution);
    const countyAttribution = make("a", "rb-map-base-credit", "US CENSUS / TIGER 2025");
    countyAttribution.href =
      "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html";
    countyAttribution.target = "_blank";
    countyAttribution.rel = "noopener noreferrer";
    countyAttribution.hidden = true;
    stage.append(countyAttribution);
    const webStatusNode = make("div", "rb-map-web-state", "WEB OFF");
    const countyNode = make("div", "rb-map-web-state", "COUNTY OFF / GPS OR CENTER REQUIRED");
    const gpsHelp = make("details", "rb-map-gps-help");
    gpsHelp.hidden = true;
    const gpsHelpSummary = make("summary", "", "GPS HELP");
    const gpsHelpText = make("div", "rb-map-gps-help-text", "");
    gpsHelp.append(gpsHelpSummary, gpsHelpText);

    webStatusNode.setAttribute("role", "status");
    const sourceBox = make("details", "rb-map-sources");
    sourceBox.hidden = true;
    const sourceSummary = make("summary", "", "DATA SOURCES");
    const sourceLines = make("pre", "rb-map-source-text");
    const clearMap = control("CLEAR MAP", () => {
      mapMemory = null;
      webOff(view, false);
      view.shapes = [];
      view.layers = [];
      view.warnings = [];
      view.layerName = "";
      view.mapName = "";
      view.mapFormat = "";
      view.gpsState = "MAP DATA CLEARED";
      refresh(view);
    }, "Discard imported geography from this browser session");
    sourceBox.append(sourceSummary, sourceLines, clearMap);
    const manual = make("form", "rb-map-manual");
    manual.hidden = true;
    const latitude = make("input", "", "");
    latitude.type = "number";
    latitude.step = "any";
    latitude.min = "-90";
    latitude.max = "90";
    latitude.required = true;
    latitude.placeholder = "Latitude";
    latitude.setAttribute("aria-label", "Manual center latitude");
    const longitude = make("input", "", "");
    longitude.type = "number";
    longitude.step = "any";
    longitude.min = "-180";
    longitude.max = "180";
    longitude.required = true;
    longitude.placeholder = "Longitude";
    longitude.setAttribute("aria-label", "Manual center longitude");
    const apply = make("button", "rb-map-button", "SET CENTER");
    apply.type = "submit";
    manual.append(latitude, longitude, apply);
    const zipPanel=make("section","rb-map-zip");
    zipPanel.hidden=true;
    zipPanel.setAttribute("role","region");
    zipPanel.setAttribute("aria-label","ZIP code to county map");
    const zipForm=make("form","rb-map-zip-form");
    const zipInput=make("input","");
    zipInput.type="text";zipInput.inputMode="numeric";
    zipInput.maxLength=5;zipInput.pattern="[0-9]{5}";
    zipInput.required=true;zipInput.placeholder="ZIP 00000";
    zipInput.setAttribute("aria-label","US five-digit ZIP code");
    const zipApply=make("button","rb-map-button","FIND COUNTY");
    zipApply.type="submit";
    zipForm.append(zipInput,zipApply);
    const zipStatus=make("div","rb-map-zip-status",
      "2020 CENSUS ZCTA ≠ USPS ZIP / CHOOSE COUNTY IF MULTIPLE");
    zipStatus.setAttribute("role","status");
    zipStatus.setAttribute("aria-live","polite");
    const zipCandidates=make("div","rb-map-zip-candidates");
    const zipCountyButton=control("COUNTY ZIPs",
      ()=>void listCountyZctas(view,0),
      "List Census 2020 ZCTA areas intersecting selected county");
    zipCountyButton.disabled=true;
    const zipList=make("div","rb-map-zip-list");
    const zipPager=make("div","rb-map-zip-pager");
    const zipListPrev=control("PREV",
      ()=>void listCountyZctas(view,Math.max(0,view.zipOffset-12)),
      "Previous 12 county ZCTA areas");
    const zipListNext=control("NEXT",
      ()=>void listCountyZctas(view,view.zipOffset+12),
      "Next 12 county ZCTA areas");
    zipListPrev.disabled=true;zipListNext.disabled=true;
    zipPager.append(zipCountyButton,zipListPrev,zipListNext);
    zipPanel.append(zipForm,zipStatus,zipCandidates,zipPager,zipList);
    // Separate local marker-list controls allow keyboard/touch selection even
    // though the canvas is a visual layer.
    const sitePanel = make("details", "rb-map-sites");
    sitePanel.hidden = true;
    const siteSummary = make("summary", "", "RECLAMATION / 0 LOCAL SITES");
    const siteStatus = make("div", "rb-map-site-status", "MANUAL POSITIONS / NOT GPS");
    const siteList = make("div", "rb-map-site-list");
    const sitePager = make("div", "rb-map-site-pager");
    const sitePrev = control("◀", () => {
      view.sitePage--;
      renderLocalSiteList(view);
    }, "Previous saved site page");
    const siteNext = control("▶", () => {
      view.sitePage++;
      renderLocalSiteList(view);
    }, "Next saved site page");
    const sitePageLabel = make("span", "", "1/1");
    const siteRefresh = control("REFRESH", () => void loadLocalSites(view),
      "Explicitly reload local site register; no network destination");
    sitePager.append(sitePrev, sitePageLabel, siteNext, siteRefresh);
    sitePanel.append(siteSummary, siteStatus, siteList, sitePager);
    const view = {
      host, root, stage, canvas, status, file, sourceBox, sourceSummary, sourceLines, settingsMode,
      manual, latitude, longitude,
      zipPanel,zipForm,zipInput,zipStatus,zipCandidates,zipCountyButton,
      zipList,zipListPrev,zipListNext,zipOffset:0,zipVersion:0,
      zipAbort:null,zipPageVersion:0,zipChoiceVersion:0,
      width: 0, height: 0, dpr: 1,
      center: mapMemory ? { ...mapMemory.center } : { lat: 0, lon: 0 },
      zoom: mapMemory ? mapMemory.zoom : 2,
      shapes: mapMemory ? mapMemory.shapes : [],
      layers: mapMemory ? mapMemory.layers : [],
      warnings: mapMemory ? mapMemory.warnings : [],
      layerName: mapMemory ? mapMemory.layerName : "",
      mapName: mapMemory ? mapMemory.mapName : "",
      mapFormat: mapMemory ? mapMemory.mapFormat : "",
      onlineShapes: mapMemory ? mapMemory.onlineShapes || [] : [],
      webMeta: mapMemory ? mapMemory.webMeta || null : null,
      county: mapMemory?.county || null, countyEnabled: Boolean(mapMemory?.countyEnabled), countyAbort: null, countyRequest: 0,
      countyLastLookup:mapMemory?.countyLastLookup || null,countyShapes:mapMemory?.countyShapes || [],countyPackage:mapMemory?.countyPackage || null,
      countyLayerVisible:{...countyPreferences},layerButtons:null,
      layerPanel:null,layerSummary:null,renderStats:null,
      paintSamples:[],countyLoadTiming:null,
      paintQueued:false,frameCenter:null,frameScale:null,
      countyPackageAbort:null,countyPackageVersion:0,countyCacheReadVersion:0,

      countyStatus:mapMemory?.countyStatus || "COUNTY OFF / SET LOCATION IN SETTINGS",countyNode,countyButton:null,
      webEnabled: false, webBusy: false, webAbort: null,
      webProbeAbort: null, webProbePromise: null,
      webReconnect: null, webDisconnect: null, webStatus: "WEB OFF",
      attribution, countyAttribution, webStatusNode,
      webButton: null, webRefresh: null,
      fix: null, watchId: null, gpsState: "GPS OFF",
      gpsPending:false, gpsAttempt:0, gpsIssue:null, gpsPermission:"unknown",
      gpsHelp, gpsHelpSummary, gpsHelpText,
      follow: !mapMemory || Boolean(mapMemory.gpsRequested), centerSelected:Boolean(mapMemory?.centerSelected), observer: null, windowResize: null, drag: null,
      locate: null, followButton: null,
      siteAccess: Boolean(options && options.reclamation),
      sitesVisible: false, sites: [], sitePage: 0, selectedSiteId: null,
      siteMarkers: [], siteBusy: false, siteVersion: 0, siteAbort: null,
      siteCentered: false, siteReturn: null,
      sitePanel, siteSummary, siteStatus, siteList, sitePrev, siteNext,
      sitePageLabel, siteRefresh, siteButton: null
    };
    active = view;
    view.locate = control("GPS ON", () => {
      if (view.watchId === null && !view.gpsPending) {
        if (settingsMode) view.countyEnabled = true;
        startGps(view);
      }
      else stopGps(view);
    }, "Enable or stop browser location with permission");
    view.followButton = control("FOLLOW", () => {
      view.follow = true;
      view.centerSelected = false;
      if (view.fix) view.center = { lat: view.fix.lat, lon: view.fix.lon };
      refresh(view);
    }, "Center map on latest location fix");
    view.countyButton = control("COUNTY", () => {
      if(view.countyEnabled){disableCounty(view);return;}
      if(view.sitesVisible || view.siteCentered){
        view.countyStatus="CLOSE SITES BEFORE COUNTY LOOKUP";refresh(view);return;
      }
      view.countyEnabled=true;
      const location=view.centerSelected ? {...view.center} :
        view.fix ? {lat:view.fix.lat,lon:view.fix.lon} : null;
      if(location)void loadCounty(view,location);
      else {view.countyStatus="GPS ON OR ENTER CENTER, THEN COUNTY LOADS";refresh(view);}
    },"Allow Census lookup of current manual/GPS location; then opt-in OSM viewport roads");
    view.siteButton = control("SITES", () => {
      if (view.sitesVisible) hideLocalSites(view);
      else showLocalSites(view);
    }, "Show saved Reclamation sites only on this device; no sharing");
    view.siteButton.hidden = !view.siteAccess;
    view.webButton = control("WEB ON", () => webToggle(view),
      "Enable online road/landmark retrieval; sends map area to Overpass (OSM), not official GIS");
    view.webRefresh = control("SYNC", () => void webFetch(view),
      "Check online access and refresh nearby OSM road reference (rate limited)");
    view.webRefresh.hidden = true;
    const importButton = control("RUSTGIS", () => file.click(),
      "Import native RustGIS map/project/mobile package or GeoJSON");
    const manualButton = control("CENTER", () => {
      manual.hidden = !manual.hidden;
      if (!manual.hidden) latitude.focus();
    }, "Enter map center manually; not a GPS fix");
    const zipButton=control("ZIP",()=>{
      zipPanel.hidden=!zipPanel.hidden;
      if(!zipPanel.hidden)zipInput.focus();
    },"Find county GIS by US five-digit ZIP / Census ZCTA");
    view.fitButton = control("FIT", () => fitMap(view), "Fit available geometry to screen");
    const zoomIn = control("+", () => { view.zoom = clamp(view.zoom + 1, MIN_ZOOM, MAX_ZOOM); refresh(view); },
      "Zoom in");
    const zoomOut = control("-", () => { view.zoom = clamp(view.zoom - 1, MIN_ZOOM, MAX_ZOOM); refresh(view); },
      "Zoom out");
    if (settingsMode) toolbar.append(view.locate, manualButton, zipButton, view.countyButton,
      view.followButton, view.fitButton, zoomIn, zoomOut);
    else if (navigationOnly) { /* Map canvas only; controls live in Settings. */ }
    else toolbar.append(view.locate, view.followButton, manualButton,zipButton,
      view.countyButton, view.fitButton, zoomIn, zoomOut);
    const layerPanel=make("details","rb-map-layers");
    const layerSummary=make("summary","","LAYERS / 4 OF 4 VISIBLE");
    const layerGrid=make("div","rb-map-layer-grid");
    view.layerPanel=layerPanel;
    view.layerSummary=layerSummary;
    view.layerButtons=Object.create(null);
    for(const key of COUNTY_KEYS){
      const button=control(COUNTY_LABELS[key]+" ON",()=>{
        const next=!view.countyLayerVisible[key];
        view.countyLayerVisible[key]=next;
        countyPreferences={...view.countyLayerVisible};
        setLayerStatus(view); // Accessibility state updates on the click, not next RAF.
        refresh(view);
      },"Show or hide Census "+COUNTY_LABELS[key].toLowerCase()+
        " without deleting cached geography or requesting network access");
      view.layerButtons[key]=button;
      layerGrid.append(button);
    }
    layerPanel.append(layerSummary,layerGrid);
    setLayerStatus(view); // Valid aria-pressed from the first paint onward.
    const tools = make("details", "rb-map-tools");
    const extra = make("div", "rb-map-extra");
    extra.append(importButton, view.siteButton, view.webButton, view.webRefresh);
    if (options && typeof options.onTools === "function") {
      extra.append(control("GIS", options.onTools, "Open Scout GIS tools"));
    }
    tools.append(make("summary", "", "TOOLS / MAP SOURCES"), extra);
    view.tools = tools;
    if (settingsMode) {
      root.append(make("p", "rb-map-location-copy",
        "Choose GPS, ZIP or coordinates once. County lookup sends the selected location to Census. GPS resumes only while Map or Location settings is open."));
      apply.textContent = "LOAD AREA";
      root.append(toolbar, zipPanel, manual, countyNode, status, gpsHelp, layerPanel,
        tools, webStatusNode, sitePanel, sourceBox, file, stage);
      stage.hidden = true;
    } else if (navigationOnly) {
      root.append(stage);
      root.classList.add("rb-map-canvas-only");
    } else root.append(toolbar, layerPanel, tools, zipPanel, manual, stage, webStatusNode, countyNode, status, gpsHelp,
      sitePanel, sourceBox, file);
    host.replaceChildren(root);

    zipForm.addEventListener("submit",event=>{
      event.preventDefault();
      void submitZip(view);
    });
    manual.addEventListener("submit", (event) => {
      event.preventDefault();
      const lat = Number(latitude.value), lon = Number(longitude.value);
      if (!latitude.value || !longitude.value || !Number.isFinite(lat) || !Number.isFinite(lon) ||
          Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        view.gpsState = "INVALID MANUAL CENTER";
      } else {
        if (settingsMode) stopGps(view);
        view.center = { lat, lon };
        view.follow = false;
        view.centerSelected = true;
        view.zoom = Math.max(view.zoom, 13);
        view.gpsState = "MANUAL CENTER / NOT A FIX";
        view.siteCentered = false;
        view.siteReturn = null;
        view.selectedSiteId = null;
        manual.hidden = true;
      }
      refresh(view);
      if (settingsMode && view.gpsState==="MANUAL CENTER / NOT A FIX") view.countyEnabled = true;
      if (view.countyEnabled && view.gpsState==="MANUAL CENTER / NOT A FIX")
        void loadCounty(view,{lat,lon});
      else if (view.webEnabled) void webFetch(view);
    });

    file.addEventListener("change", async () => {
      const selected = file.files && file.files[0];
      if (!selected) return;
      try {
        const importer = window.RustBoyMapImport;
        const native = importer && importer.isRustGIS(selected.name);
        let parsed;
        if (native) {
          parsed = await importer.readFile(selected);
        } else {
          if (selected.size > MAX_FILE_BYTES) throw new Error("GeoJSON exceeds 2 MiB");
          const text = await selected.text();
          if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
            throw new Error("GeoJSON exceeds 2 MiB");
          }
          parsed = parseGeoJSON(text);
        }
        if (active !== view) return;
        view.shapes = parsed.shapes;
        view.layers = native ? parsed.layers : [{
          name: selected.name.slice(0, 60), source: "User-selected GeoJSON file",
          features: parsed.features, originalCrs: "WGS84"
        }];
        view.warnings = native ? parsed.warnings : [];
        view.mapName = native ? parsed.mapName : selected.name.slice(0, 50);
        view.mapFormat = native ? parsed.format : "GeoJSON";
        view.layerName = view.mapName + " (" + parsed.features + " features)";
        view.siteCentered = false;
        view.siteReturn = null;
        view.selectedSiteId = null;
        // A current GPS follow fix is authoritative for the viewport center.
        if (view.fix && view.follow) {
          view.center = { lat: view.fix.lat, lon: view.fix.lon };
          view.zoom = Math.max(view.zoom, 14);
        } else if (native && parsed.camera) {
          view.center = { lat: parsed.camera.lat, lon: parsed.camera.lon };
          view.zoom = parsed.camera.zoom;
          view.follow = false;
        } else {
          fitLayer(view);
        }
        view.gpsState = native && parsed.warnings.length ?
          "RUSTGIS VECTOR PARTIAL / VIEW SOURCES" : "LOCAL MAP LOADED";
        refresh(view);
        if (view.webEnabled) void webFetch(view);
      } catch (error) {
        if (active === view) {
          view.gpsState = "MAP ERROR: " + (error instanceof Error ? error.message : "Invalid file");
          refresh(view);
        }
      } finally {
        file.value = "";
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      view.drag = { x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY,
        moved: false, pointer: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!view.drag || view.drag.pointer !== event.pointerId) return;
      const dx = event.clientX - view.drag.x;
      const dy = event.clientY - view.drag.y;
      if (Math.hypot(event.clientX - view.drag.startX,
        event.clientY - view.drag.startY) > 6) view.drag.moved = true;
      view.drag.x = event.clientX;
      view.drag.y = event.clientY;
      const center = project(view.center.lon, view.center.lat);
      view.center = inverse(center[0] - dx / Math.pow(2, view.zoom),
        center[1] - dy / Math.pow(2, view.zoom));
      view.follow = false;
      refresh(view);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (view.drag && !view.drag.moved && view.drag.pointer === event.pointerId) {
        const rect = canvas.getBoundingClientRect();
        const site = siteAtPixel(view, event.clientX - (rect.left || 0),
          event.clientY - (rect.top || 0));
        if (site) {
          focusLocalSite(view, site);
          view.sitePage = Math.floor(view.sites.findIndex((item) => item.id === site.id) / SITE_PAGE_SIZE);
          renderLocalSiteList(view);
        }
      }
      view.drag = null;
    });
    const endDrag = () => { view.drag = null; };
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("lostpointercapture", endDrag);
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      view.zoom = clamp(view.zoom + (event.deltaY < 0 ? 0.5 : -0.5), MIN_ZOOM, MAX_ZOOM);
      refresh(view);
    }, { passive: false });

    view.webReconnect = () => {
      if (active !== view) return;
      if (view.webEnabled) void webFetch(view);
      // No automatic external ping on reconnect.
    };
    view.webDisconnect = () => {
      if (active === view && view.webEnabled) {
        if (view.webAbort) view.webAbort.abort();
        view.webStatus = "OFFLINE / CACHED REFERENCE KEPT";
        refresh(view);
      }
    };
    window.addEventListener("online", view.webReconnect);
    window.addEventListener("offline", view.webDisconnect);

    if ("ResizeObserver" in window) {
      view.observer = new ResizeObserver(() => resize(view));
      view.observer.observe(stage);
    } else {
      view.windowResize = () => resize(view);
      window.addEventListener("resize", view.windowResize);
    }
    window.requestAnimationFrame(() => {
      resize(view);
      if (view.siteAccess && pendingSiteFocus !== null) showLocalSites(view);
      // Entering MAP performs no external requests (cache API is loopback-only).
      if (!view.siteAccess) pendingSiteFocus = null;
      if(!view.siteAccess || pendingSiteFocus===null)void restoreCachedCounty(view);
      if ((settingsMode || navigationOnly) && mapMemory?.gpsRequested) startGps(view);
    });
    return view;
  }

  // Public surface is intentionally small. Import and GNSS data stay in memory.
  window.RustBoyMap = Object.freeze({ mount, mountSettings: (host, options) => mount(host, { ...options, settingsMode:true }), unmount, queueSiteFocus });
})();
