#!/usr/bin/env node
/* ============================================================
   Markdown Studio — tiny static development server (no deps).

   Some platforms (notably Windows) make Python's http.server send
   .js files as text/plain, which browsers reject for service
   workers. This server sets the correct MIME types and is the
   recommended way to preview the app locally.

   Usage:
     node scripts/serve.mjs [port] [directory]
     npm-free, Node 18+.
   ============================================================ */

import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(process.argv[3] || resolve(__dirname, '..'));
const port = Number(process.argv[2]) || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    send(res, 400, 'Bad Request');
    return;
  }

  let filePath = resolve(root, '.' + pathname);
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    send(res, 403, 'Forbidden');
    return;
  }

  try {
    let stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' });
        res.end();
        return;
      }
      filePath = resolve(filePath, 'index.html');
      stat = await fs.stat(filePath);
    }

    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err && err.code === 'ENOENT') send(res, 404, 'Not Found');
    else {
      console.error(err);
      send(res, 500, 'Internal Server Error');
    }
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Markdown Studio running at http://127.0.0.1:' + port + '/');
  console.log('Serving ' + root);
});
