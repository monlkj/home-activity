import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = new URL('./public/', import.meta.url);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (filename.includes('..')) { res.writeHead(403).end(); return; }
    const data = await readFile(new URL(filename,root));
    res.writeHead(200, {'Content-Type':types[path.extname(filename)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'}).end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 3000),'0.0.0.0',() => console.log('Home activity server ready'));
