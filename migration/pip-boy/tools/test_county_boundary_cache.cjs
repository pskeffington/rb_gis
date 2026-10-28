"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {fixture,zip}=require("./test_county_sources.cjs");
const {pointShp,pointDbf}=require("./test_pointlm_ingestion.cjs");
const read=name=>fs.readFileSync(
  path.join(__dirname,"../crates/pipboy/assets",name),"utf8");

const rings=[[[-71.2,42.25],[-70.9,42.25],[-70.9,42.5],
  [-71.2,42.5],[-71.2,42.25]]];
const official="U.S. Census TIGERweb State_County ACS 2025 / January 1 2025";
let invalidBoundary=false, remoteBoundary=false, censusLookups=0, gpsCalls=0;
const calls=[];
const packages={
  "tiger-roads":fixture("roads"),
  "tiger-areawater":fixture("areawater"),
  "tiger-linearwater":fixture("linearwater"),
  "tiger-pointlm":zip({
    "tl_2025_25_pointlm.shp":pointShp([[-71.1,42.35],[-70.5,42.35]]),
    "tl_2025_25_pointlm.dbf":pointDbf(["Real County Hospital","Other County Clinic"])
  })
};
const ids=Object.keys(packages);
const boundary=()=>({
  schema:1,geoid:invalidBoundary?"25023":"25025",name:"Suffolk",
  source:official,vintage:"2025-01-01",paths:rings,
  cache_hit:!remoteBoundary,network_used:remoteBoundary
});
const fetchMock=async (url,opts={})=>{
  calls.push({url,opts});
  if(url==="/api/map/cache")return{ok:true,json:async()=>({
    schema:1,active_geoid:"25025",boundary_cached:true,
    cached_sources:ids,vintage:"2025",network_used:false
  })};
  if(url==="/api/map/boundary"){
    const req=JSON.parse(opts.body);
    assert.equal(opts.method,"POST");
    assert.equal(opts.credentials,"omit");
    assert.deepEqual(Object.keys(req).sort(),["cache_only","confirm","geoid"]);
    assert.equal(req.geoid,"25025");
    assert.equal(req.cache_only,!remoteBoundary);
    return{ok:true,json:async()=>boundary()};
  }
  if(url==="/api/map/sources")return{ok:true,json:async()=>({
    schema:1,vintage:"2025",sources:ids.map(id=>({id}))
  })};
  if(url==="/api/map/package"){
    const req=JSON.parse(opts.body);
    assert.equal(req.geoid,"25025");
    assert.ok(ids.includes(req.source));
    assert.equal(req.cache_only,!remoteBoundary);
    return{ok:true,headers:{get:()=>null},
      arrayBuffer:async()=>Uint8Array.from(packages[req.source]).buffer};
  }
  throw new Error("Unexpected external map call: "+url);
};
const window={devicePixelRatio:1,isSecureContext:true,
  addEventListener(){},removeEventListener(){},
  requestAnimationFrame(fn){fn();}};
const navigator={onLine:false,geolocation:{
  watchPosition(){gpsCalls++;throw Error("Unrequested GPS");},
  clearWatch(){}
}};
class E {
  constructor(tag){
    this.tag=tag;this.attrs={};this.listeners={};this.children=[];
    this.className="";this.textContent="";this.value="";this.files=[];
    this.style={};this.hidden=false;this.isConnected=true;this.open=false;
    this.classList={add(){}};
    this.ctx={setTransform(){},clearRect(){},fillRect(){},beginPath(){},
      moveTo(){},lineTo(){},stroke(){},fillText(){},arc(){},fill(){},closePath(){}};
  }
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,cb){(this.listeners[k] ||= []).push(cb);}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  getBoundingClientRect(){return{width:480,height:320,left:0,top:0};}
  getContext(){return this.ctx;}
  setPointerCapture(){}focus(){}click(){}
}
const document={createElement:tag=>new E(tag)};
new Function("window","fetch","TextDecoder","TextEncoder","Blob","DecompressionStream",
  read("map-county.js"))(window,fetchMock,TextDecoder,TextEncoder,Blob,DecompressionStream);
window.RustBoyOnline={
  countyAt:async()=>{censusLookups++;return{
    id:"25025",name:"Suffolk",paths:rings,source:official,
    shape:{kind:"line",paths:rings,style:{stroke:"#ecda94",width:2}}
  };}
};
new Function("window","document","navigator","TextEncoder","fetch",
  read("map.js"))(window,document,navigator,TextEncoder,fetchMock);
async function until(cond){
  for(let n=0;n<200;n++){if(cond())return;await new Promise(resolve=>setImmediate(resolve));}
  throw Error("Timed out waiting for county renderer");
}
const press=button=>button.listeners.click[0]();
async function main(){
  invalidBoundary=true;
  await assert.rejects(
    ()=>window.RustBoyCounty.boundary("25025",{cacheOnly:true}),
    /Untrusted county boundary/);
  invalidBoundary=false;
  await assert.rejects(
    ()=>window.RustBoyCounty.boundary("../foo",{cacheOnly:true}),
    /Invalid county boundary GEOID/);
  const view=window.RustBoyMap.mount(new E("div"));
  await until(()=>view.countyPackage?.layers["tiger-pointlm"]);
  assert.equal(view.county.id,"25025");
  assert.equal(view.county.cacheHit,true);
  assert.equal(view.countyPackage.geoid,"25025");
  assert.equal(view.countyPackage.layers["tiger-pointlm"].features,1);
  assert.ok(view.countyShapes.some(shape=>shape.label==="Real County Hospital"));
  assert.ok(!view.countyShapes.some(shape=>shape.label==="Other County Clinic"));
  assert.match(view.sourceLines.textContent,/STATE archive, verified county clipping/);
  assert.equal(censusLookups,0,"Cold restore has no external county lookup");
  assert.equal(gpsCalls,0,"Cold restore has no GPS prompt");
  assert.equal(view.center.lon<0,true,"Offline restoration fits actual geographic data");
  assert.equal(calls.filter(c=>c.url==="/api/map/package").length,4);
  assert.ok(calls.filter(c=>c.url==="/api/map/package")
    .every(c=>JSON.parse(c.opts.body).cache_only));

  view.latitude.value="42.35";view.longitude.value="-71.05";
  view.manual.listeners.submit[0]({preventDefault(){}});
  press(view.countyButton);
  await until(()=>view.countyStatus.includes("LOCAL CACHE") &&
    view.countyPackage.layers["tiger-pointlm"]);
  assert.equal(censusLookups,0,"Explicit offline COUNTY uses cached boundary");
  assert.ok(view.countyShapes.some(x=>x.label==="Real County Hospital"));
  press(view.countyButton); // County OFF hides layers but preserves local cache.

  // Online COUNTY sends chosen point only to TIGERweb; local boundary
  // service is queried solely with the GEOID, never raw coordinates.
  navigator.onLine=true;remoteBoundary=true;
  press(view.countyButton);
  await until(()=>view.county && view.county.cacheHit===false &&
    view.countyPackage?.layers["tiger-pointlm"]);
  assert.equal(censusLookups,1);
  assert.ok(calls.filter(c=>c.url==="/api/map/boundary")
    .some(c=>JSON.parse(c.opts.body).confirm===true));
  assert.ok(view.countyShapes.some(x=>x.label==="Real County Hospital"));
  window.RustBoyMap.unmount();
  console.log("COUNTY offline: cached boundary, county-only landmarks, no implicit GPS/web, explicit remote GEOID PASS");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
