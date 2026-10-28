"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {};
    this.isConnected = true; this.hidden = false; this.textContent = ""; this.value = "";
    this.style = {}; this.className = ""; this.files = []; this.open = false;
    this.classList = {add(name) { this.className += " " + name; }};
    this.ctx = {
      setTransform(){}, clearRect(){}, fillRect(){}, beginPath(){}, moveTo(){},
      lineTo(){}, stroke(){}, fillText(){}, arc(){}, fill(){}, closePath(){}
    };
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  getBoundingClientRect() { return {width:480,height:320,left:0,top:0}; }
  getContext() { return this.ctx; }
  setPointerCapture() {}
  click() {}
  focus() {}
}
const doc = {createElement:tag => new Element(tag)};
const positions = [];
const cleared = [];
let immediateDenied = false;
let sitePermission = "denied";
const navigator = {
  onLine:false,
  permissions:{async query(descriptor) {
    assert.equal(descriptor.name,"geolocation");
    return {state:sitePermission};
  }},
  geolocation:{
    watchPosition(success,error,options) {
      const id = positions.length + 1;
      positions.push({id,success,error,options});
      if (immediateDenied) error({code:1});
      return id;
    },
    clearWatch(id) {cleared.push(id);}
  }
};
const window = {
  isSecureContext:true,devicePixelRatio:1,requestAnimationFrame(fn){fn();},
  addEventListener(){},removeEventListener(){},

};
const renderer = fs.readFileSync(path.join(__dirname,
  "../crates/pipboy/assets/map.js"),"utf8");
new Function("window","document","navigator","TextEncoder",renderer)(
  window,doc,navigator,TextEncoder);
