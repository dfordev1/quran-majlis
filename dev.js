// Local dev shim that emulates the Vercel runtime: serves index.html and routes
// /api/<name> to the function files, adding res.status().json() and req.body/req.query.
// Run:  "C:\Program Files\nodejs\node.exe" dev.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3122;

http.createServer(async (req, res) => {
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z_]/g, '');
    const file = path.join(__dirname, 'api', name + '.js');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'no such function' });
    req.query = Object.fromEntries(url.searchParams);
    let body = ''; req.on('data', c => body += c);
    await new Promise(r => req.on('end', r));
    try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
    try { await require(file)(req, res); }
    catch (e) { console.log('fn error', name, e.message); if (!res.writableEnded) res.status(500).json({ error: e.message }); }
    return;
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const fp = path.join(__dirname, path.normalize(file));
  if (!fp.startsWith(__dirname) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log('Majlis cloud (dev shim) at http://localhost:' + PORT));
