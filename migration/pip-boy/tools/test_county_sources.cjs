"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const zlib=require("node:zlib");
const read=name=>fs.readFileSync(path.join(__dirname,"../crates/pipboy/assets/"+name),"utf8");

function crc32(data) {
  let n=0xFFFFFFFF;
  for(const byte of data){n^=byte;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xEDB88320:0);}
  return(n^0xFFFFFFFF)>>>0;
}
function shp(points,kind=3){
 const content=Buffer.alloc(4+32+4+4+4+points.length*16);
 content.writeInt32LE(kind,0);
 const x=points.map(p=>p[0]),y=points.map(p=>p[1]);
 [Math.min(...x),Math.min(...y),Math.max(...x),Math.max(...y)]
   .forEach((n,i)=>content.writeDoubleLE(n,4+i*8));
 content.writeInt32LE(1,36);content.writeInt32LE(points.length,40);
 content.writeInt32LE(0,44);
 points.forEach(([lon,lat],i)=>{content.writeDoubleLE(lon,48+i*16);content.writeDoubleLE(lat,56+i*16)});
 const header=Buffer.alloc(100);header.writeInt32BE(9994,0);
 header.writeInt32BE((100+8+content.length)/2,24);
 header.writeInt32LE(1000,28);header.writeInt32LE(kind,32);
 const record=Buffer.alloc(8);record.writeInt32BE(1,0);record.writeInt32BE(content.length/2,4);
 return Buffer.concat([header,record,content]);
}
function dbf(name,mtfcc="S1100") {
 const width=1+48+5,header=32+64+1;
 const b=Buffer.alloc(header+width+1);
 b[0]=3;b.writeUInt32LE(1,4);b.writeUInt16LE(header,8);b.writeUInt16LE(width,10);
 Buffer.from("FULLNAME").copy(b,32);b[43]=67;b[48]=48;
 Buffer.from("MTFCC").copy(b,64);b[75]=67;b[80]=5;
 b[96]=0x0D;b[97]=0x20;
 Buffer.from(name).copy(b,98,0,48);
 Buffer.from(mtfcc).copy(b,146,0,5);
 b[b.length-1]=0x1A;return b;
}
function zip(entries,compress=false){
 const locals=[],dirs=[];let offset=0;
 for(const [name,unpacked] of Object.entries(entries)){
   const nameBytes=Buffer.from(name,"utf8"),payload=compress?
      zlib.deflateRawSync(unpacked):unpacked,method=compress?8:0;
   const h=Buffer.alloc(30);
   h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(method,8);
   h.writeUInt32LE(crc32(unpacked),14);h.writeUInt32LE(payload.length,18);
   h.writeUInt32LE(unpacked.length,22);h.writeUInt16LE(nameBytes.length,26);
   locals.push(h,nameBytes,payload);
   const d=Buffer.alloc(46);d.writeUInt32LE(0x02014b50,0);
   d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(method,10);
   d.writeUInt32LE(crc32(unpacked),16);d.writeUInt32LE(payload.length,20);
   d.writeUInt32LE(unpacked.length,24);d.writeUInt16LE(nameBytes.length,28);
   d.writeUInt32LE(offset,42);dirs.push(d,nameBytes);
   offset+=h.length+nameBytes.length+payload.length;
 }
 const directory=Buffer.concat(dirs),tail=Buffer.alloc(22);
 tail.writeUInt32LE(0x06054b50,0);tail.writeUInt16LE(Object.keys(entries).length,8);
 tail.writeUInt16LE(Object.keys(entries).length,10);
 tail.writeUInt32LE(directory.length,12);tail.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,tail]);
}
function fixture(layer,geoid="25025",compress=false){
 const stem="tl_2025_"+geoid+"_"+layer;
 const points=layer==="areawater"?
  [[-71.1,42.3],[-71.0,42.3],[-71.0,42.4],[-71.1,42.3]]:
  [[-71.1,42.3],[-71.0,42.4]];
 const shpFile=shp(points,layer==="areawater"?5:3);
 return zip({[stem+".shp"]:shpFile,[stem+".dbf"]:dbf(
   layer==="roads"?"Massachusetts Avenue":layer==="areawater"?"Boston Harbor":"Charles River")},compress);
}
const sourceIds=["tiger-roads","tiger-areawater","tiger-linearwater","tiger-pointlm"];
const calls=[],bundles=Object.fromEntries(sourceIds.slice(0,3).map(id=>[id,fixture(id.slice(6))]));
const manifest={
 schema:1,vintage:"2025",sources:sourceIds.map(id=>({id})),limits:{max_zip_bytes:12582912}
};
const window={},fetchMock=async(url,opts={})=>{
 calls.push({url,opts});
 if(url==="/api/map/sources")return{ok:true,json:async()=>manifest};
 if(url==="/api/map/cache")return{ok:true,json:async()=>({
   schema:1,vintage:"2025",active_geoid:"25025",cached_sources:sourceIds,network_used:false
 })};
 if(url==="/api/map/package"){
   const q=JSON.parse(opts.body);
   assert.equal(q.geoid,"25025");assert.ok(sourceIds.includes(q.source));
   assert.equal(opts.credentials,"omit");assert.equal(opts.method,"POST");
   return{ok:true,headers:{get:()=>null},arrayBuffer:async()=>Uint8Array.from(bundles[q.source]).buffer};
 }
 throw new Error("Unexpected local source request "+url);
};
new Function("window","fetch","TextDecoder","TextEncoder","Blob","DecompressionStream",
  read("map-county.js"))(window,fetchMock,TextDecoder,TextEncoder,Blob,DecompressionStream);

