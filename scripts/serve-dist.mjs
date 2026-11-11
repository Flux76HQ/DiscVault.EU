import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const host = valueAfter('--host', '127.0.0.1');
const port = Number(valueAfter('--port', process.env.PORT ?? '4321'));
const root = path.resolve('dist');
const mimeTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * One `bytes=` range of a file of `size` bytes: `{ start, end }`, `null`
 * when the header is absent or not a single byte range (the whole file is
 * then served), or `false` when it cannot be satisfied (416).
 */
function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    // A suffix range: the last N bytes.
    const length = Number(match[2]);
    if (!length || !size) return false;
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) return false;
  return { start, end };
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', `http://${request.headers.host}`).pathname,
    );
    const relative = pathname.endsWith('/')
      ? `${pathname}index.html`
      : pathname;
    const target = path.resolve(root, `.${relative}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error('Path escapes dist');
    }
    const info = await stat(target);
    if (!info.isFile()) throw new Error('Not a file');
    const headers = {
      'Content-Type':
        mimeTypes[path.extname(target).toLowerCase()] ??
        'application/octet-stream',
      // Media elements seek with Range requests; WebKit will not play a
      // video from a server that cannot answer one.
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    };
    const range = byteRange(request.headers.range, info.size);
    if (range === false) {
      response.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${info.size}`,
        'Content-Length': 0,
      });
      response.end();
      return;
    }
    if (range) {
      response.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
        'Content-Length': range.end - range.start + 1,
      });
    } else {
      response.writeHead(200, { ...headers, 'Content-Length': info.size });
    }
    if (request.method === 'HEAD') response.end();
    else createReadStream(target, range ?? {}).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
  }
});

server.listen(port, host, () => {
  console.log(`DiscVault dist preview: http://${host}:${port}/`);
});
