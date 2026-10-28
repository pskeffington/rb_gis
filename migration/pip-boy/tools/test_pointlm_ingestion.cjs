"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {fixture,zip}=require("./test_county_sources.cjs");

function pointShp(points){
  const recs=points.map(([lon,lat],i)=>{
    const h=Buffer.alloc(8),p=Buffer.alloc(20);
    h.writeInt32BE(i+1,0);h.writeInt32BE(10,4);
    p.writeInt32LE(1,0);p.writeDoubleLE(lon,4);p.writeDoubleLE(lat,12);
    return Buffer.concat([h,p]);
  });
  const header=Buffer.alloc(100);header.writeInt32BE(9994,0);
  header.writeInt32BE((100+recs.reduce((n,x)=>n+x.length,0))/2,24);
  header.writeInt32LE(1000,28);header.writeInt32LE(1,32);
  return Buffer.concat([header,...recs]);
}
function pointDbf(names){
  const width=54,header=97;
  const b=Buffer.alloc(header+names.length*width+1);
  b[0]=3;b.writeUInt32LE(names.length,4);b.writeUInt16LE(header,8);b.writeUInt16LE(width,10);
  Buffer.from("FULLNAME").copy(b,32);b[43]=67;b[48]=48;
  Buffer.from("MTFCC").copy(b,64);b[75]=67;b[80]=5;
  b[96]=0x0D;
  names.forEach((name,i)=>{
    const offset=header+i*width;
    b[offset]=0x20;
    Buffer.from(name).copy(b,offset+1,0,48);
    Buffer.from("K1231").copy(b,offset+49);
  });
  b[b.length-1]=0x1A;
  return b;
}
const rings=[
  [[0,0],[10,0],[10,10],[0,10],[0,0]],
  [[4,4],[6,4],[6,6],[4,6],[4,4]]
];
const source=zip({
  "tl_2025_25_pointlm.shp":pointShp([[1,1],[11,1],[5,5],[8,8]]),
  "tl_2025_25_pointlm.dbf":pointDbf([
    "County Hospital","Different County","Island Hole","County School"
  ])
});
const bundles={
  "tiger-roads":fixture("roads"),
  "tiger-areawater":fixture("areawater"),
  "tiger-linearwater":fixture("linearwater"),
  "tiger-pointlm":source
};
const ids=Object.keys(bundles);
const calls=[];
const fetchMock=async (url,opts={})=>{
  calls.push({url,opts});
  if(url==="/api/map/sources")return{ok:true,json:async()=>({
    schema:1,vintage:"2025",sources:ids.map(id=>({id}))
  })};
  if(url==="/api/map/package"){
    const input=JSON.parse(opts.body);
    assert.equal(input.geoid,"25025");
    assert.ok(ids.includes(input.source));
    return{ok:true,headers:{get:()=>null},
      arrayBuffer:async()=>Uint8Array.from(bundles[input.source]).buffer};
  }
  throw Error("Unexpected local network request: "+url);
};
const win={};
const script=fs.readFileSync(
  path.join(__dirname,"../crates/pipboy/assets/map-county.js"),"utf8");
new Function("window","fetch","TextDecoder","TextEncoder","Blob","DecompressionStream",
  script)(win,fetchMock,TextDecoder,TextEncoder,Blob,DecompressionStream);
async function main(){
  const r=win.RustBoyCounty;
  assert.equal(r.sourceIds.length,4);
  assert.ok(r.sourceIds.includes("tiger-pointlm"));
  await assert.rejects(
    ()=>r.parsePackage(Uint8Array.from(source).buffer,"25025","tiger-pointlm"),
    /County polygon required/);
  const parsed=await r.parsePackage(
    Uint8Array.from(source).buffer,"25025","tiger-pointlm",rings);
  assert.equal(parsed.scope,"state-origin");
  assert.equal(parsed.clip,"verified-county-polygon");
  assert.equal(parsed.records,4);
  assert.equal(parsed.features,2,"Exclude out-of-county and hole points");
  assert.deepEqual(parsed.shapes.map(s=>s.label),["County Hospital","County School"]);
  assert.ok(parsed.shapes.every(s=>s.countyLayer==="pointlm" && s.countyBase));
  const invalid=zip({
    "tl_2025_25025_pointlm.shp":pointShp([[1,1]]),
    "tl_2025_25025_pointlm.dbf":pointDbf(["Wrong scope"])
  });
  await assert.rejects(
    ()=>r.parsePackage(Uint8Array.from(invalid).buffer,"25025","tiger-pointlm",rings),
    /no matching SHP/);
  const mismatched=zip({
    "tl_2025_25_pointlm.shp":pointShp([[1,1],[8,8]]),
    "tl_2025_25_pointlm.dbf":pointDbf(["Only one DBF row"])
  });
  await assert.rejects(
    ()=>r.parsePackage(Uint8Array.from(mismatched).buffer,
      "25025","tiger-pointlm",rings),
    /SHP\/DBF record count mismatch/);
  const clipped=[];
  const report=await r.load("25025",{
    clipRings:rings,onLayer:(id,data)=>clipped.push({id,count:data.features})
  });
  assert.equal(report.errors.length,0);
  assert.equal(report.warnings.length,0);
  assert.equal(report.features,5);
  assert.equal(clipped.find(x=>x.id==="tiger-pointlm").count,2);
  assert.equal(calls.filter(c=>c.url==="/api/map/package").length,4);
  const cached=await r.load("25025",{cacheOnly:true});
  assert.ok(cached.warnings.some(s=>s.includes("POINTLM hidden")));
  assert.ok(!cached.sourceIds.includes("tiger-pointlm"));
  assert.equal(calls.filter(c=>c.url==="/api/map/package").length,7,
    "Offline restore must never fetch/use state POIs without a polygon");
  console.log("POINTLM: real state filename, named point SHP, verified county clip and hole, offline fail-closed PASS");
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={pointShp,pointDbf};
