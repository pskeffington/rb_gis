"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class Element {
  constructor(tag) {
    this.tag=tag;this.children=[];this.listeners={};this.attrs={};
    this.hidden=false;this.isConnected=true;this.textContent="";this.className="";
    this.value="";this.style={};this.files=[];
    this.ctx={setTransform(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},
      lineTo(){},stroke(){},fillText(){},arc(){},fill(){},closePath(){}};
  }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,fn){(this.listeners[k] ||= []).push(fn);}
  getBoundingClientRect(){return{width:480,height:320};}
  getContext(){return this.ctx;}
  focus(){}
  click(){}
}
const document={createElement:(tag)=>new Element(tag)};
const handlers={};
const window={
  isSecureContext:true,devicePixelRatio:1,
  addEventListener(name,cb){handlers[name]=cb;},
  removeEventListener(name,cb){if(handlers[name]===cb)delete handlers[name];},
  requestAnimationFrame(cb){cb();}
};
const navigator={onLine:true,geolocation:{
  watchPosition(success){window.gpsSuccess=success;return 19;},
  clearWatch(id){window.stoppedWatch=id;}
}};
const requests=[];
const response={elements:[
  {type:"way",id:100,tags:{highway:"secondary",name:"Road"},
    geometry:[{lon:-81.5,lat:37.10},{lon:-81.49,lat:37.11}]},
  {type:"way",id:101,tags:{building:"yes"},
    geometry:[{lon:-81.5,lat:37.10},{lon:-81.49,lat:37.10},
      {lon:-81.49,lat:37.11},{lon:-81.5,lat:37.10}]}
]};
async function fetchMock(url,init){
  requests.push({url,...init});
  if(url.endsWith("/status"))return{ok:true,status:200,body:null};
  if(url.endsWith("/interpreter"))return{ok:true,status:200,body:null,
    headers:{get:()=>null},text:async()=>JSON.stringify(response)};
  throw new Error("unexpected network destination");
}
function loadFile(name,params){
  return fs.readFileSync(path.join(__dirname,"../crates/pipboy/assets/"+name),params||"utf8");
}
new Function("window",loadFile("map-import.js"))(window);
new Function("window","fetch",loadFile("map-online.js"))(window,fetchMock);
new Function("window","document","navigator","TextEncoder",loadFile("map.js"))(window,document,navigator,TextEncoder);

async function until(cond){
  for(let i=0;i<30;i++){if(cond())return;await new Promise((resolve)=>setImmediate(resolve));}
  throw new Error("Timed out waiting for mocked browser operations");
}
async function main(){
  const view=window.RustBoyMap.mount(new Element("div"));
  assert.equal(requests.length,0,"Unlocated MAP start does not ping external providers");

  const native={name:"County",basemap:"Blank",
    layers:[{id:1,name:"Survey",visible:true,dataset:{name:"Survey",
      source:"County GIS",fields:[],features:[{id:1,attrs:[],
        geometry:{Point:{x:-81.5005,y:37.1005}}}]},
      renderer:{Single:{fill:[120,230,110,255],stroke:[20,30,20,255],stroke_width:1}}}]};
  const json=JSON.stringify(native);
  view.file.files=[{name:"county.rgismap",size:Buffer.byteLength(json),text:async()=>json}];
  await view.file.listeners.change[0]();
  assert.equal(view.shapes.length,1);
  assert.equal(requests.length,0,"local import never activates web feature fetch");

  view.latitude.value="37.1";view.longitude.value="-81.5";
  view.manual.listeners.submit[0]({preventDefault(){}});
  assert.ok(view.zoom>=13);
  view.webButton.listeners.click[0]();
  await until(()=>view.onlineShapes.length===2 && !view.webBusy);
  assert.equal(requests.length,2,"one coordinate-free ping, one explicit bbox query");
  assert.equal(requests[1].method,"POST");
  assert.equal(view.shapes.length,1,"authoritative local vector data retained");
  assert.match(view.sourceLines.textContent,/County GIS/);
  assert.match(view.sourceLines.textContent,/OpenStreetMap contributors/);
  assert.equal(view.attribution.hidden,false);
  assert.equal(view.webMeta.count.roads,1);
  const count=requests.length;
  view.webRefresh.listeners.click[0]();
  await until(()=>view.webStatus.includes("OSM CACHE") || view.webStatus.includes("COOLDOWN"));
  assert.equal(requests.length,count,"cached region never triggers duplicate fetch");

  navigator.onLine=false;
  view.webButton.listeners.click[0](); // Disable online requests without erasing cached map.
  assert.equal(view.webEnabled,false);
  assert.equal(view.onlineShapes.length,2);
  view.webButton.listeners.click[0]();
  assert.match(view.webStatus,/OFFLINE/);
  assert.equal(requests.length,count,"offline fallback must issue no new request");

  view.locate.listeners.click[0]();
  window.gpsSuccess({timestamp:Date.now(),coords:{latitude:37.1,longitude:-81.5,accuracy:7}});
  window.RustBoyMap.unmount();
  assert.equal(window.stoppedWatch,19);
  const restored=window.RustBoyMap.mount(new Element("div"));
  assert.equal(restored.shapes.length,1);
  assert.equal(restored.onlineShapes.length,2);
  assert.equal(restored.fix,null);
  assert.equal(restored.webEnabled,false,"web consent not persisted across tabs");
  assert.equal(requests.length,count,"remount does not issue external requests");
  const clear=restored.sourceBox.children.find(x=>x.textContent==="CLEAR MAP");
  assert.ok(clear);
  clear.listeners.click[0]();
  assert.equal(restored.shapes.length,0);
  assert.equal(restored.onlineShapes.length,0);
  window.RustBoyMap.unmount();
  console.log("RustGIS web overlay: no startup traffic, opt-in bbox, native priority, offline cache, cleanup PASS");
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
