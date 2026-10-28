/* Rust-Boy native RustGIS interchange. Local only: no URL fetch, persistence, or tile request.
 * RustGIS .rgis/.rgismap/.rgislyr are JSON; .rgispkg/.rgismpk contain JSON in ZIP.
 * Geometry uses upstream serde Point/MultiPoint/Line/Polygon with WGS84 {x:lon,y:lat}.
 */
(function () {
  "use strict";
  const MAX_JSON = 12 * 1024 * 1024, MAX_ZIP = 32 * 1024 * 1024;
  const MAX_FEATURES = 8000, MAX_VERTICES = 120000, R = 6378137;
  const bad = (s) => { throw new Error(s); };
  const short = (s, otherwise) => typeof s === "string" && s.trim()
    ? s.trim().slice(0, 80) : otherwise;
  const valid = (n) => typeof n === "number" && Number.isFinite(n);
  const coord = (v) => {
    if (!v || !valid(v.x) || !valid(v.y) || Math.abs(v.x) > 180 || Math.abs(v.y) > 90) {
      bad("Invalid WGS84 coordinates in RustGIS map");
    }
    return [v.x, v.y];
  };
  const color = (v) => Array.isArray(v) && v.length === 4 &&
      v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)
    ? "rgba(" + v[0] + "," + v[1] + "," + v[2] + "," + (v[3] / 255).toFixed(3) + ")"
    : null;
  const opacity = (n) => valid(n) ? Math.max(0, Math.min(1, 1 - n / 100)) : 1;
  function layerStyle(layer, group) {
    const sym = layer.renderer && layer.renderer.Single;
    return {
      fill: sym && color(sym.fill),
      stroke: sym && color(sym.stroke),
      width: sym && valid(sym.stroke_width) ? Math.max(0.5, Math.min(4, sym.stroke_width)) : null,
      opacity: opacity(layer.transparency) * opacity(group && group.transparency)
    };
  }
  function labelFor(f, dataset) {
    if (!f || !Array.isArray(f.attrs) || !Array.isArray(dataset.fields)) return "";
    const index = dataset.fields.findIndex((x) => /^(name|title|label)$/i.test(x && x.name || ""));
    const value = index >= 0 ? f.attrs[index] : null;
    return typeof value === "string" ? value.slice(0, 36)
      : value && typeof value.Text === "string" ? value.Text.slice(0, 36) : "";
  }

  function parseRustGIS(text, filename) {
    if (!text || new TextEncoder().encode(text).byteLength > MAX_JSON) bad("RustGIS map JSON exceeds 12 MiB");
    const root = JSON.parse(text);
    if (!root || typeof root !== "object" || Array.isArray(root)) bad("Not a RustGIS project/map");
    let map, format;
    if (Array.isArray(root.maps)) {
      if (root.format !== undefined && root.format !== 1) bad("Unsupported RustGIS project version");
      if (!root.maps.length || root.maps.length > 32) bad("Invalid RustGIS project map count");
      const i = Number.isInteger(root.active_map) && root.active_map >= 0 &&
        root.active_map < root.maps.length ? root.active_map : 0;
      map = root.maps[i]; format = "RustGIS project";
    } else if (Array.isArray(root.layers)) {
      map = root; format = "RustGIS map";
    } else if (root.dataset && root.renderer && typeof root.visible === "boolean") {
      map = { name: short(root.name, "RustGIS layer"), layers: [root] };
      format = "RustGIS layer";
    } else bad("Expected a RustGIS .rgis, .rgismap, or .rgislyr JSON file");
    if (!map || !Array.isArray(map.layers) || map.layers.length > 128) bad("Invalid RustGIS layer inventory");
    if (map.body && map.body !== "earth") bad("Only Earth maps can follow GPS");
    const groups = new Map();
    if (Array.isArray(map.groups)) {
      if (map.groups.length > 128) bad("Too many RustGIS layer groups");
      for (const g of map.groups) if (Array.isArray(g.children)) {
        for (const id of g.children) groups.set(id, g);
      }
    }
    const shapes = [], layers = [], warnings = [];
    let features = 0, vertices = 0, omittedRaster = 0, omittedStream = 0;
    let omittedHidden = 0, omittedNull = 0, simplified = 0;
    const omittedTiles = Array.isArray(map.tiles) ? map.tiles.length : 0;
    function path(p, length) {
      if (!Array.isArray(p) || p.length < length) bad("Invalid RustGIS line/ring geometry");
      vertices += p.length;
      if (vertices > MAX_VERTICES) bad("Map exceeds 120,000 vertices; package a smaller field area");
      return p.map(coord);
    }
    function geometry(g, label, name, style) {
      if (!g || typeof g !== "object" || Array.isArray(g)) bad("Malformed RustGIS geometry");
      const keys = Object.keys(g);
      if (keys.length !== 1) bad("Unknown RustGIS geometry format");
      const tag = keys[0], value = g[tag];
      if (tag === "Point") {
        vertices++;
        shapes.push({kind:"point",paths:[[coord(value)]],label,layerName:name,style});
      } else if (tag === "MultiPoint") {
        shapes.push({kind:"point",paths:[path(value,1)],label,layerName:name,style});
      } else if (tag === "Line") {
        if (!Array.isArray(value) || !value.length) bad("Empty RustGIS line");
        shapes.push({kind:"line",paths:value.map((v)=>path(v,2)),label,layerName:name,style});
      } else if (tag === "Polygon") {
        if (!Array.isArray(value) || !value.length) bad("Empty RustGIS polygon");
        for (const polygon of value) {
          if (!Array.isArray(polygon) || !polygon.length) bad("Empty RustGIS polygon ring");
          shapes.push({kind:"polygon",paths:polygon.map((v)=>path(v,3)),label,layerName:name,style});
        }
      } else bad("Unsupported RustGIS geometry: " + String(tag).slice(0,40));
      if (vertices > MAX_VERTICES) bad("Map exceeds 120,000 vertices");
    }
    // RustGIS map.layers index 0 is the TOP layer; Canvas paints back-to-front.
    for (const layer of map.layers.slice().reverse()) {
      if (!layer || !layer.dataset) bad("Malformed RustGIS layer");
      const group = groups.get(layer.id);
      if (layer.visible === false || (group && group.visible === false)) {omittedHidden++;continue;}
      if (layer.raster) {omittedRaster++;continue;}
      if (layer.source) {omittedStream++;continue;}
      const ds = layer.dataset;
      if (ds.crs_incomplete) bad("RustGIS reports incomplete CRS; repair the source before import");
      if (!Array.isArray(ds.fields) || !Array.isArray(ds.features)) bad("Missing RustGIS feature table");
      const name = short(layer.name, short(ds.name, "Layer"));
      const style = layerStyle(layer,group);
      if (!layer.renderer || !layer.renderer.Single) simplified++;
      const count = features;
      for (const f of ds.features) {
        if (f && f.geometry == null) {omittedNull++;continue;}
        features++;
        if (features > MAX_FEATURES) bad("Map exceeds 8,000 features; package a smaller field area");
        geometry(f && f.geometry, labelFor(f,ds), name, style);
      }
      if (features > count) layers.push({
        name, source: short(ds.source, "Not specified"), originalCrs: ds.crs || null,
        features: features-count
      });
    }
    if (!shapes.length) bad("No embedded vector map data: linked raster, streamed and tile layers are not yet rendered; export embedded vector layers");
    if (omittedRaster) warnings.push(omittedRaster+" raster layer(s) not rendered");
    if (omittedStream) warnings.push(omittedStream+" streamed layer(s) not embedded");
    if (omittedTiles) warnings.push(omittedTiles+" linked tile layer(s) not fetched");
    if (omittedHidden) warnings.push(omittedHidden+" hidden layer(s) excluded");
    if (omittedNull) warnings.push(omittedNull+" null geometry skipped");
    if (simplified) warnings.push("Complex RustGIS symbology simplified");
    if (map.basemap && map.basemap !== "Blank") warnings.push("RustGIS built-in backdrop not carried with project");
    const c = map.camera;
    let camera = null;
    if (c && c.center && valid(c.center.x) && valid(c.center.y) && valid(c.res) && c.res > 0) {
      const lat = Math.atan(Math.sinh(c.center.y/R))*180/Math.PI;
      const lon = ((c.center.x/R*180/Math.PI+180)%360+360)%360-180;
      const zoom = Math.log2(2*Math.PI*R/(256*c.res));
      if (valid(lat) && Math.abs(lat) <= 85.05112878 && valid(zoom)) {
        camera = {lat,lon,zoom:Math.max(1,Math.min(19,zoom))};
      }
    }
    return {shapes,layers,features,vertices,warnings,camera,
      format,mapName:short(map.name,short(filename,"RustGIS map"))};
  }

  const get16 = (dv,i) => {
    if (i < 0 || i+2 > dv.byteLength) bad("Broken RustGIS ZIP header");
    return dv.getUint16(i,true);
  };
  const get32 = (dv,i) => {
    if (i < 0 || i+4 > dv.byteLength) bad("Broken RustGIS ZIP header");
    return dv.getUint32(i,true);
  };
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const n of bytes) {
      c ^= n;
      for (let j=0;j<8;j++) c=(c>>>1)^((c&1)?0xEDB88320:0);
    }
    return (c^0xFFFFFFFF)>>>0;
  }
  async function readPackage(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX_ZIP) bad("RustGIS ZIP package exceeds 32 MiB");
    const dv = new DataView(buffer);
    let tail = -1;
    for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--) {
      if (get32(dv,i)===0x06054B50) {tail=i;break;}
    }
    if (tail<0 || get16(dv,tail+4)!==0 || get16(dv,tail+6)!==0) bad("Not a single-volume RustGIS ZIP");
    const n = get16(dv,tail+10);
    if (!n || n>256 || n!==get16(dv,tail+8)) bad("Unexpected ZIP entry count");
    let offset = get32(dv,tail+16);
    if (offset+get32(dv,tail+12)>tail) bad("Invalid RustGIS ZIP directory");
    const decoder = new TextDecoder("utf-8",{fatal:true});
    let selected = null;
    for(let j=0;j<n;j++) {
      if (get32(dv,offset)!==0x02014B50) bad("Corrupt RustGIS ZIP directory");
      const flags=get16(dv,offset+8),method=get16(dv,offset+10),crc=get32(dv,offset+16);
      const packed=get32(dv,offset+20),unpacked=get32(dv,offset+24);
      const nl=get16(dv,offset+28),el=get16(dv,offset+30),cl=get16(dv,offset+32);
      const local=get32(dv,offset+42);
      const next=offset+46+nl+el+cl;
      if(next>dv.byteLength)bad("Invalid ZIP name boundary");
      const name=decoder.decode(new Uint8Array(buffer,offset+46,nl));
      offset=next;
      if(!/\.(rgis|rgismap)$/i.test(name))continue;
      if(selected)bad("ZIP contains multiple RustGIS maps; extract and choose one");
      if(name.startsWith("/")||name.includes("\\")||name.split("/").includes(".."))bad("Unsafe ZIP path");
      if(flags&1 || (method!==0&&method!==8))bad("Unsupported ZIP encryption/compression");
      if(unpacked>MAX_JSON)bad("RustGIS map JSON exceeds 12 MiB; export a smaller area");
      if(get32(dv,local)!==0x04034B50)bad("Corrupt ZIP local header");
      const start=local+30+get16(dv,local+26)+get16(dv,local+28);
      if(start+packed>dv.byteLength)bad("Truncated RustGIS ZIP entry");
      selected={name,method,crc,unpacked,packed:new Uint8Array(buffer,start,packed)};
    }
    if(!selected)bad("No RustGIS .rgis/.rgismap entry in package");
    let raw;
    if(selected.method===0) raw=selected.packed;
    else {
      if(typeof DecompressionStream==="undefined")bad("ZIP Deflate unsupported; unzip and select .rgismap");
      let stream;
      try {
        stream=new Blob([selected.packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      } catch (_) { bad("Cannot unzip on this browser; extract .rgismap manually"); }
      const reader=stream.getReader(), chunks=[];
      let total=0;
      try {
        while(true){
          const result=await reader.read();
          if(result.done)break;
          total+=result.value.byteLength;
          if(total>MAX_JSON||total>selected.unpacked){
            await reader.cancel();bad("ZIP entry exceeds declared size");
          }
          chunks.push(result.value);
        }
      }finally{reader.releaseLock();}
      raw=new Uint8Array(total);
      let i=0;
      for(const part of chunks){raw.set(part,i);i+=part.byteLength;}
    }
    if(raw.byteLength!==selected.unpacked || crc32(raw)!==selected.crc)bad("RustGIS package failed size/CRC verification");
    return {text:decoder.decode(raw),name:selected.name};
  }

  const isRustGIS = (name) => /\.(rgis|rgismap|rgislyr|rgismpk|rgispkg)$/i.test(name);
  async function readFile(file) {
    if(!file||!isRustGIS(file.name))bad("Select a native RustGIS map/project file");
    const zip=/\.(rgismpk|rgispkg)$/i.test(file.name);
    if(file.size>(zip?MAX_ZIP:MAX_JSON))bad("RustGIS file too large; export a smaller map");
    const json=zip?await readPackage(await file.arrayBuffer()):{text:await file.text(),name:file.name};
    return parseRustGIS(json.text,json.name);
  }
  window.RustBoyMapImport=Object.freeze({isRustGIS,parseRustGIS,readFile,readPackage});
})();