async function main(){
 assert.equal(window.RustBoyCounty.validGeoid("25025"),true);
 assert.equal(window.RustBoyCounty.validGeoid("../../secret"),false);
 assert.equal(window.RustBoyCounty.validGeoid("00000"),false);
 const parsed=await window.RustBoyCounty.parsePackage(
   Uint8Array.from(bundles["tiger-roads"]).buffer,"25025","tiger-roads");
 assert.equal(parsed.features,1);
 assert.equal(parsed.vertices,2);
 assert.deepEqual(parsed.shapes[0].paths[0],[[-71.1,42.3],[-71.0,42.4]]);
 assert.equal(parsed.shapes[0].label,"Massachusetts Avenue");
 assert.equal(parsed.shapes[0].countyMajor,true);
 const harbor=await window.RustBoyCounty.parsePackage(
   Uint8Array.from(bundles["tiger-areawater"]).buffer,"25025","tiger-areawater");
 assert.equal(harbor.shapes[0].kind,"polygon");
 assert.equal(harbor.shapes[0].paths[0].length,4);
 const stream=await window.RustBoyCounty.parsePackage(
   Uint8Array.from(bundles["tiger-linearwater"]).buffer,"25025","tiger-linearwater");
 assert.equal(stream.shapes[0].kind,"line");
 const deflated=fixture("roads","25025",true);
 const dc=await window.RustBoyCounty.parsePackage(
   Uint8Array.from(deflated).buffer,"25025","tiger-roads");
 assert.equal(dc.features,1,"deflated Census ZIP decodes");
 const corrupted=Buffer.from(bundles["tiger-roads"]);
 corrupted[65]^=0x05;
 await assert.rejects(()=>window.RustBoyCounty.parsePackage(
   Uint8Array.from(corrupted).buffer,"25025","tiger-roads"),/CRC|ZIP/);
 await assert.rejects(()=>window.RustBoyCounty.parsePackage(
   Uint8Array.from(bundles["tiger-roads"]).buffer,"00000","tiger-roads"),/Invalid county/);
 const layers=[];
 const r=await window.RustBoyCounty.load("25025",{onLayer:(id,part)=>layers.push([id,part.features])});
 assert.equal(r.features,3);assert.equal(r.errors.length,0);assert.equal(layers.length,3);
 assert.ok(r.warnings.some(x=>x.includes("POINTLM hidden")),"Offline landmarks need polygon");
 assert.equal(calls.filter(c=>c.url==="/api/map/sources").length,1);
 assert.equal(calls.filter(c=>c.url==="/api/map/package").length,3);
 const active=await window.RustBoyCounty.active();
 assert.equal(active.active_geoid,"25025");
 const fromCache=await window.RustBoyCounty.load("25025",{cacheOnly:true});
 assert.equal(fromCache.features,3);
 const p=calls.filter(c=>c.url==="/api/map/package").slice(-3);
 assert.ok(p.every(c=>JSON.parse(c.opts.body).cache_only===true));
 // Integrated MAP: auto restore a cached county without network or GPS.
 class E {
   constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};
     this.isConnected=true;this.hidden=false;this.value="";this.textContent="";
     this.style={};this.className="";this.files=[];this.classList={add(){}};
     this.ctx={setTransform(){},clearRect(){},fillRect(){},beginPath(){},
       moveTo(){},lineTo(){},stroke(){},fillText(){},arc(){},fill(){},closePath(){}};}
   append(...xs){this.children.push(...xs)}
   replaceChildren(...xs){this.children=xs}
   addEventListener(k,v){(this.listeners[k] ||= []).push(v)}
   setAttribute(k,v){this.attrs[k]=v}
   getContext(){return this.ctx}
   getBoundingClientRect(){return{width:480,height:320,left:0,top:0}}
   setPointerCapture(){}focus(){}click(){}
 }
 const doc={createElement:k=>new E(k)};
 const nav={onLine:false,geolocation:{
   watchPosition(){throw Error("Unexpected GPS")},clearWatch(){} }};
 let countyLookups=0;
 window.isSecureContext=true;window.devicePixelRatio=1;
 window.requestAnimationFrame=fn=>fn();
 window.addEventListener=()=>{};window.removeEventListener=()=>{};
 window.RustBoyOnline={
   countyAt:async()=>{countyLookups++;return{
     id:"25025",name:"Suffolk",source:"Census TIGERweb",
     shape:{kind:"line",paths:[[[-71.1,42.3],[-71.0,42.4]]],
       style:{stroke:"#edca83",width:2}},paths:[]};},
   ping:async()=>true
 };
 new Function("window","document","navigator","TextEncoder","fetch",
   read("map.js"))(window,doc,nav,TextEncoder,fetchMock);
 const map=window.RustBoyMap.mount(new E("div"));
 for(let i=0;i<100 && map.countyShapes.length!==3;i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(map.countyShapes.length,3,"cached county automatically populates MAP");
 assert.equal(map.countyPackage.geoid,"25025");
 assert.equal(countyLookups,0,"cache must not request Census or GPS");
 nav.onLine=true;
 map.countyButton.listeners.click[0]();
 map.latitude.value="42.36";map.longitude.value="-71.06";
 map.manual.listeners.submit[0]({preventDefault(){}});
 for(let i=0;i<100 && !map.county;i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(countyLookups,1,"manual CENTER triggers one lookup");
 assert.equal(map.county.id,"25025");
 assert.equal(map.webEnabled,false,"OSM remains separately opt-in");
 window.RustBoyMap.unmount();
 assert.equal(map.countyShapes.length,0,"unmount discards decoded county geometry");
 console.log("County source registry: bounded 2025 ZIP, SHP/DBF, raw geometry, offline cache: PASS");
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture,zip,dbf};
