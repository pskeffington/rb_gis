"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(
  path.join(__dirname,"../crates/pipboy/assets",name),"utf8");
class E{
  constructor(tag){
    this.tag=tag;this.listeners={};this.children=[];this.attrs={};
    this.value="";this.textContent="";this.style={};this.files=[];
    this.hidden=false;this.isConnected=true;this.className="";
    this.classList={add(){}};
    this.ctx={setTransform(){},clearRect(){},fillRect(){},beginPath(){},
      moveTo(){},lineTo(){},stroke(){},fill(){},fillText(){},arc(){},closePath(){}};
  }
  append(...x){this.children.push(...x);}
  replaceChildren(...x){this.children=x;}
  addEventListener(k,f){(this.listeners[k]||=[]).push(f);}
  setAttribute(k,v){this.attrs[k]=v;}
  getBoundingClientRect(){return{width:480,height:320,left:0,top:0};}
  getContext(){return this.ctx;}
  focus(){}click(){}setPointerCapture(){}
}
const requests=[],boundaries=[],ingestions=[];
let gps=0,countyPointLookups=0,failedGeoid=null;
const win={isSecureContext:true,devicePixelRatio:1,
  requestAnimationFrame(fn){fn();},addEventListener(){},removeEventListener(){}};
const document={createElement:t=>new E(t)};
const navigator={onLine:true,geolocation:{
  watchPosition(){gps++;throw Error("ZIP should not request GPS");},
  clearWatch(){}
}};
const candidates={
  "02108":[{geoid:"25025",name:"Suffolk County",zcta_land_share_pct:100}],
  "02360":[{geoid:"25023",name:"Plymouth County",zcta_land_share_pct:94.2},
    {geoid:"25001",name:"Barnstable County",zcta_land_share_pct:5.8}],
  "00501":[]
};
const makeJson=value=>({ok:true,status:200,json:async()=>value});
const fetchMock=async(url,init={})=>{
  requests.push({url,body:init.body,method:init.method});
  if(url==="/api/map/zip"){
    const body=JSON.parse(init.body);
    assert.equal(body.confirm,!body.cache_only);
    assert.match(body.zip,/^[0-9]{5}$/);
    assert.equal(init.credentials,"omit");
    const counties=candidates[body.zip]||[];
    return makeJson({
      schema:1,zip:body.zip,relationship_vintage:"2020",
      map_vintage:"2025",
      interpretation:"2020 Census ZCTA approximation (not USPS ZIP)",
      requires_selection:counties.length!==1,
      status:counties.length===0?"no_zcta":counties.length===1?
        "single_county":"multiple_counties",
      counties,cache_hit:body.cache_only,network_used:!body.cache_only
    });
  }
  if(url==="/api/map/county-zips"){
    const body=JSON.parse(init.body);
    assert.equal(body.geoid,"25025");
    const first=Array.from({length:12},(_,i)=>String(2108+i).padStart(5,"0"));
    const list=body.offset===0?first:["02199"];
    return makeJson({
      schema:1,geoid:body.geoid,relationship_vintage:"2020",
      interpretation:"Intersecting ZCTAs (not USPS ZIP inventory)",
      total:13,offset:body.offset,page_size:12,zctas:list,
      cache_hit:body.cache_only,network_used:!body.cache_only
    });
  }
  throw Error("Unexpected external request "+url);
};
new Function("window","fetch",read("map-zip.js"))(win,fetchMock);
win.RustBoyCounty={
  active:async()=>({active_geoid:null,cached_sources:[]}),
  validGeoid:x=>/^[0-9]{5}$/.test(x),
  boundary:async(geoid,{cacheOnly})=>{
    boundaries.push({geoid,cacheOnly});
    const base=geoid==="25025"?-71.1:-70.7;
    const paths=[[[base,42.2],[base+0.12,42.2],
      [base+0.12,42.4],[base,42.2]]];
    return {id:geoid,name:geoid==="25025"?"Suffolk":"County "+geoid,
      paths,source:"U.S. Census TIGERweb",cacheHit:cacheOnly,
      shape:{kind:"line",paths,label:"COUNTY "+geoid,
        style:{stroke:"#ddc984",width:2}}};
  },
  load:async(geoid,{cacheOnly,onLayer,onStatus})=>{
    ingestions.push({geoid,cacheOnly});
    if(geoid===failedGeoid)throw Error("Offline county source unavailable");
    onStatus?.("COUNTY "+geoid);
    const b=geoid==="25025"?-71.1:-70.7;
    const shape={kind:"line",paths:[[[b,42.2],[b+0.09,42.25]]],
      label:"Source Road",countyBase:true,countyLayer:"roads",
      countyMajor:true,bounds:[b,42.2,b+0.09,42.25],style:{stroke:"#99cb84"}};
    onLayer?.("tiger-roads",{
      shapes:[shape],bounds:shape.bounds,features:1,vertices:2
    });
    return{geoid,features:1,errors:[],warnings:[]};
  }
};
new Function("window","document","navigator","TextEncoder","fetch",read("map.js"))(
  win,document,navigator,TextEncoder,fetchMock);
