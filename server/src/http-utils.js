import { promises as fs } from 'node:fs';
import path from 'node:path';

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

export async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export function createErrorHandler(res) {
  return error => {
    const status = statusForCode(error.code) ?? 500;
    sendJson(res, status, {
      error: { code: error.code || 'INTERNAL_ERROR', message: error.message || String(error), details: error.details }
    });
  };
}

function statusForCode(code) {
  const map = {
    INVALID_INPUT: 400,
    VALIDATION_ERROR: 422,
    NOT_FOUND: 404,
    EXPORT_BLOCKED: 422,
    UNMAPPED_VARIABLE: 422,
    UNRESOLVED_CONFLICT: 409,
    INVALID_MOVE: 409,
    TEMPLATE_CYCLE: 409,
    MISSING_ANCESTOR: 409
  };
  return map[code];
}

export async function serveStatic(req, res, distDir) {
  const url = new URL(req.url, 'http://localhost');
  let filePath = path.join(distDir, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(distDir)) {
    sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    return true;
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    const body = await fs.readFile(filePath);
    const type = mimeType(filePath);
    res.writeHead(200, { 'content-type': type, 'content-length': body.length });
    res.end(body);
    return true;
  } catch {
    try {
      const index = await fs.readFile(path.join(distDir, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(index);
      return true;
    } catch {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Client has not been built; run npm run build' } });
      return true;
    }
  }
}

function mimeType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
