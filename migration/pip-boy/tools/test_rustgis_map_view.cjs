"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attrs = {};
    this.isConnected = true;
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.className = "";
    this.files = [];
    this.style = {};
    if (tag === "canvas") {
      this.ctx = {
        setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {},
        moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {},
        fill() {}, closePath() {}
      };
    }
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
  focus() {}
  click() {}
  getBoundingClientRect() { return { width: 400, height: 240 }; }
  getContext() { return this.ctx; }
}

const document = { createElement: (tag) => new Element(tag) };
let onFix;
let cancelled;
const navigator = { geolocation: {
  watchPosition(ok) { onFix = ok; return 7; },
  clearWatch(id) { cancelled = id; }
} };
const window = {
  isSecureContext: true, devicePixelRatio: 1,
  requestAnimationFrame(fn) { fn(); },
  addEventListener() {}, removeEventListener() {}
};
const importer = fs.readFileSync(path.join(__dirname, "../crates/pipboy/assets/map-import.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "../crates/pipboy/assets/map.js"), "utf8");
new Function("window", importer)(window);
new Function("window", "document", "navigator", "TextEncoder", renderer)(window, document, navigator, TextEncoder);

async function main() {
  const host = new Element("div");
  const view = window.RustBoyMap.mount(host);
  assert.equal(view.width, 400);
  assert.equal(view.height, 240);
  const nativeMap = {name:"Scout",body:"earth",basemap:"Blank",
    camera:{center:{x:0,y:0},res:40},layers:[{id:1,name:"Trails",visible:true,
      dataset:{name:"Trails",source:"County GIS",fields:[],
        features:[{id:1,geometry:{Line:[[{x:-81,y:37},{x:-81.1,y:37.1}]]},attrs:[]}]},
      renderer:{Single:{fill:[0,255,0,255],stroke:[30,200,30,255],stroke_width:2}}}]};
  const text = JSON.stringify(nativeMap);
  view.file.files = [{ name: "demo.rgismap", size: Buffer.byteLength(text), text: async () => text }];
  await view.file.listeners.change[0]();
  assert.equal(view.shapes.length, 1);
  assert.equal(view.layers[0].source, "County GIS");
  assert.match(view.sourceLines.textContent, /County GIS/);
  assert.equal(view.sourceBox.hidden, false);
  view.locate.listeners.click[0]();
  onFix({ timestamp: Date.now(), coords: { latitude: 37.12, longitude: -81.15, accuracy: 7 } });
  assert.equal(view.center.lat, 37.12);
  assert.equal(view.center.lon, -81.15);
  assert.match(view.status.textContent, /FIX/);
  window.RustBoyMap.unmount();
  assert.equal(cancelled, 7);
  const restored = window.RustBoyMap.mount(new Element("div"));
  assert.equal(restored.shapes.length, 1, "map data remains in volatile page memory");
  assert.equal(restored.fix, null, "location fixes never survive a page switch");
  assert.equal(restored.watchId, null, "GPS watch never resumes automatically");
  assert.match(restored.sourceLines.textContent, /County GIS/);
  const erase = restored.sourceBox.children.find((node) => node.textContent === "CLEAR MAP");
  erase.listeners.click[0]();
  assert.equal(restored.shapes.length, 0);
  window.RustBoyMap.unmount();
  const cleared = window.RustBoyMap.mount(new Element("div"));
  assert.equal(cleared.shapes.length, 0, "cleared geography must not reappear");
  window.RustBoyMap.unmount();
  console.log("RustGIS map import, GPS alignment, volatile reuse and erase: PASS");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
