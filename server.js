import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import familyHandler from './api/family.js';
const root = new URL('./public/', import.meta.url);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/api/family'){
      if(req.method==='POST'){
        let body='';
        for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384){res.writeHead(413).end('Request too large');return;}}
        try{req.body=JSON.parse(body);}catch{res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'잘못된 요청입니다.'}));return;}
      }
      await familyHandler(req,res);return;
    }
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (filename.includes('..')) { res.writeHead(403).end(); return; }
    const data = await readFile(new URL(filename,root));
    res.writeHead(200, {'Content-Type':types[path.extname(filename)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'}).end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 3000),'0.0.0.0',() => console.log('Home activity server ready'));
