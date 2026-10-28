"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.hidden=false;this.isConnected=true;this.value="";this.textContent="";this.style={};this.className="";this.files=[];
 this.ctx={setTransform(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},arc(){},fill(){},closePath(){}};
 this.classList={add(){}};}
 append(...x){this.children.push(...x)}replaceChildren(...x){this.children=x}
 setAttribute(k,v){this.attrs[k]=v}addEventListener(k,fn){(this.listeners[k] ||= []).push(fn)}
 getBoundingClientRect(){return{width:480,height:320,left:0,top:0}}
 getContext(){return this.ctx}focus(){}click(){}setPointerCapture(){}
}
const document={createElement:t=>new Element(t)};
const requests=[];
const county={type:"FeatureCollection",features:[{type:"Feature",
 properties:{GEOID:"25025",NAME:"Suffolk",STATE:"25",COUNTY:"025"},
 geometry:{type:"Polygon",coordinates:[[[-71.2,42.3],[-70.9,42.3],[-70.9,42.5],[-71.2,42.3]]]}}]};
const fetchMock=async(url,init)=>{
 requests.push({url,method:init?.method});
 if(url.includes("tigerweb.geo.census.gov"))return{
  ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(county)};
 if(url.includes("/status"))return{ok:true,status:200,body:null};
 if(url.includes("/interpreter"))return{ok:true,status:200,
  headers:{get:()=>null},text:async()=>JSON.stringify({elements:[
   {type:"way",id:3,tags:{highway:"residential",name:"Real Example Road"},geometry:[
    {lon:-71.06,lat:42.35},{lon:-71.065,lat:42.355}]}
  ]})};
 throw new Error("Unexpected endpoint "+url);
};
const window={isSecureContext:true,devicePixelRatio:1,addEventListener(){},
 removeEventListener(){},requestAnimationFrame(fn){fn()}};
const navigator={onLine:true,geolocation:{watchPosition(ok){window.onFix=ok;return 10;},
 clearWatch(){}}};
const read=n=>fs.readFileSync(path.join(__dirname,"../crates/pipboy/assets/"+n),"utf8");
new Function("window","fetch",read("map-online.js"))(window,fetchMock);
new Function("window","document","navigator","TextEncoder","AbortController",read("map.js"))(
 window,document,navigator,TextEncoder,AbortController);
async function until(fn){for(let i=0;i<50;i++){if(fn())return;await new Promise(r=>setImmediate(r));}throw Error("timeout");}
async function main(){
 const view=window.RustBoyMap.mount(new Element("div"));
 assert.equal(requests.filter(x=>x.url.includes("tigerweb")).length,0,"no county lookup on entry");
 view.countyButton.listeners.click[0]();
 assert.match(view.countyStatus,/GPS ON OR ENTER CENTER/);
 view.latitude.value="42.35";view.longitude.value="-71.06";
 view.manual.listeners.submit[0]({preventDefault(){}});
 await until(()=>view.county && view.county.name==="Suffolk");
 assert.equal(view.county.id,"25025");
 assert.equal(view.county.shape.paths.length,1);
 assert.equal(requests.filter(x=>x.url.includes("tigerweb")).length,1);
 assert.match(view.sourceLines.textContent,/Suffolk/);
 assert.equal(view.webEnabled,false,"COUNTY must not silently enable OSM");
 view.webButton.listeners.click[0]();
 await until(()=>view.onlineShapes.length===1);
 assert.equal(view.onlineShapes[0].label,"Real Example Road");
 view.countyButton.listeners.click[0]();
 assert.equal(view.county,null);
 window.RustBoyMap.unmount();
 const again=window.RustBoyMap.mount(new Element("div"));
 assert.equal(again.countyEnabled,false,"county consent not persisted");
 assert.equal(again.county,null,"county geometry not restored");
 window.RustBoyMap.unmount();
 const malformed=JSON.parse(JSON.stringify(county));malformed.features[0].geometry.coordinates[0].pop();
 assert.throws(()=>window.RustBoyOnline.parseOverpass({}),/BAD OVERPASS/);
 console.log("Census county: manual opt-in, exact polygon, viewport road reference, off/remount PASS");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