const click = node => {
  assert.ok(node.listeners.click?.length, "Expected click handler");
  node.listeners.click[0]();
};
const tick = async () => {await Promise.resolve();await Promise.resolve();};
const position = (lat=42.3601,lon=-71.0589) => ({
  coords:{latitude:lat,longitude:lon,accuracy:24},
  timestamp:Date.now()
});
function view() {return window.RustBoyMap.mount(new Element("div"));}
async function main(){
  let map = view();
  assert.equal(positions.length,0,"Mount never requests browser location");
  assert.equal(map.gpsHelp.hidden,true,"No intrusive GPS help until failure");
  assert.equal(map.fix,null);
  map.latitude.value="42.36";map.longitude.value="-71.06";
  map.manual.listeners.submit[0]({preventDefault(){}});
  click(map.locate);
  assert.equal(positions.length,1);
  assert.equal(map.gpsState,"WAITING FOR BROWSER LOCATION");
  assert.equal(map.gpsPending,true);
  assert.equal(positions[0].options.enableHighAccuracy,false);
  assert.equal(positions[0].options.maximumAge,0);
  assert.ok(positions[0].options.timeout>=12000);
  assert.equal(map.locate.textContent,"GPS OFF","Pending request can be cancelled");
  positions[0].error({code:1});
  await tick();
  assert.equal(map.gpsIssue,"denied");
  assert.equal(map.gpsPermission,"denied");
  assert.equal(map.gpsPending,false);
  assert.equal(map.watchId,null);
  assert.equal(map.locate.textContent,"GPS ON");
  assert.ok(cleared.includes(1),"Denied watch is unregistered");
  assert.match(map.status.textContent,/GPS DENIED/);
  assert.equal(map.gpsHelp.hidden,false);
  assert.match(map.gpsHelpText.textContent,/BROWSER PERMISSION: DENIED/);
  assert.match(map.gpsHelpText.textContent,/address-bar permissions/);
  assert.equal(map.fix,null,"Permission denial never synthesizes coordinates");
  assert.equal(map.center.lon,-71.06);
  assert.equal(map.countyEnabled,false);
  assert.equal(map.webEnabled,false);

  // Browser may say granted while macOS Location Services still denies access.
  sitePermission = "granted";
  click(map.locate);
  assert.equal(positions.length,2);
  positions[1].error({code:1});
  await tick();
  assert.match(map.gpsHelpText.textContent,/Browser says allowed/);
  assert.match(map.gpsHelpText.textContent,/OS Location Services/);

  // Permission can be repaired externally; the next explicit click recovers.
  click(map.locate);
  assert.equal(positions.length,3);
  positions[2].success(position());
  await tick();
  assert.equal(map.gpsIssue,null);
  assert.equal(map.gpsHelp.hidden,true);
  assert.equal(map.gpsPending,false);
  assert.equal(map.fix.lat,42.3601);
  assert.equal(map.center.lon,-71.0589);
  assert.match(map.status.textContent,/FIX 42.36010/);
  click(map.locate);
  assert.equal(map.watchId,null);
  assert.equal(map.fix,null);
  assert.ok(cleared.includes(3));

  // Old watch callback must not recenter a user who selected manual center.
  map.latitude.value="41.8";map.longitude.value="-70.7";
  map.manual.listeners.submit[0]({preventDefault(){}});
  assert.equal(map.center.lon,-70.7);
  assert.equal(map.centerSelected,true,"Manual center is an explicit county target");
  assert.ok(map.tools && map.tools.tag==="details","Advanced tools stay accessible but collapsed");
  assert.ok(map.fitButton && map.fitButton.listeners.click?.length,
    "MAP has an accessible fit-to-geography action");
  assert.ok(map.tools.children[1].children.some(node=>node.textContent==="RUSTGIS"),
    "RustGIS source import remains available in tools");
  positions[2].success(position(10,10));
  assert.equal(map.fix,null);
  assert.equal(map.center.lon,-70.7,"Late callbacks cannot overwrite manual center");

  click(map.locate);
  assert.equal(positions.length,4);
  click(map.locate);
  positions[3].success(position(5,5));
  assert.equal(map.fix,null,"Pending GPS cancellation invalidates callbacks");

  click(map.locate);
  positions[4].error({code:3});
  await tick();
  assert.match(map.status.textContent,/GPS TIMEOUT/);
  assert.match(map.gpsHelpSummary.textContent,/LOCATION TIMED OUT/);
  click(map.locate);
  positions[5].error({code:2});
  await tick();
  assert.match(map.status.textContent,/GPS POSITION UNAVAILABLE/);

  // Synchronous denial during watchPosition must not leave a live watch ID.
  immediateDenied = true;
  click(map.locate);
  await tick();
  assert.equal(map.watchId,null);
  assert.equal(map.gpsPending,false);
  assert.ok(cleared.includes(7));
  immediateDenied=false;

  // A blocked page policy is distinguishable from site or OS permissions.
  doc.permissionsPolicy = {allowsFeature(){return false;}};
  click(map.locate);
  await tick();
  assert.match(map.status.textContent,/BLOCKED BY PAGE POLICY/);
  assert.equal(positions.length,7);
  delete doc.permissionsPolicy;

  window.isSecureContext=false;
  click(map.locate);
  assert.match(map.status.textContent,/SECURE LOCAL PAGE/);
  assert.equal(positions.length,7);
  window.isSecureContext=true;

  window.RustBoyMap.unmount();
  assert.equal(map.fix,null);
  assert.equal(map.watchId,null);
  assert.equal(map.gpsState,"GPS OFF");

  // A new map starts offline and without the denied permission state.
  map=view();
  assert.equal(map.gpsIssue,null);
  assert.equal(map.gpsPermission,"unknown");
  assert.equal(map.gpsHelp.hidden,true);
  assert.equal(positions.length,7);
  window.RustBoyMap.unmount();
  sitePermission="granted";
  let configured=window.RustBoyMap.mountSettings(new Element("div"));
  assert.equal(positions.length,7,"Opening Settings does not grant GPS consent");
  click(configured.locate);
  positions.at(-1).success(position());
  const lastWatch=positions.at(-1);
  const chosen={...configured.center};
  window.RustBoyMap.unmount();
  assert.ok(cleared.includes(lastWatch.id),"Leaving Settings stops its watch");
  const navigation=window.RustBoyMap.mount(new Element("div"),{navigationOnly:true});
  assert.equal(positions.length,9,"Map resumes GPS only after explicit session consent");
  assert.equal(navigation.fix,null,"Last fix is not promoted to a new live fix");
  assert.deepEqual(navigation.center,chosen);
  lastWatch.success(position(1,1));
  assert.deepEqual(navigation.center,chosen,"Detached callbacks cannot change the new map");
  window.RustBoyMap.unmount();
  configured=window.RustBoyMap.mountSettings(new Element("div"));
  click(configured.locate); // Stop the resumed watch.
  const watches=positions.length;
  window.RustBoyMap.unmount();
  window.RustBoyMap.mount(new Element("div"),{navigationOnly:true});
  assert.equal(positions.length,watches,"GPS OFF revokes automatic session resumption");
  window.RustBoyMap.unmount();
  console.log("GPS UX: browser denied/OS denied, recovery, timeout, policy, stale callbacks PASS");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
