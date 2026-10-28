"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {};
    this.attrs = {}; this.hidden = false; this.isConnected = true;
    this.textContent = ""; this.value = ""; this.className = "";
    this.style = {}; this.files = []; this.open = false;
    this.classList = {add: (name) => { this.className += " " + name; }};
    this.ctx = {
      setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {},
      moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {},
      fill() {}, closePath() {}
    };
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, cb) { (this.listeners[k] ||= []).push(cb); }
  getBoundingClientRect() { return { width: 480, height: 320, left: 0, top: 0 }; }
  getContext() { return this.ctx; }
  setPointerCapture() {}
  focus() {}
  click() {}
}
const document = {createElement: (tag) => new Element(tag)};
const navigator = {onLine: false, geolocation: {watchPosition() { throw Error("GPS should not run"); }, clearWatch() {}}};
const window = {
  devicePixelRatio: 1, isSecureContext: true,
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame(cb) { cb(); }
};
const fixture = {
  sites: [
    {id:1, name:"North Intake <unsafe>", latitude:0, longitude:179.9,
      accuracy_m:null, kind:"water", status:"logged", condition:"degraded",
      priority:"urgent", position_source:"manual", notes:"PRIVATE / never on map"},
    {id:2, name:"West Facility", latitude:0, longitude:-179.9,
      accuracy_m:35, kind:"infrastructure", status:"in_progress", condition:"unsafe",
      priority:"high", position_source:"manual", notes:"PRIVATE / never on map"}
  ],
  network_used:false, position_source:"manual"
};
const requests = [];
let pendingResponse = null;
async function fetchMock(url, init) {
  requests.push({url,init});
  if (url === "/api/reclamation") return {
    ok:true, status:200, json:async() => ({book:{sites:fixture.sites}})
  };
  assert.equal(url, "/api/reclamation/map", "map marker flow only reads local endpoint");
  assert.equal(init.credentials, "omit");
  assert.equal(init.cache, "no-store");
  if (pendingResponse) return new Promise((resolve) => { pendingResponse.resolve = resolve; });
  return {ok:true, status:200, json:async() => fixture};
}
const renderer = fs.readFileSync(
  path.join(__dirname, "../crates/pipboy/assets/map.js"), "utf8");
new Function("window", "document", "navigator", "TextEncoder", "fetch", renderer)(
  window, document, navigator, TextEncoder, fetchMock
);
async function until(test) {
  for (let i=0;i<60;i++) {
    if (test()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for local site map");
}

async function main() {
  const denied = window.RustBoyMap.mount(new Element("div"));
  assert.equal(denied.siteButton.hidden, true);
  assert.equal(requests.length, 0, "default map must not read site register");
  window.RustBoyMap.unmount();

  const view = window.RustBoyMap.mount(new Element("div"), {reclamation:true});
  assert.equal(requests.length, 0, "explicit SITES action required");
  assert.equal(view.sitesVisible, false);
  view.siteButton.listeners.click[0]();
  await until(() => view.sites.length === 2 && !view.siteBusy);
  assert.equal(requests.length, 1);
  assert.equal(view.sites[0].notes, undefined, "map data excludes private notes");
  assert.equal(view.sitePanel.hidden, false);
  assert.equal(view.siteMarkers.length, 2, "antimeridian site markers remain visible");
  assert.ok(Math.abs(Math.abs(view.center.lon) - 180) < 2, "fit uses wrapped longitude");
  assert.match(view.status.textContent, /MANUAL/);
  assert.match(view.sourceLines.textContent, /local Reclamation manual observations/);
  assert.equal(view.fix, null, "site center must not fabricate GPS fix");

  const west = view.siteMarkers.find((marker) => marker.id === 2);
  view.canvas.listeners.pointerdown[0]({
    pointerId:4, pointerType:"touch", clientX:west.x, clientY:west.y
  });
  view.canvas.listeners.pointerup[0]({
    pointerId:4, clientX:west.x, clientY:west.y
  });
  assert.equal(view.selectedSiteId, 2, "touch selects a marker");
  assert.equal(view.center.lon, -179.9);
  assert.match(view.status.textContent, /MANUAL SITE/);
  view.webButton.listeners.click[0]();
  assert.equal(view.webEnabled, false, "web bbox must be denied for saved site extents");

  view.siteButton.listeners.click[0]();
  assert.equal(view.sitesVisible, false);
  assert.equal(view.sites.length, 0);
  assert.equal(view.siteMarkers.length, 0);
  assert.equal(view.center.lon, 0, "closing sites restores pre-site camera");
  window.RustBoyMap.unmount();
  const restored = window.RustBoyMap.mount(new Element("div"), {reclamation:true});
  assert.equal(restored.sites.length, 0, "site records are never cached across map mounts");
  assert.equal(restored.center.lon, 0, "site-derived center must not survive map mount");

  pendingResponse = {};
  window.RustBoyMap.queueSiteFocus(1);
  await until(() => typeof pendingResponse.resolve === "function");
  const before = requests.length;
  window.RustBoyMap.unmount();
  pendingResponse.resolve({ok:true, status:200, json:async() => fixture});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(restored.sites.length, 0, "late response must not restore unmapped private sites");
  pendingResponse = null;

  window.RustBoyMap.queueSiteFocus(2);
  const focused = window.RustBoyMap.mount(new Element("div"), {reclamation:true});
  await until(() => focused.selectedSiteId === 2);
  assert.equal(focused.center.lon, -179.9);
  assert.equal(focused.sitesVisible, true);
  assert.equal(focused.fix, null);
  assert.equal(requests.length, before + 1);
  window.RustBoyMap.unmount();
  const ordinary = window.RustBoyMap.mount(new Element("div"));
  assert.equal(ordinary.siteButton.hidden, true, "non-Reclamation map stays isolated");
  assert.equal(ordinary.sites.length, 0);
  window.RustBoyMap.unmount();

  // The register exposes MAP per saved site, with the chosen stable ID.
  const registerCode = fs.readFileSync(
    path.join(__dirname, "../crates/pipboy/assets/reclamation.js"), "utf8");
  new Function("window", "document", "fetch", registerCode)(window, document, fetchMock);
  const register = new Element("div");
  let selectedFromKit = null;
  window.RustBoyReclamation.mount(register, {onMap:(site) => { selectedFromKit = site.id; }});
  await until(() => register.children[4] && register.children[4].children.length === 2);
  const firstCard = register.children[4].children[0];
  const controls = firstCard.children.find((child) => child.className === "rb-rec-actions");
  const mapControl = controls.children.find((child) => child.textContent === "MAP");
  assert.ok(mapControl, "each site offers a map action");
  mapControl.listeners.click[0]();
  assert.equal(selectedFromKit, 1);
  assert.equal(requests.at(-1).url, "/api/reclamation");
  console.log("Reclamation: explicit local markers, kit-to-map focus, privacy and cleanup PASS");
}
main().catch((err) => {console.error(err); process.exitCode = 1;});
