/* Local Rust Census relationship index. No ZIP or GPS goes to a third party.
 * A 2020 ZCTA is NOT equivalent to a USPS delivery ZIP or a town.
 */
(function(){
  "use strict";
  const ZIP=/^[0-9]{5}$/;
  const GEOID=/^(?!00)[0-9]{2}(?!000)[0-9]{3}$/;
  function bad(message){throw new Error(message);}
  function validateZip(zip){return typeof zip==="string"&&ZIP.test(zip);}
  function validateCounty(geoid){return typeof geoid==="string"&&GEOID.test(geoid);}
  async function lookup(zip,{cacheOnly=false,signal}={}){
    if(!validateZip(zip))bad("ENTER FIVE-DIGIT ZIP");
    const response=await fetch("/api/map/zip",{
      method:"POST",headers:{"Content-Type":"application/json"},
      cache:"no-store",credentials:"omit",signal,
      body:JSON.stringify({zip,confirm:!cacheOnly,cache_only:cacheOnly})
    });
    if(!response.ok)bad("ZIP-TO-COUNTY INDEX "+(cacheOnly?"OFFLINE ":"")+"UNAVAILABLE ("+response.status+")");
    const result=await response.json();
    if(!result || result.schema!==1 || result.zip!==zip ||
      result.relationship_vintage!=="2020" || result.map_vintage!=="2025" ||
      result.interpretation!=="2020 Census ZCTA approximation (not USPS ZIP)" ||
      typeof result.cache_hit!=="boolean" || typeof result.network_used!=="boolean" ||
      (cacheOnly&&(!result.cache_hit||result.network_used)) ||
      !Array.isArray(result.counties)||result.counties.length>24 ||
      !["no_zcta","single_county","multiple_counties"].includes(result.status) ||
      result.requires_selection!==(result.counties.length!==1) ||
      !result.counties.every(row=>row&&validateCounty(row.geoid)&&
        typeof row.name==="string"&&row.name.length>0&&row.name.length<=100&&
        Number.isFinite(row.zcta_land_share_pct)&&
        row.zcta_land_share_pct>=0&&row.zcta_land_share_pct<=100))
      bad("UNTRUSTED CENSUS ZIP RELATIONSHIP");
    if((result.counties.length===0)!==(result.status==="no_zcta") ||
      (result.counties.length>1)!==(result.status==="multiple_counties"))
      bad("INCONSISTENT CENSUS ZIP RELATIONSHIP");
    return result;
  }
  async function countyZctas(geoid,{offset=0,cacheOnly=false,signal}={}){
    if(!validateCounty(geoid)||!Number.isInteger(offset)||offset<0||offset>80000)
      bad("INVALID COUNTY ZIP LIST REQUEST");
    const response=await fetch("/api/map/county-zips",{
      method:"POST",headers:{"Content-Type":"application/json"},
      cache:"no-store",credentials:"omit",signal,
      body:JSON.stringify({geoid,offset,confirm:!cacheOnly,cache_only:cacheOnly})
    });
    if(!response.ok)bad("COUNTY ZCTA INDEX "+(cacheOnly?"OFFLINE ":"")+"UNAVAILABLE ("+response.status+")");
    const data=await response.json();
    if(!data||data.schema!==1||data.geoid!==geoid||data.offset!==offset||
      data.relationship_vintage!=="2020"||
      data.interpretation!=="Intersecting ZCTAs (not USPS ZIP inventory)"||
      !Number.isInteger(data.total)||data.total<0||data.total>80000||
      data.page_size!==12||!Array.isArray(data.zctas)||data.zctas.length>12||
      data.zctas.some(z=>!validateZip(z))||
      typeof data.cache_hit!=="boolean"||typeof data.network_used!=="boolean"||
      (cacheOnly&&(!data.cache_hit||data.network_used)))
      bad("UNTRUSTED COUNTY ZCTA LIST");
    return data;
  }
  window.RustBoyZip=Object.freeze({lookup,countyZctas,validateZip,validateCounty});
})();
