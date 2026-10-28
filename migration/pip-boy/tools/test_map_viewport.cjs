"use strict";
// Real headless Chromium MAP layer layout acceptance with production CSS/JS.
// No Census endpoints, GPS providers, localhost services, or user data used.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const http=require("node:http");
const os=require("node:os");
const path=require("node:path");
const {spawn,spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
const files=new Map([
  ["/assets/map.css",[path.join(root,"crates/pipboy/assets/map.css"),"text/css"]],
  ["/assets/map.js",[path.join(root,"crates/pipboy/assets/map.js"),"text/javascript"]]
]);
const browserCandidates=[
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  process.env.HOME &&
    path.join(process.env.HOME,"Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  process.env.HOME &&
    path.join(process.env.HOME,"Applications/Chromium.app/Contents/MacOS/Chromium"),
  "/usr/bin/google-chrome","/usr/bin/chromium","google-chrome","chromium"
].filter(Boolean);
function chromium(){
  for(const name of browserCandidates){
    if(path.isAbsolute(name)&&fs.existsSync(name))return name;
    const found=spawnSync("which",[name],{encoding:"utf8"});
    if(found.status===0&&found.stdout.trim())return found.stdout.trim().split("\n")[0];
  }
  throw Error("Chromium not found; set CHROME_BIN");
}
function fixtureHtml(){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="/assets/map.css" rel="stylesheet">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b1a12}
#map-host{width:100%;height:100%;min-height:0;display:flex;flex-direction:column}</style>
</head><body><div id="map-host"></div>
<script>window.__mapRequests=[];const nativeFetch=window.fetch;
window.fetch=function(url){window.__mapRequests.push(String(url));
return Promise.reject(Error("Network denied in MAP layout test"));};
window.addEventListener("error",e=>parent.postMessage({kind:"map-layout-report",
report:{error:"Iframe exception: "+e.message+" / "+e.filename+":"+e.lineno}},location.origin));
window.addEventListener("unhandledrejection",e=>parent.postMessage({
kind:"map-layout-report",report:{error:"Iframe rejected: "+String(e.reason)}},location.origin));
</script>
<script src="/assets/map.js"></script>
<script>
function measure(){
 const host=document.getElementById("map-host");
 const view=window.RustBoyMap.mount(host);
 const rect=node=>{const r=node.getBoundingClientRect();
   return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const snapshot=()=>({
   screen:{width:innerWidth,height:innerHeight},
   stage:rect(view.stage),toolbar:rect(view.root.children[0]),
   disclosure:rect(view.layerPanel),
   buttons:Object.values(view.layerButtons).map(button=>({
     label:button.textContent,pressed:button.getAttribute("aria-pressed"),
     rect:rect(button)
   })),
   scrollWidth:document.documentElement.scrollWidth,
   scrollHeight:document.documentElement.scrollHeight,
   clientHeight:document.documentElement.clientHeight
 });
 const initial=snapshot();
 view.layerPanel.open=true;
 view.layerButtons.roads.click();
 view.layerButtons.roads.click();
 setTimeout(()=>{
   const expanded=snapshot();
   const report={initial,expanded,requests:window.__mapRequests.length,
     gpsState:view.gpsState,countyEnabled:view.countyEnabled};
   parent.postMessage({kind:"map-layout-report",report},location.origin);
   window.RustBoyMap.unmount();
 });
}
window.addEventListener("load",()=>setTimeout(measure,40));
</script></body></html>`;
}
function hostHtml(width,height){
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}iframe{display:block;border:0}</style></head><body>
<iframe id="device" title="MAP field viewport" width="${width}" height="${height}"
style="width:${width}px;height:${height}px" src="/fixture"></iframe>
<pre id="viewport-report" hidden></pre>
<script>
const target=document.getElementById("viewport-report");
const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
let received=false;
window.addEventListener("message",e=>{
 if(e.origin!==location.origin || e.source!==document.getElementById("device").contentWindow ||
   e.data?.kind!=="map-layout-report")return;
 received=true;target.textContent=encode(e.data.report);
});
setTimeout(()=>{if(!received){
 const frame=document.getElementById("device");
 target.textContent=encode({error:"No map report",ready:frame.contentDocument?.readyState,
   body:frame.contentDocument?.body?.innerText?.slice(0,200),
   hasMap:Boolean(frame.contentWindow?.RustBoyMap)});
}},2800);
</script></body></html>`;
}
function dump(chrome,port,width,height){
  return new Promise((resolve,reject)=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"rustboy-map-chrome-"));
    const url=`http://127.0.0.1:${port}/host?w=${width}&h=${height}`;
    const args=["--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
      "--disable-background-networking","--no-first-run","--no-default-browser-check",
      "--window-size=1000,900","--force-device-scale-factor=1",
      "--virtual-time-budget=3600","--dump-dom","--user-data-dir="+dir,url];
    const p=spawn(chrome,args,{stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="",finished=false;
    const timeout=setTimeout(()=>{p.kill("SIGKILL");fail(Error("Chromium timed out"));},30000);
    function cleanup(){clearTimeout(timeout);fs.rmSync(dir,{recursive:true,force:true});}
    function fail(e){if(finished)return;finished=true;cleanup();reject(e);}
    p.stdout.on("data",b=>{stdout+=b.toString();if(stdout.length>5000000)p.kill("SIGKILL");});
    p.stderr.on("data",b=>{stderr+=b.toString();if(stderr.length>12000)stderr=stderr.slice(-12000);});
    p.on("error",fail);
    p.on("close",code=>{
      if(finished)return;finished=true;cleanup();
      if(code!==0)return reject(Error("Chrome exited "+code+": "+stderr.slice(-2200)));
      const match=stdout.match(/<pre id="viewport-report"[^>]*>([A-Za-z0-9+/=]+)<\/pre>/);
      if(!match)return reject(Error("Chromium map report missing: "+stdout.slice(-1400)));
      try{resolve(JSON.parse(Buffer.from(match[1],"base64").toString("utf8")));}
      catch(e){reject(e);}
    });
  });
}
function check(result,width,height){
  assert.ok(!result.error,JSON.stringify(result));
  assert.equal(result.requests,0,"MAP toggles or initial load contacted a provider");
  assert.equal(result.gpsState,"GPS OFF");
  assert.equal(result.countyEnabled,false);
  for(const [phase,snap] of Object.entries({initial:result.initial,expanded:result.expanded})){
    assert.equal(snap.screen.width,width);
    assert.equal(snap.screen.height,height);
    assert.ok(snap.stage.height>=70,`Canvas too small: ${phase} ${width}x${height}`);
    assert.ok(snap.stage.width>=width-12,`Canvas clipped horizontally: ${phase}`);
    assert.ok(snap.scrollWidth<=width+1,`Horizontal scroll required: ${phase}`);
    assert.equal(snap.buttons.length,4);
    assert.ok(snap.buttons.every(b=>b.pressed==="true"),"Toggle lost its aria state");
    assert.ok(snap.buttons.every(b=>b.rect.height>=36),"Layer touch target under 36px");
    if(phase==="expanded"){
      assert.ok(snap.buttons.every(b=>b.rect.y>=0 && b.rect.bottom<=height),
        "Expanded layer control is outside viewport");
    }
  }
  assert.ok(result.initial.stage.height>result.expanded.stage.height,
    "Expanding LAYERS should trade canvas space for visible touch controls");
  console.log(`MAP Chromium ${width}x${height}: `+
    `canvas=${Math.round(result.expanded.stage.height)}px, 4 visible layer buttons, no network PASS`);
}
async function main(){
  const chrome=chromium();
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,"http://127.0.0.1");
    if(req.method!=="GET"){res.writeHead(405);res.end();return;}
    if(url.pathname==="/host"){
      const width=Number(url.searchParams.get("w")),height=Number(url.searchParams.get("h"));
      if(![[480,320],[800,480],[320,568]].some(([w,h])=>width===w&&height===h)){
        res.writeHead(400);res.end("Unsupported viewport");return;
      }
      res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"});
      res.end(hostHtml(width,height));return;
    }
    if(url.pathname==="/fixture"){
      res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"});
      res.end(fixtureHtml());return;
    }
    if(files.has(url.pathname)){
      const [file,type]=files.get(url.pathname);
      res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});
      fs.createReadStream(file).pipe(res);return;
    }
    res.writeHead(403);res.end("Unapproved fixture request");
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  try{
    const port=server.address().port;
    for(const [w,h] of [[480,320],[800,480],[320,568]])
      check(await dump(chrome,port,w,h),w,h);
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