const press=button=>{assert.ok(button.listeners.click?.length);button.listeners.click[0]();};
async function until(fn){
  for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setImmediate(r));}
  throw Error("Timed out: "+String(fn));
}
async function main(){
  assert.equal(win.RustBoyZip.validateZip("00501"),true);
  assert.equal(win.RustBoyZip.validateZip("0501"),false);
  assert.equal(win.RustBoyZip.validateZip("02A08"),false);
  const view=win.RustBoyMap.mount(new E("div"));
  assert.equal(requests.length,0,"Initial map mount is external-traffic free");
  assert.equal(view.zipPanel.hidden,true,"ZIP input collapsed initially");
  const zipToggle=view.root.children[0].children.find(n=>n.textContent==="ZIP");
  assert.ok(zipToggle,"ZIP is in main map toolbar");
  press(zipToggle);
  assert.equal(view.zipPanel.hidden,false);
  view.zipInput.value="02A08";
  view.zipForm.listeners.submit[0]({preventDefault(){}});
  assert.match(view.zipStatus.textContent,/FIVE-DIGIT/);
  assert.equal(requests.length,0,"Invalid ZIP never reaches server");

  view.zipInput.value="02108";
  view.zipForm.listeners.submit[0]({preventDefault(){}});
  await until(()=>view.zipStatus.textContent.includes("GIS READY"));
  assert.equal(view.county.id,"25025");
  assert.equal(view.countyPackage.geoid,"25025");
  assert.equal(view.countyShapes.length,1);
  assert.equal(view.centerSelected,false,"ZIP is not treated as a manual coordinate");
  assert.equal(view.fix,null);
  assert.equal(gps,0);
  assert.equal(countyPointLookups,0);
  assert.equal(boundaries.length,1,"ZIP selection uses direct county GEOID boundary");
  assert.ok(!requests.some(x=>!x.url.startsWith("/api/map/")));
  assert.equal(view.zipCountyButton.disabled,false);

  press(view.zipCountyButton);
  await until(()=>view.zipList.children.length===2);
  assert.equal(view.zipList.children[0].textContent,"2020 ZCTAs / COUNTY 25025 / 1-12 OF 13");
  assert.equal(view.zipList.children[1].children.length,12);
  assert.equal(view.zipList.children[1].children[0].textContent,"02108");
  assert.equal(view.zipListNext.disabled,false);
  press(view.zipListNext);
  assert.equal(view.zipListPrev.disabled,true,
    "Reverse paging is locked while the next page is pending");
  assert.equal(view.zipListNext.disabled,true,
    "Reverse paging does not allow overlapping requests");
  await until(()=>view.zipOffset===12);
  assert.equal(view.zipList.children[0].textContent,"2020 ZCTAs / COUNTY 25025 / 13-13 OF 13");
  assert.equal(view.zipList.children[1].children[0].textContent,"02199");
  assert.equal(view.zipListNext.disabled,true);
  press(view.zipListPrev);
  await until(()=>view.zipOffset===0);

  press(view.zipList.children[1].children[0]);
  await until(()=>view.zipStatus.textContent.includes("GIS READY"));
  assert.equal(view.zipInput.value,"02108");
  assert.equal(view.county.id,"25025");
  assert.equal(gps,0,"Selecting a ZCTA does not request GPS");
  assert.equal(countyPointLookups,0,"Reverse ZCTA lookup uses county GEOID, never coordinates");
  assert.ok(requests.every(item=>item.url.startsWith("/api/map/")),
    "Reverse ZIP selection never contacts an external provider directly");

  const before=boundaries.length;
  view.zipInput.value="02360";
  view.zipForm.listeners.submit[0]({preventDefault(){}});
  await until(()=>view.zipCandidates.children.length===2);
  assert.equal(boundaries.length,before,
    "Multi-county ZIP requires explicit county choice");
  assert.match(view.zipStatus.textContent,/CHOOSE ONE/);
  assert.match(view.zipCandidates.children[0].textContent,/Plymouth/);
  press(view.zipCandidates.children[0]);
  await until(()=>view.county.id==="25023"&&view.zipStatus.textContent.includes("GIS READY"));
  assert.equal(ingestions.at(-1).geoid,"25023");
  assert.equal(view.countyPackage.geoid,"25023");

  view.zipInput.value="00501";
  view.zipForm.listeners.submit[0]({preventDefault(){}});
  await until(()=>view.zipStatus.textContent.includes("NO 2020 ZCTA"));
  assert.equal(view.county.id,"25023","Unmatched ZIP cannot overwrite last map");

  navigator.onLine=false;
  view.zipInput.value="02108";
  view.zipForm.listeners.submit[0]({preventDefault(){}});
  await until(()=>view.zipStatus.textContent.includes("GIS READY"));
  assert.equal(boundaries.at(-1).cacheOnly,true);
  assert.equal(ingestions.at(-1).cacheOnly,true);
  assert.equal(JSON.parse(requests.at(-1).body).cache_only,true);

  failedGeoid="25023";
  view.zipInput.value="02360";
  view.zipForm.listeners.submit[0]({preventDefault(){}});
  await until(()=>view.zipCandidates.children.length===2);
  press(view.zipCandidates.children[0]);
  await until(()=>view.zipStatus.textContent.includes("PREVIOUS MAP KEPT"));
  assert.equal(view.county.id,"25025","Failed GIS replacement restores last valid map");
  assert.equal(view.countyPackage.geoid,"25025");
  assert.equal(gps,0);
  const acceptedCenter = {...view.center};
  const acceptedShapes = view.countyShapes;
  win.RustBoyMap.unmount();
  const callsBeforeNavigation = requests.length;
  const navigation = win.RustBoyMap.mount(new E("div"), {navigationOnly:true});
  assert.equal(navigation.root.children.length,1,"Map only contains the geographic viewport");
  assert.equal(navigation.root.children[0],navigation.stage,"The map stage is the only top-level content");
  assert.ok(!navigation.root.children.includes(navigation.zipPanel));
  assert.ok(!navigation.root.children.includes(navigation.manual));
  assert.equal(navigation.county.id,"25025","Settings/map handoff keeps the selected county");
  assert.equal(navigation.countyShapes,acceptedShapes,"Handoff retains accepted geography");
  assert.deepEqual(navigation.center,acceptedCenter,"Handoff retains the selected area");
  assert.equal(requests.length,callsBeforeNavigation,"Returning to Map does not repeat location lookup");
  win.RustBoyMap.unmount();
  const settings = win.RustBoyMap.mountSettings(new E("div"));
  assert.ok(settings.root.children.includes(settings.zipPanel),"ZIP lives in universal location Settings");
  assert.ok(settings.root.children.includes(settings.manual),"Coordinates live in Settings");
  assert.equal(settings.stage.hidden,true,"Settings does not duplicate the map screen");
  assert.equal(settings.county.id,"25025");
  win.RustBoyMap.unmount();
  console.log("MAP ZIP: validation, single/multi-county, ZCTA reverse paging, offline, rollback, no GPS PASS");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
