"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const text=fs.readFileSync(
  path.join(__dirname,"../crates/pipboy/assets/map.js"),"utf8");
const captured=[];
class Node {
  constructor(tag) {
    this.tag=tag;this.children=[];this.listeners={};this.attrs={};
    this.hidden=false;this.open=false;this.isConnected=true;
    this.textContent="";this.value="";this.style={};this.files=[];
    this.classList={add(){}};
    this.ctx={setTransform(){},clearRect(){},fillRect(){},beginPath(){},
      moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},closePath(){},
      fillText(value){captured.push(String(value));}};
  }
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  setAttribute(name,value){this.attrs[name]=value;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  getContext(){return this.ctx;}
  getBoundingClientRect(){return {width:480,height:320,left:0,top:0};}
  setPointerCapture(){}focus(){}click(){}
}
const win={isSecureContext:true,devicePixelRatio:1,
  requestAnimationFrame(fn){fn();},
  addEventListener(){},removeEventListener(){}};
const document={createElement:tag=>new Node(tag)};
const navigator={onLine:false,geolocation:{
  watchPosition(){throw Error("Map layer controls requested GPS");},clearWatch(){}
}};
let queries=0,ingestions=0;
const roads=[];
for(let i=0;i<20000;i++){
  const col=i%200,row=Math.floor(i/200);
  const lon=-80+col*0.05,lat=35+row*0.08;
  roads.push({kind:"line",paths:[[[lon,lat],[lon+0.003,lat+0.002]]],
    label:i%3===0?"Real source road "+i:"",
    countyBase:true,countyLayer:"roads",countyMajor:i%3===0,
    bounds:[lon,lat,lon+0.003,lat+0.002],
    style:{stroke:"#c7deb2",width:1}});
}
roads.push({kind:"line",paths:[[[-75.002,40],[-74.998,40.001]]],
  label:"Unbounded source segment",countyBase:true,countyLayer:"roads",
  countyMajor:true,style:{stroke:"#b9dda1",width:1}});
const water={kind:"polygon",
  paths:[[[-75.01,39.99],[-74.99,39.99],[-74.99,40.01],
    [-75.01,40.01],[-75.01,39.99]]],
  countyBase:true,countyLayer:"areawater",label:"",
  bounds:[-75.01,39.99,-74.99,40.01],
  style:{stroke:"#6c9ca7",fill:"rgba(45,104,115,.3)"}};
const stream={kind:"line",paths:[[[-75.01,39.995],[-74.99,40.005]]],
  countyBase:true,countyLayer:"linearwater",label:"Real Stream",
  bounds:[-75.01,39.995,-74.99,40.005],
  style:{stroke:"#8dbec0",width:1}};
const landmark={kind:"point",paths:[[[-75.001,40]]],
  countyBase:true,countyLayer:"pointlm",label:"Actual Sample Facility",
  bounds:[-75.001,40,-75.001,40],
  style:{fill:"#f9dda0"}};
const sources={
  "tiger-roads":roads,
  "tiger-areawater":[water],
  "tiger-linearwater":[stream],
  "tiger-pointlm":[landmark]
};
win.RustBoyCounty={
  validGeoid:x=>/^\d{5}$/.test(x),
  active:async()=>({active_geoid:"25025",boundary_cached:true,
    cached_sources:Object.keys(sources)}),
  boundary:async()=>({id:"25025",name:"Source County",paths:[
    [[-80,35],[-70,35],[-70,45],[-80,45],[-80,35]]],
    shape:{kind:"line",paths:[[[-80,35],[-70,35],[-70,45],[-80,45],[-80,35]]],
      style:{stroke:"#e8dca8"}}}),
  load:async(_geoid,{onLayer,onStatus})=>{
    ingestions++;
    let features=0;
    for(const [id,shapes] of Object.entries(sources)){
      onStatus?.("SOURCE "+id);
      const bounds=id==="tiger-roads"?[-80,35,-70,43]:
        id==="tiger-pointlm"?[-75.001,40,-75.001,40]:
        id==="tiger-areawater"?water.bounds:stream.bounds;
      features+=shapes.length;
      onLayer?.(id,{shapes,bounds,features:shapes.length,
        vertices:shapes.length*2});
    }
    return {features,errors:[],warnings:[]};
  }
};
new Function("window","document","navigator","TextEncoder","fetch",text)(
  win,document,navigator,TextEncoder,async()=>{queries++;throw Error("Unexpected network");});
