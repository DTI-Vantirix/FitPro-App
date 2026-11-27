/** Photo and video backgrounds of a post — pure. The limits are the server's
 * (server/src/uploads.js: eight types, 50 MB), the stock backgrounds and the two fields a
 * post carries are the website's (web/src/lib/social.js, ShareComposer.jsx).
 *
 * A background's address is only ever one on the VantraRun server: `/uploads/<name>` for a
 * file a runner sent, `/backgrounds/<name>.jpg` for a stock one. Anything else a post may
 * name is shown as no background and never fetched, so reading a feed cannot make the
 * phone call another host.
 */
export type MediaKind = 'photo' | 'video';
/** `background_type` and `background_url` of a Post record. */
export type Background = { type: 'none' | MediaKind; url: string };
/** A file the runner chose, checked and ready to upload when they tap Post. */
export type PickedMedia = { uri: string; mimeType: string; kind: MediaKind; sizeBytes: number | null };
/** What a card draws behind the stats. */
export type BackgroundView = { kind: 'none' } | { kind: MediaKind; uri: string };

/** The types the upload route accepts, and what each is to a post. */
export const UPLOAD_TYPES: Record<string, MediaKind> = {
  'image/jpeg': 'photo',
  'image/png': 'photo',
  'image/webp': 'photo',
  'image/gif': 'photo',
  'image/heic': 'photo',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
};
/** The server's default MAX_UPLOAD_MB. The server is still the judge: it answers 413. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

export const NO_BACKGROUND: Background = { type: 'none', url: '' };

/** The website's three terrain backgrounds, served by the site itself. */
export const STOCK_BACKGROUNDS: { id: string; label: string; url: string }[] = [
  { id: 'trees', label: 'Tree-lined road', url: '/backgrounds/trees.jpg' },
  { id: 'river', label: 'Riverside dusk', url: '/backgrounds/river.jpg' },
  { id: 'trail', label: 'Mountain trail', url: '/backgrounds/trail.jpg' },
];

export function stockBackground(id: string): Background {
  const found = STOCK_BACKGROUNDS.find((choice) => choice.id === id);
  return found ? { type: 'photo', url: found.url } : NO_BACKGROUND;
}

/** The background of a post whose file the server has just stored at `fileUrl`. */
export function uploadedBackground(kind: MediaKind, fileUrl: string): Background {
  return { type: kind, url: fileUrl };
}

export const BAD_TYPE = 'That file cannot be used. Pick a photo (JPEG, PNG, WebP, GIF, HEIC) or a video (MP4, MOV, WebM).';

const extensionOf = (name: unknown): string => {
  const match = typeof name === 'string' ? /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(name) : null;
  return match ? match[1].toLowerCase() : '';
};

/** The type to send: the one the picker named (tidied), else the one the file's name implies. */
function typeOf(asset: { uri?: unknown; mimeType?: unknown; fileName?: unknown }): string {
  const named = typeof asset.mimeType === 'string' ? asset.mimeType.split(';')[0].trim().toLowerCase() : '';
  if (named) return named === 'image/jpg' ? 'image/jpeg' : named;
  return TYPE_BY_EXTENSION[extensionOf(asset.fileName)] ?? TYPE_BY_EXTENSION[extensionOf(asset.uri)] ?? '';
}

/** Checks a file the runner picked against the server's rules before anything is sent. */
export function checkMedia(asset: { uri?: unknown; mimeType?: unknown; fileName?: unknown; fileSize?: unknown } | null | undefined):
  { ok: true; media: PickedMedia } | { ok: false; error: string } {
  const uri = asset && typeof asset.uri === 'string' ? asset.uri : '';
  const mimeType = asset ? typeOf(asset) : '';
  const kind = UPLOAD_TYPES[mimeType];
  if (!uri || !kind) return { ok: false, error: BAD_TYPE };
  const size = asset?.fileSize;
  const sizeBytes = typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null;
  if (sizeBytes === 0) return { ok: false, error: 'That file is empty. Pick another one.' };
  if (sizeBytes !== null && sizeBytes > MAX_UPLOAD_BYTES) {
    const limit = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    return { ok: false, error: `That ${kind} is ${Math.max(limit + 1, Math.round(sizeBytes / (1024 * 1024)))} MB. A post can carry ${limit} MB at most — pick a ${kind === 'video' ? 'shorter video' : 'smaller photo'}.` };
  }
  return { ok: true, media: { uri, mimeType, kind, sizeBytes } };
}

const MEDIA_PATH = /^\/(?:uploads\/[0-9a-f-]{36}\.[a-z0-9]{2,5}|backgrounds\/[a-z0-9_-]+\.jpg)$/;

/** The full address of a post's media on the VantraRun server at `apiUrl`, or null when the
 * address is not one of this server's uploads or stock backgrounds. */
export function mediaUrl(apiUrl: string, url: unknown): string | null {
  const origin = (apiUrl || '').replace(/\/+$/, '');
  if (!origin || typeof url !== 'string' || !url) return null;
  const path = url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
  return MEDIA_PATH.test(path) ? `${origin}${path}` : null;
}

/** What to draw behind a post's stats. */
export function backgroundOf(post: { backgroundType?: unknown; backgroundUrl?: unknown } | null | undefined, apiUrl: string): BackgroundView {
  const kind = post?.backgroundType;
  if (kind !== 'photo' && kind !== 'video') return { kind: 'none' };
  const uri = mediaUrl(apiUrl, post?.backgroundUrl);
  return uri ? { kind, uri } : { kind: 'none' };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "27 NOV 2026", the date in the corner of the website's share card, in the phone's own time. */
export function cardDate(iso: string | null | undefined): string {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  return `${String(at.getDate()).padStart(2, '0')} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

export function uploadPercent(sent: number, total: number): number {
  if (!Number.isFinite(sent) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((sent / total) * 100)));
}
