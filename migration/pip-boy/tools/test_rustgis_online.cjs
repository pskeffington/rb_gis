"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../crates/pipboy/assets/map-online.js"), "utf8");
const calls = [];
const sample = {
  osm3s: { timestamp_osm_base: "2026-10-25T00:00:00Z" },
  elements: [
    { type: "way", id: 1, tags: { highway: "primary", name: "Main Road" },
      geometry: [{ lon: -81.5, lat: 37.1 }, { lon: -81.49, lat: 37.11 }] },
    { type: "way", id: 2, tags: { building: "yes" },
      geometry: [{ lon: -81.5, lat: 37.1 }, { lon: -81.49, lat: 37.1 },
        { lon: -81.49, lat: 37.11 }, { lon: -81.5, lat: 37.1 }] },
    { type: "way", id: 3, tags: { waterway: "stream" },
      geometry: [{ lon: -81.5, lat: 37.1 }, { lon: -81.48, lat: 37.12 }] },
    { type: "node", id: 4, tags: { amenity: "hospital", name: "Clinic" },
      lon: -81.499, lat: 37.102 },
    { type: "way", id: 5, tags: { leisure: "park" },
      geometry: [{ lon: -81.5, lat: 37.1 }, { lon: -81.49, lat: 37.1 },
        { lon: -81.49, lat: 37.11 }, { lon: -81.5, lat: 37.1 }] },
    { type: "way", id: 6, tags: { building: "yes" },
      geometry: [{ lon: -81.5, lat: 37.1 }, { lon: -81.49, lat: 37.1 }] },
    { type: "way", id: 7, tags: { highway: "secondary" },
      geometry: [{ lon: NaN, lat: 37.1 }] }
  ]
};
let down = false;
let oversized = false;
async function fetchMock(url, opts) {
  calls.push({ url, ...opts });
  if (down) return { ok: false, status: 429 };
  if (url.endsWith("/status")) return { ok: true, status: 200, body: null };
  assert.equal(url, "https://overpass-api.de/api/interpreter");
  return {
    ok: true, status: 200,
    headers: { get: () => oversized ? "9000000" : null },
    body: null, text: async () => JSON.stringify(sample)
  };
}
const window = {};
new Function("window", "fetch", source)(window, fetchMock);
const api = window.RustBoyOnline;

async function run() {
  assert.equal(calls.length, 0, "import must not initiate a request");
  const view = { center: { lat: 37.1, lon: -81.5 }, zoom: 14, width: 480, height: 320 };
  const box = api.boundsFor(view);
  assert.equal(box.length, 4);
  assert.ok(box[0] < -81.5 && box[2] > -81.5);
  assert.ok((box[2]-box[0])*(box[3]-box[1]) < 0.003);
  assert.match(api.qlFor(box), /way\["highway"\]/);
  assert.match(api.qlFor(box), /node\["amenity"\]/);
  assert.throws(() => api.boundsFor({ ...view, zoom: 2 }), /ZOOM TO 13/);
  assert.throws(() => api.boundsFor({ ...view, center: { lat: 85, lon: 0 } }), /UNAVAILABLE/);
  assert.throws(() => api.qlFor([-81, 37, 81, 37.2]), /INVALID/);
  const result = api.parseOverpass(sample);
  assert.equal(result.count.roads, 1);
  assert.equal(result.count.buildings, 2);
  assert.equal(result.count.water, 1);
  assert.equal(result.count.pois, 1);
  assert.equal(result.count.parks, 1);
  assert.equal(result.shapes.length, 6, "malformed geometry skipped");
  assert.deepEqual(result.shapes[0].paths[0][0], [-81.5, 37.1]);
  assert.equal(result.shapes[5].kind, "line", "unfinished polygon never filled");
  assert.equal(result.timestamp, "2026-10-25T00:00:00Z");

  const controller = new AbortController();
  await api.ping(controller.signal);
  assert.equal(calls[0].url, "https://overpass-api.de/api/status");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(calls[0].credentials, "omit");
  assert.equal(calls[0].referrerPolicy, "origin", "send origin-only Referer to Overpass");
  assert.equal(calls[0].body, undefined, "the ping must not contain location");
  const downloaded = await api.roads(view, controller.signal);
  assert.equal(downloaded.shapes.length, 6);
  assert.equal(downloaded.provider.includes("OpenStreetMap"), true);
  assert.equal(downloaded.license, "ODbL");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].referrerPolicy, "origin");
  assert.equal(calls[1].signal, controller.signal);
  assert.match(calls[1].body, /^data=/);
  assert.ok(calls[1].body.length < 1000, "bounding box query should be small");
  assert.ok(!calls[1].body.includes("Bearer"));

  oversized = true;
  await assert.rejects(api.roads(view, controller.signal), /RESPONSE TOO LARGE/);
  oversized = false;
  down = true;
  await assert.rejects(api.roads(view, controller.signal), /OVERPASS BUSY/);
  console.log("RustGIS-compatible Overpass connector: bounds, categories, consent, budgets, failure modes PASS");
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
