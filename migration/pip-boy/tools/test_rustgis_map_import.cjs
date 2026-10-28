"use strict";
// Native RustGIS project/package interoperability (no browser or network needed).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const source = fs.readFileSync(path.join(__dirname, "../crates/pipboy/assets/map-import.js"), "utf8");
new Function("window", source)(globalThis);
const api = globalThis.RustBoyMapImport;

const sample = {
  name: "Scout terrain", body: "earth", basemap: "Paper",
  camera: { center: { x: 0, y: 0 }, res: 20 },
  layers: [
    { id: 1, name: "Authorized wells", visible: true, transparency: 0,
      renderer: { Single: { fill: [5, 240, 90, 255], stroke: [0, 10, 0, 255], stroke_width: 1 } },
      dataset: { name: "Wells", source: "County GIS / wells.geojson", fields: [{ name: "name", ty: "Text" }],
        features: [{ id: 1, geometry: { Point: { x: -81.63, y: 37.44 } },
          attrs: [{ Text: "A1" }] }] } },
    { id: 2, name: "County roads", visible: true, transparency: 0,
      renderer: { Single: { fill: [20, 20, 20, 255], stroke: [180, 180, 180, 255], stroke_width: 2 } },
      dataset: { name: "Roads", source: "WV DOT", fields: [], features: [
        { id: 1, geometry: { Line: [[{ x: -81.62, y: 37.43 }, { x: -81.60, y: 37.45 }]] }, attrs: [] }
      ] } }
  ]
};

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function zip(name, text, deflated) {
  const fname = Buffer.from(name);
  const raw = Buffer.from(text);
  const payload = deflated ? zlib.deflateRawSync(raw) : raw;
  const method = deflated ? 8 : 0;
  const prefix = 30 + fname.length + payload.length;
  const dirLen = 46 + fname.length;
  const buf = Buffer.alloc(prefix + dirLen + 22);
  buf.writeUInt32LE(0x04034b50, 0);
  buf.writeUInt16LE(20, 4);
  buf.writeUInt16LE(0x800, 6);
  buf.writeUInt16LE(method, 8);
  buf.writeUInt32LE(crc32(raw), 14);
  buf.writeUInt32LE(payload.length, 18);
  buf.writeUInt32LE(raw.length, 22);
  buf.writeUInt16LE(fname.length, 26);
  fname.copy(buf, 30);
  payload.copy(buf, 30 + fname.length);
  buf.writeUInt32LE(0x02014b50, prefix);
  buf.writeUInt16LE(20, prefix + 4);
  buf.writeUInt16LE(20, prefix + 6);
  buf.writeUInt16LE(0x800, prefix + 8);
  buf.writeUInt16LE(method, prefix + 10);
  buf.writeUInt32LE(crc32(raw), prefix + 16);
  buf.writeUInt32LE(payload.length, prefix + 20);
  buf.writeUInt32LE(raw.length, prefix + 24);
  buf.writeUInt16LE(fname.length, prefix + 28);
  fname.copy(buf, prefix + 46);
  buf.writeUInt32LE(0x06054b50, prefix + dirLen);
  buf.writeUInt16LE(1, prefix + dirLen + 8);
  buf.writeUInt16LE(1, prefix + dirLen + 10);
  buf.writeUInt32LE(dirLen, prefix + dirLen + 12);
  buf.writeUInt32LE(prefix, prefix + dirLen + 16);
  return buf;
}
const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function check() {
  const raw = JSON.stringify(sample);
  const imported = api.parseRustGIS(raw, "field.rgismap");
  assert.equal(imported.shapes.length, 2);
  assert.equal(imported.layers.length, 2);
  assert.equal(imported.shapes[0].layerName, "County roads", "topmost layer is rendered last");
  assert.deepEqual(imported.shapes[1].paths[0][0], [-81.63, 37.44]);
  assert.equal(imported.shapes[1].label, "A1");
  assert.equal(imported.layers[0].source, "WV DOT");
  assert.equal(imported.camera.lat, 0);
  assert.ok(imported.warnings.some((w) => w.includes("backdrop")));

  const project = { name: "Survey", format: 1, maps: [{ ...sample, name: "empty", layers: [] }, sample], active_map: 1 };
  assert.equal(api.parseRustGIS(JSON.stringify(project), "field.rgis").mapName, "Scout terrain");
  assert.throws(() => api.parseRustGIS(JSON.stringify({ ...sample, body: "mars" }), "mars.rgismap"), /Earth maps/);
  assert.throws(() => api.parseRustGIS(JSON.stringify({ ...sample, layers: [
    { ...sample.layers[0], dataset: { ...sample.layers[0].dataset, crs_incomplete: true } }
  ] }), "bad.rgismap"), /incomplete CRS/);
  assert.throws(() => api.parseRustGIS(JSON.stringify({ ...sample, layers: [
    { ...sample.layers[0], source: { path: "/private/streamed.gpkg" } }
  ] }), "empty.rgismap"), /No embedded vector map data/);
  assert.equal(api.parseRustGIS(JSON.stringify({ ...sample, groups: [{ id: 55, visible: false, children: [2] }] }), "group.rgismap").shapes.length, 1);

  for (const deflated of [false, true]) {
    const contents = zip("Scout.rgismap", raw, deflated);
    const inner = await api.readPackage(buffer(contents));
    assert.equal(inner.text, raw);
    assert.equal(inner.name, "Scout.rgismap");
    const file = { name: "Scout.rgismpk", size: contents.length,
      arrayBuffer: () => Promise.resolve(buffer(contents)) };
    assert.equal((await api.readFile(file)).mapName, "Scout terrain");
    // CRC mismatch, not merely a parse error: reject damaged source data.
    const modified = Buffer.from(contents);
    modified.writeUInt32LE(0, 14);
    modified.writeUInt32LE(0, 30 + Buffer.byteLength("Scout.rgismap") + (deflated ? zlib.deflateRawSync(Buffer.from(raw)).length : Buffer.byteLength(raw)) + 16);
    await assert.rejects(api.readPackage(buffer(modified)), /CRC/);
  }
  console.log("RustGIS native map/project/package parsing: PASS");
}
check().catch((error) => { console.error(error); process.exitCode = 1; });
