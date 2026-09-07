/** S-01b supplementary: what does Playwright see as targets while the offscreen
 *  document is alive, and does CDP see the offscreen target? Throwaway. */
const http=require("http"),fs=require("fs"),os=require("os"),path=require("path");
const {chromium}=require("playwright");
const PORT=8901, EXT=path.join(__dirname,"extension");
(async()=>{
  const received=[];
  const server=http.createServer((q,s)=>{received.push(q.method+" "+q.url);s.writeHead(200);s.end("{}")});
  await new Promise(r=>server.listen(PORT,"127.0.0.1",r));
  const udd=fs.mkdtempSync(path.join(os.tmpdir(),"pratibimb-s01b-tgt-"));
  const ctx=await chromium.launchPersistentContext(udd,{headless:false,channel:"msedge",
    args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
  const out={};
  try{
    let sw=ctx.serviceWorkers().find(w=>w.url().startsWith("chrome-extension://"));
    if(!sw) sw=await ctx.waitForEvent("serviceworker",{timeout:20000});
    out.probe=await sw.evaluate(()=>globalThis.__s01b_run());
    await new Promise(r=>setTimeout(r,1000));
    out.playwrightPages=ctx.pages().map(p=>p.url());
    out.playwrightServiceWorkers=ctx.serviceWorkers().map(w=>w.url());
    // Ask CDP what targets exist.
    const page=ctx.pages()[0]||await ctx.newPage();
    const cdp=await ctx.newCDPSession(page);
    const t=await cdp.send("Target.getTargets");
    out.cdpTargets=t.targetInfos.map(x=>({type:x.type,url:x.url}));
    out.cdpOffscreenPresent=t.targetInfos.some(x=>x.url.includes("offscreen.html"));
  }catch(e){out.error=String(e).slice(0,300);}
  finally{
    out.collectorReceived=received;
    try{await ctx.close()}catch{}; try{fs.rmSync(udd,{recursive:true,force:true})}catch{}
    server.close();
  }
  fs.writeFileSync("results-targets.json",JSON.stringify(out,null,2));
  console.log(JSON.stringify(out,null,1));
})();
