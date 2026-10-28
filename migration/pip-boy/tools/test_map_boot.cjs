"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
class E {
  constructor(tag){
    this.tag=tag;this.hidden=false;this.children=[];this.listeners={};this.attrs={};
    this.value="";this.textContent="";this.isConnected=true;this.style={};this.files=[];
    this.classList={add(){}};
    this.ctx={setTransform(){},clearRect(){},fillRect(){},beginPath(){},
      moveTo(){},lineTo(){},stroke(){},fillText(){},arc(){},fill(){},closePath(){}};
  }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,fn){(this.listeners[name] ||= []).push(fn);}
  setAttribute(name,val){this.attrs[name]=val;}
  getContext(){return this.ctx;}
  getBoundingClientRect(){return{width:480,height:320,left:0,top:0};}
  focus(){}click(){}setPointerCapture(){}
}
let gps=0,external=0;
const win={devicePixelRatio:1,isSecureContext:true,
  requestAnimationFrame(fn){fn();},addEventListener(){},removeEventListener(){}};
const nav={onLine:true,geolocation:{
  watchPosition(){gps++;throw Error("MAP entry must not request location");},
  clearWatch(){}
}};
const doc={createElement:tag=>new E(tag)};
const code=fs.readFileSync(path.join(__dirname,"../crates/pipboy/assets/map.js"),"utf8");
new Function("window","document","navigator","TextEncoder","fetch",code)(
  win,doc,nav,TextEncoder,async()=>{external++;throw Error("Unexpected network");});
const view=win.RustBoyMap.mount(new E("div"));
assert.equal(gps,0);
assert.equal(external,0,"No external requests on MAP entry");
assert.equal(view.centerSelected,false);
assert.equal(view.fix,null);
assert.equal(view.countyShapes.length,0);
assert.equal(view.shapes.length,0);
assert.equal(view.center.lat,0,"No default city or region");
assert.match(view.status.textContent,/CENTER UNSET/);
assert.match(view.status.textContent,/NO REGION/);
assert.ok(view.tools && view.tools.tag==="details");
assert.ok(view.tools.children[1].children.some(x=>x.textContent==="RUSTGIS"));
assert.ok(view.fitButton.listeners.click?.length);
view.fitButton.listeners.click[0]();
assert.match(view.gpsState,/NO GEOGRAPHY TO FIT/);
view.latitude.value="37.1";view.longitude.value="-81.5";
view.manual.listeners.submit[0]({preventDefault(){}});
assert.equal(view.centerSelected,true);
assert.equal(view.center.lon,-81.5);
assert.equal(view.fix,null);
assert.equal(external,0,"Manual center alone is not a network request");
win.RustBoyMap.unmount();
console.log("MAP blank start: no demo city, no GPS/external requests, manual center, FIT and tool access PASS");
