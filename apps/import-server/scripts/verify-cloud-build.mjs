import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { mkdtemp, copyFile, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const postgres=new PGlite();
const mock=createServer(async(req,res)=>{
 try {
  let body='';for await(const chunk of req)body+=chunk;
  const packet=JSON.parse(body),data=await postgres.query(packet.query,packet.params);
  const rows=data.rows.map(row=>data.fields.map(field=>{
   const value=row[field.name];return value===null?null:typeof value==='object'?JSON.stringify(value):String(value);
  }));
  res.setHeader('content-type','application/json');res.end(JSON.stringify({fields:data.fields,rows,rowCount:data.affectedRows??rows.length}));
 }catch(error){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({message:error.message}));}
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
const directory=await mkdtemp(join(tmpdir(),'popmart-no-dependencies-'));
try {
 await copyFile(root+'/dist/server.mjs',join(directory,'server.mjs'));
 const fixture=await readFile(root+'/src/providers/__fixtures__/popmart-product-9120.html','utf8');
 await writeFile(join(directory,'check.mjs'),`
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Server} from 'node:http';
const native=globalThis.fetch;
globalThis.fetch=(url,options)=>String(url).includes('neon.tech')
 ? native(process.env.SQL_MOCK,options)
 : String(url).startsWith('https://www.popmart.com/')?Promise.resolve(new Response(${JSON.stringify(fixture)})):native(url,options);
const original=Server.prototype.listen;let captured;
Server.prototype.listen=function(){captured=this;Server.prototype.listen=original;return this;};
await import('./server.mjs');
for(let i=0;!captured&&i<150;i++)await new Promise(resolve=>setTimeout(resolve,10));
assert.ok(captured);Server.prototype.listen=original;
await new Promise(resolve=>original.call(captured,0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+captured.address().port;
async function api(path,payload,method='POST'){
 const response=await native(base+path,payload===undefined?undefined:{method,headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 assert.equal(response.status,200,await response.clone().text());return response.json();
}
try{
 assert.equal((await api('/api/health')).status,'ok');
 const first=await api('/api/shared/state'),datasetId=first.snapshot.tables.appMeta[0].activeDatasetId;
 const command=(name,payload)=>api('/api/shared/commands',{requestId:crypto.randomUUID(),name,payload:{datasetId,commandId:crypto.randomUUID(),...payload}});
 await command('setSpaceName',{name:'产物验证'});
 const resolved=await api('/api/import/resolve',{input:'https://www.popmart.com/ca/products/9120'});
 const preview=await api('/api/import/preview',{candidateId:resolved.candidates[0].candidateId});
 const imported=await command('commitSeriesImport',{preview,seriesReferenceUnitCents:6900,priceProvenance:'user_confirmed'});
 await command('createAcquisition',{source:'official',date:{precision:'day',day:'2026-11-17',month:'2026-11'},paidTotalCents:6900,lines:[{styleId:Object.values(imported.result.styleIds)[0],quantity:1,allocatedCents:6900,referenceUnitCentsSnapshot:6900}]});
 const bytes=Buffer.from('standalone-media'),hash=createHash('sha256').update(bytes).digest('hex');
 const uploaded=await native(base+'/api/shared/media/'+hash+'/0',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({parts:1,mime:'image/png',bytes:bytes.toString('base64')})});
 assert.equal(uploaded.status,204);
 await command('savePersonalAsset',{hash,mime:'image/png',role:'idle'});
 const after=await api('/api/shared/state');
 assert.equal(after.snapshot.tables.acquisitions.length,1);assert.equal(after.snapshot.tables.styles.length,13);
 assert.equal(after.snapshot.media.length,1);
 assert.deepEqual(Buffer.from(await(await native(base+'/api/shared/media/'+hash+'/0')).arrayBuffer()),bytes);
 console.log('PASS: no node_modules; PostgreSQL initialization, shared writes, import, purchase and media');
}finally{await new Promise(resolve=>captured.close(resolve));}
`);
 const child=spawn(process.execPath,['--no-experimental-require-module','--no-experimental-detect-module',join(directory,'check.mjs')],{
  env:{...process.env,NODE_ENV:'production',VERCEL:'1',DATABASE_URL:'postgresql://user:password@example.neon.tech/popmart',SQL_MOCK:`http://127.0.0.1:${mock.address().port}`},stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(60000),
 });
 let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 if(code!==0)throw new Error(output.slice(-7000));
 console.log(output.split('\n').filter(line=>line.startsWith('PASS:')).join('\n'));
}finally{await new Promise(resolve=>mock.close(resolve));await postgres.close();await rm(directory,{recursive:true,force:true});}