const click=button=>{assert.equal(button.tag,"button");button.listeners.click[0]();};
const step=()=>new Promise(resolve=>setImmediate(resolve));
async function until(ok){
  for(let i=0;i<100;i++){if(ok())return;await step();}
  throw Error("Timed out waiting for local layer ingestion");
}
async function main(){
  const view=win.RustBoyMap.mount(new Node("div"));
  await until(()=>Boolean(view.countyPackage?.layers["tiger-pointlm"]));
  assert.ok(view.layerPanel && view.layerPanel.tag==="details");
  assert.equal(view.layerPanel.open,false);
  assert.equal(view.layerPanel.children[1].children.length,4);
  assert.ok(view.countyPackage.layers["tiger-roads"].renderIndex.cells instanceof Map);
  assert.ok(view.countyPackage.layers["tiger-roads"].renderIndex.references<=240000);
  assert.equal(view.countyShapes.length,20004);
  assert.equal(queries,0);
  assert.equal(ingestions,1);

  // At field zoom, a 20k-feature dataset must not be scanned in full.
  view.latitude.value="40";view.longitude.value="-75";
  view.manual.listeners.submit[0]({preventDefault(){}});
  view.zoom=15;
  captured.length=0;
  click(view.layerButtons.boundary); // also forces redraw at zoom 15
  assert.equal(view.renderStats.loaded,20004);
  assert.ok(Number.isFinite(view.renderStats.drawMs) &&
    view.renderStats.drawMs>=0,"Local canvas duration must be measured");
  assert.ok(Number.isFinite(view.renderStats.p95Ms) &&
    view.renderStats.p95Ms>=0,"Local render p95 must be measured");
  assert.ok(view.renderStats.drawSamples>0 &&
    view.renderStats.drawSamples<=60,"Render sample history must be bounded");
  assert.ok(view.countyLoadTiming &&
    Number.isFinite(view.countyLoadTiming.ms),"County ingestion duration recorded");
  assert.ok(view.countyLoadTiming.cacheOnly,"Offline source load identified");
  assert.ok(view.renderStats.candidates<500,
    "Viewport index must limit 20k roads to a few local candidates");
  assert.ok(view.renderStats.byLayer.roads>0);
  assert.equal(view.renderStats.byLayer.landmarks,1);
  assert.ok(captured.some(s=>s.includes("Actual Sample Facility")),
    "Named landmark is prioritized over the road-label budget");
  assert.equal(view.layerButtons.boundary.attrs["aria-pressed"],"false");
  assert.equal(view.renderStats.byLayer.boundary,0);

  click(view.layerButtons.roads);
  assert.equal(view.renderStats.byLayer.roads,0);
  assert.equal(view.layerButtons.roads.attrs["aria-pressed"],"false");
  assert.equal(view.countyShapes.length,20004,"Hiding does not delete source shapes");
  click(view.layerButtons.water);
  assert.equal(view.renderStats.byLayer.water,0);
  click(view.layerButtons.landmarks);
  assert.equal(view.renderStats.byLayer.landmarks,0);
  assert.match(view.status.textContent,/ALL COUNTY LAYERS HIDDEN/);
  assert.equal(ingestions,1,"Layer switches do not re-ingest data");
  assert.equal(queries,0,"Layer switches never initiate network calls");

  click(view.layerButtons.roads);
  click(view.layerButtons.water);
  click(view.layerButtons.landmarks);
  click(view.layerButtons.boundary);
  assert.equal(view.renderStats.byLayer.landmarks,1);
  assert.equal(view.renderStats.byLayer.water,2);
  assert.equal(view.renderStats.byLayer.boundary,1);
  assert.equal(view.layerSummary.textContent,"LAYERS / 4 OF 4 VISIBLE");
  assert.match(view.sourceLines.textContent,/VIEWPORT:/);
  // Overview zoom draws major roads only, without scanning all 20k minor roads.
  view.zoom=9;
  click(view.layerButtons.water);
  click(view.layerButtons.water);
  assert.ok(view.renderStats.candidates<10000,"Zoom-out excludes minor roads before drawing");
  assert.equal(view.renderStats.byLayer.landmarks,0,
    "Point landmarks are suppressed at county overview zoom");

  // Same-session preferences survive the tab lifecycle, not user storage.
  click(view.layerButtons.landmarks);
  win.RustBoyMap.unmount();
  const again=win.RustBoyMap.mount(new Node("div"));
  assert.equal(again.countyLayerVisible.landmarks,false);
  assert.equal(again.layerButtons.landmarks.attrs["aria-pressed"],"false");
  await until(()=>Boolean(again.countyPackage?.layers["tiger-pointlm"]));
  assert.equal(again.renderStats.byLayer.landmarks,0);
  assert.equal(queries,0);
  win.RustBoyMap.unmount();
  console.log("MAP layers: four accessible switches, 20k shape index, POI labels, no network, session state PASS");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
