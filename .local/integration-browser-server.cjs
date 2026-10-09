const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
async function port() { const s=http.createServer(); s.listen(0,'127.0.0.1'); await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p; }
async function main(){
 assert.match(process.env.PGOPTIONS || '', /^-c search_path=p0_test_[a-f0-9]{16}$/);
 const bp=await port(),fp=await port(); const children=[]; let proxy;
 const marker=path.join(__dirname,`integration-browser-stop-${crypto.randomUUID()}`);
 try {
 children.push(spawn(process.execPath,['backend/src/server.cjs'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'development',HOST:'127.0.0.1',PORT:String(bp),INTEGRATION_SETTINGS_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),LINE_MESSAGING_MODE:'disabled',PAYMENT_VERIFICATION_MODE:'mock'}}));
 children.push(spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(fp)],{cwd:path.join(root,'frontend'),windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'production'}}));
 for(const p of [bp,fp]) {let ok=false;for(let i=0;i<70;i++){try{if((await fetch(`http://127.0.0.1:${p}/${p===bp?'api/health':'health'}`)).ok){ok=true;break}}catch{} await new Promise(r=>setTimeout(r,200));}assert.ok(ok);}
 proxy=http.createServer((req,res)=>{const target=req.url.startsWith('/api/')?bp:fp;const upstream=http.request({hostname:'127.0.0.1',port:target,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream)});
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');console.log(JSON.stringify({url:`http://127.0.0.1:${proxy.address().port}/admin/login`,stopFile:marker}));
 const deadline=Date.now()+15*60*1000;while(Date.now()<deadline&&!fs.existsSync(marker))await new Promise(r=>setTimeout(r,500));
 }finally{if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));} for(const child of children){if(child.exitCode===null){const end=once(child,'exit');child.kill();await end}}if(fs.existsSync(marker))fs.unlinkSync(marker);}
}
main().catch(()=>{console.error('Isolated browser server failed');process.exitCode=1});
