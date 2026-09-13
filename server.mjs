// Minimal, dependency-free static file server for Git City.
// Serves ./public with correct MIME types and SPA-fallback to index.html
// for unknown GET paths so ?user= deep-links always resolve.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function mimeFor(path) {
  return MIME[extname(path).toLowerCase()] || 'application/octet-stream';
}

async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  // Default document + SPA fallback.
  if (pathname === '/') pathname = '/index.html';

  const filePath = normalize(join(PUBLIC_DIR, pathname));
  // Prevent path traversal outside the public dir.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const st = await stat(filePath).catch(() => null);
    const target = st && st.isDirectory() ? join(filePath, 'index.html') : filePath;
    const buf = await readFile(target);
    res.writeHead(200, {
      'Content-Type': mimeFor(target),
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch {
    // SPA fallback: unknown paths get index.html so the client can 404/redirect.
    try {
      const buf = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') serve(req, res);
  else if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
  } else {
    res.writeHead(405).end('Method Not Allowed');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Git City serving on 0.0.0.0:${PORT}`);
});
