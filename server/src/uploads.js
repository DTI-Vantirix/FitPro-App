import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requireUser } from './auth/users.js';
import { HttpError, readBody, reply } from './lib/http.js';

// Public media uploads (post backgrounds, avatars). Replaces Base44's
// UploadPublicFile. Files go to UPLOAD_DIR on local disk; before production,
// point this at object storage (S3, R2, GCS) — the API shape stays the same.
//
//   POST /api/uploads   raw file bytes, Content-Type set to the file's type
//                       -> { file_url }
//   GET  /uploads/:name

const TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};
const CONTENT_TYPE_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([type, ext]) => [ext, type]));
const NAME_RE = /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export function registerUploadRoutes(router) {
  router.add('POST', '/api/uploads', async (ctx) => {
    requireUser(ctx);
    const type = String(ctx.req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type];
    if (!ext) throw new HttpError(415, 'Upload a photo (JPEG, PNG, WebP, GIF, HEIC) or a video (MP4, MOV, WebM).');
    const data = await readBody(ctx.req, ctx.config.maxUploadBytes);
    if (!data.length) throw new HttpError(400, 'The file is empty.');
    await fs.promises.mkdir(ctx.config.uploadDir, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    await fs.promises.writeFile(path.join(ctx.config.uploadDir, name), data);
    return reply(201, { file_url: `${ctx.config.publicUrl}/uploads/${name}` });
  });

  router.add('GET', '/uploads/:name', async (ctx) => {
    const name = ctx.params.name;
    if (!NAME_RE.test(name)) throw new HttpError(404, 'Not found');
    return serveFile(ctx.res, path.join(ctx.config.uploadDir, name), {
      'Content-Type': CONTENT_TYPE_BY_EXT[path.extname(name)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
  });
}

export async function serveFile(res, file, headers) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  if (!stat.isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, { 'Content-Length': stat.size, ...headers });
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('error', reject).on('end', resolve).pipe(res);
  });
  return HANDLED;
}

// Returned by handlers that already wrote the response.
export const HANDLED = Symbol('handled');
