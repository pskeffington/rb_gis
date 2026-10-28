/* Rust-Boy online reference connector, aligned to RustGIS osm.download presets.
 * Provider: Overpass (OpenStreetMap), NOT authoritative governmental mapping.
 * No network activity happens until the user enables WEB in the MAP screen.
 * The caller supplies a bounded WGS84 viewport and an abort signal.
 */
(function () {
  "use strict";
  // This public Overpass instance requires a Referer for browser requests.
  // Send only the local origin (never the map path, query, or GPS coordinates).
  const STATUS = "https://overpass-api.de/api/status";
  const ENDPOINT = "https://overpass-api.de/api/interpreter";
  const MAX_RESPONSE = 4 * 1024 * 1024;
  const MAX_ELEMENTS = 1800;
  const MAX_SHAPES = 2200;
  const MAX_VERTICES = 50000;
  const MIN_ZOOM = 12.5;
  const MAX_HALF_DEGREES = 0.022;
  const MAX_HALF_LAT = 0.019;
  const TILE = 256;

  function finite(n) { return typeof n === "number" && Number.isFinite(n); }
  function reject(message) { throw new Error(message); }
  function boundsFor(view) {
    if (!view || !view.center || !finite(view.center.lat) ||
        !finite(view.center.lon) || !finite(view.zoom) ||
        !finite(view.width) || !finite(view.height)) reject("MAP AREA NOT READY");
    if (view.zoom < MIN_ZOOM) reject("ZOOM TO 13+ OR ENABLE GPS");
    const { lat, lon } = view.center;
    if (Math.abs(lat) > 84 || Math.abs(lon) > 179.95) {
      reject("WEB DATA UNAVAILABLE AT THIS LAT/LON");
    }
    const scale = TILE * Math.pow(2, view.zoom);
    const halfLon = Math.min(MAX_HALF_DEGREES,
      Math.max(0.002, view.width * 360 / scale * 0.65));
    const halfLat = Math.min(MAX_HALF_LAT,
      Math.max(0.002, view.height * 360 / scale * Math.cos(lat * Math.PI / 180) * 0.65));
    if (lon - halfLon < -180 || lon + halfLon > 180 ||
        lat - halfLat < -85.05 || lat + halfLat > 85.05) {
      reject("WEB AREA CROSSES PROJECTION LIMIT; PAN INWARD");
    }
    // Overpass order in QL is south,west,north,east.
    return [+(lon - halfLon).toFixed(6), +(lat - halfLat).toFixed(6),
      +(lon + halfLon).toFixed(6), +(lat + halfLat).toFixed(6)];
  }

  function qlFor(bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 4 ||
        !bounds.every(finite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3] ||
        (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > 0.003) {
      reject("INVALID WEB QUERY AREA");
    }
    const [w, s, e, n] = bounds;
    return "/* Rust-Boy field viewer github.com/pskeffington/pip_boy / RustGIS OSM presets */" +
      "[out:json][timeout:15][bbox:" + s + "," + w + "," + n + "," + e + "];(" +
      'way["highway"];way["waterway"];way["natural"="water"];' +
      'way["building"];way["leisure"="park"];node["amenity"];node["tourism"];' +
      ");out geom " + MAX_ELEMENTS + ";";
  }

  function styleFor(tags) {
    if (typeof tags.highway === "string") {
      const major = /^(motorway|trunk|primary|secondary|tertiary)/.test(tags.highway);
      return { kind: "line", width: major ? 2.6 : 1.6,
        stroke: major ? "#f3ba78" : "#beceac" };
    }
    if (typeof tags.waterway === "string") {
      return { kind: "line", width: 1.6, stroke: "#6ab4d8" };
    }
    if (typeof tags.building === "string") {
      return { kind: "polygon", width: 0.6, stroke: "#808d79",
        fill: "rgba(114,127,102,0.24)" };
    }
    if (tags.natural === "water") {
      return { kind: "polygon", width: 1, stroke: "#70badf",
        fill: "rgba(64,139,185,0.28)" };
    }
    if (tags.leisure === "park") {
      return { kind: "polygon", width: 1, stroke: "#83c994",
        fill: "rgba(73,134,81,0.23)" };
    }
    if (tags.amenity || tags.tourism) {
      return { kind: "point", width: 1, fill: "#ffdc82", stroke: "#2d382b" };
    }
    return null;
  }

  function parseOverpass(payload) {
    if (!payload || !Array.isArray(payload.elements)) reject("BAD OVERPASS RESPONSE");
    if (payload.remark && !payload.elements.length) reject("OVERPASS SERVER REFUSED QUERY");
    const shapes = [];
    const count = { roads: 0, water: 0, buildings: 0, parks: 0, pois: 0 };
    let vertices = 0, omitted = 0;
    const elements = payload.elements;
    const warnings = [];
    if (elements.length >= MAX_ELEMENTS) {
      warnings.push("OVERPASS LIMIT REACHED; ZOOM IN FOR COMPLETE COVERAGE");
    }
    if (payload.remark) warnings.push("OVERPASS RETURNED A SERVICE REMARK");
    function pair(lon,lat) {
      if (!finite(lon) || !finite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90) return null;
      return [lon,lat];
    }
    for (const entity of elements.slice(0, MAX_ELEMENTS)) {
      const tags = entity && entity.tags;
      if (!tags || typeof tags !== "object") continue;
      const style = styleFor(tags);
      if (!style) continue;
      let kind = style.kind, paths;
      if (entity.type === "node" && kind === "point") {
        const p = pair(entity.lon,entity.lat);
        if (!p) { omitted++;continue; }
        paths = [[p]];
      } else if (entity.type === "way" && Array.isArray(entity.geometry)) {
        const p = entity.geometry.map((c) => c && pair(c.lon,c.lat));
        if (p.length < 2 || p.some((c) => c === null)) { omitted++;continue; }
        if (kind === "point") continue;
        const closed = p.length >= 4 && p[0][0] === p[p.length-1][0] &&
          p[0][1] === p[p.length-1][1];
        if (kind === "polygon" && !closed) {
          // A way crossing the bbox can be incomplete; never draw an artificial filled area.
          kind = "line";
        }
        paths = [p];
      } else continue;
      const v = paths.reduce((n,path) => n+path.length,0);
      if (vertices + v > MAX_VERTICES || shapes.length >= MAX_SHAPES) {
        warnings.push("WEB FEATURE BUDGET REACHED; SHOWING PARTIAL RESULTS");
        break;
      }
      vertices += v;
      if (tags.highway) count.roads++;
      else if (tags.waterway || tags.natural === "water") count.water++;
      else if (tags.building) count.buildings++;
      else if (tags.leisure === "park") count.parks++;
      else count.pois++;
      const label = typeof tags.name === "string" ? tags.name.slice(0,36) : "";
      shapes.push({
        kind, paths, label, layerName: "OSM WEB REFERENCE",
        style: { ...style, opacity: 0.88 }, osmId: entity.type + "/" + String(entity.id).slice(0,22)
      });
    }
    if (omitted) warnings.push(omitted + " MALFORMED FEATURES SKIPPED");
    return { shapes, count, warnings, vertices,
      timestamp: payload.osm3s && typeof payload.osm3s.timestamp_osm_base === "string"
        ? payload.osm3s.timestamp_osm_base.slice(0,40) : null };
  }

  async function readBounded(response) {
    const header = response.headers && response.headers.get("content-length");
    if (header && Number(header) > MAX_RESPONSE) reject("OVERPASS RESPONSE TOO LARGE");
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const parts = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE) {
            await reader.cancel();
            reject("OVERPASS RESPONSE TOO LARGE");
          }
          parts.push(value);
        }
      } finally { reader.releaseLock(); }
      const all = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {all.set(part, offset); offset+=part.byteLength;}
      return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
    }
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE) reject("OVERPASS RESPONSE TOO LARGE");
    return JSON.parse(raw);
  }

  async function ping(signal) {
    // No coordinates or local user data in this request.
    const response = await fetch(STATUS, { method: "GET", mode: "cors", cache: "no-store",
      credentials: "omit", referrerPolicy: "origin", signal });
    if (!response.ok) reject("OVERPASS STATUS HTTP " + response.status);
    if (response.body && typeof response.body.cancel === "function") {
      await response.body.cancel();
    }
    return true;
  }

  async function roads(view, signal) {
    const bounds = boundsFor(view);
    const ql = qlFor(bounds);
    const response = await fetch(ENDPOINT, {
      method: "POST", mode: "cors", cache: "no-store", credentials: "omit",
      referrerPolicy: "origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(ql), signal
    });
    if (!response.ok) {
      if (response.status === 429 || response.status === 503 || response.status === 504) {
        reject("OVERPASS BUSY (" + response.status + "); TRY LATER");
      }
      reject("OVERPASS HTTP " + response.status);
    }
    const parsed = parseOverpass(await readBounded(response));
    return { ...parsed, bounds,
      provider: "OpenStreetMap via RustGIS-compatible Overpass presets",
      endpoint: ENDPOINT, license: "ODbL" };
  }


  // Census TIGERweb public county polygon. It is a legal/statistical boundary,
  // NOT a coastline. The browser must explicitly enable COUNTY once each session.
  const COUNTY_ENDPOINT =
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/37/query";
  async function countyAt(lon, lat, signal) {
    if (!finite(lon) || !finite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
      reject("INVALID COUNTY LOOKUP POSITION");
    const params = new URLSearchParams({
      f: "geojson", geometry: JSON.stringify({x:lon,y:lat}),
      geometryType:"esriGeometryPoint", inSR:"4326", outSR:"4326",
      spatialRel:"esriSpatialRelIntersects", where:"1=1",
      outFields:"GEOID,NAME,STATE,COUNTY", returnGeometry:"true",
      maxAllowableOffset:"0.00015"
    });
    const response = await fetch(COUNTY_ENDPOINT + "?" + params.toString(), {
      method:"GET", mode:"cors", cache:"no-store", credentials:"omit",
      referrerPolicy:"no-referrer", signal
    });
    if (!response.ok) reject("CENSUS COUNTY HTTP " + response.status);
    const payload = await readBounded(response);
    if (!payload || !Array.isArray(payload.features) || payload.features.length !== 1)
      reject("COUNTY NOT FOUND OR AMBIGUOUS");
    const feature = payload.features[0], props=feature.properties || {};
    if (!/^\d{5}$/.test(props.GEOID) || typeof props.NAME !== "string" ||
        props.NAME.length > 100 || !feature.geometry ||
        !["Polygon","MultiPolygon"].includes(feature.geometry.type))
      reject("INVALID CENSUS COUNTY GEOMETRY");
    const polygon=feature.geometry.type==="Polygon"
      ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    let vertices=0;
    const paths=[];
    for (const part of polygon) {
      if (!Array.isArray(part) || !part.length) reject("EMPTY COUNTY POLYGON");
      for (const ring of part) {
        if (!Array.isArray(ring) || ring.length < 4 || (vertices+=ring.length)>12000)
          reject("COUNTY GEOMETRY TOO LARGE");
        const points=ring.map(p => {
          if (!Array.isArray(p) || p.length<2 || !finite(p[0]) || !finite(p[1]) ||
              Math.abs(p[0])>180 || Math.abs(p[1])>90) reject("INVALID COUNTY VERTEX");
          return [p[0],p[1]];
        });
        if (points[0][0]!==points.at(-1)[0] || points[0][1]!==points.at(-1)[1])
          reject("UNCLOSED COUNTY RING");
        paths.push(points);
      }
    }
    return {
      id:props.GEOID, name:props.NAME.slice(0,100), paths,
      source:"U.S. Census TIGERweb State_County ACS 2025 / January 1 2025",
      vintage:"2025-01-01",
      shape:{kind:"line",paths,label:"COUNTY "+props.NAME.slice(0,32),
        style:{stroke:"#ecda94",width:2.1,opacity:0.9}}
    };
  }

  window.RustBoyOnline = Object.freeze({ ping, roads, countyAt, boundsFor, qlFor, parseOverpass,
    attribution: "© OpenStreetMap contributors · ODbL",
    copyright: "https://www.openstreetmap.org/copyright" });
})();
