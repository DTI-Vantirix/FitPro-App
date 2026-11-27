import { formatDuration, formatPace } from '@/lib/format';
import logoUrl from '@/assets/brand/vantrarun-horizontal-full-colour.svg';

export const CARD_W = 1080;
export const CARD_H = 1350;

const HEAD = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const MONO = "Inter, system-ui, sans-serif";

const VOLT = '#C6FF00';
const INK = '#0B0B0C';
const CHALK = '#F5F5F2';
const STEEL = '#8A8A93';
const TEXT_2 = '#A6A6AE';
const LINE = '#2A2A2F';

// The card draws the real logo and the brand faces, so both must be loaded
// before the first draw.
const logo = typeof Image === 'undefined' ? null : new Image();
export const cardAssetsReady =
  typeof document === 'undefined'
    ? Promise.resolve()
    : Promise.all([
        new Promise((resolve) => {
          logo.onload = resolve;
          logo.onerror = resolve;
          logo.src = logoUrl;
        }),
        document.fonts?.load?.("italic 900 200px 'Barlow Condensed'").catch(() => {}),
        document.fonts?.load?.("800 52px 'Barlow Condensed'").catch(() => {}),
        document.fonts?.load?.('500 24px Inter').catch(() => {}),
      ]).then(() => {});

function coverRect(ctx, el, w, h) {
  const ew = el.videoWidth || el.naturalWidth || el.width;
  const eh = el.videoHeight || el.naturalHeight || el.height;
  if (!ew || !eh) return false;
  const scale = Math.max(w / ew, h / eh);
  const dw = ew * scale;
  const dh = eh * scale;
  ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}

function drawRoute(ctx, points, box) {
  const pts = (points || []).filter(
    (p) => typeof p?.lat === 'number' && typeof p?.lng === 'number'
  );
  if (pts.length < 2) return false;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  pts.forEach((p) => {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  });

  const spanLat = Math.max(maxLat - minLat, 1e-5);
  const spanLng = Math.max(maxLng - minLng, 1e-5);
  const scale = Math.min(box.w / spanLng, box.h / spanLat);
  const offX = box.x + (box.w - spanLng * scale) / 2;
  const offY = box.y + (box.h - spanLat * scale) / 2;

  const toXY = (p) => [offX + (p.lng - minLng) * scale, offY + (maxLat - p.lat) * scale];

  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = toXY(p);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.strokeStyle = VOLT;
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const [sx, sy] = toXY(pts[0]);
  const [ex, ey] = toXY(pts[pts.length - 1]);
  // Finish: a solid Volt dot. Start: Ink with a Volt outline, drawn on top.
  ctx.fillStyle = VOLT;
  ctx.beginPath();
  ctx.arc(ex, ey, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.strokeStyle = VOLT;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(sx, sy, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return true;
}

function column(ctx, x, label, value) {
  ctx.textAlign = 'left';
  ctx.fillStyle = STEEL;
  ctx.font = `500 22px ${MONO}`;
  ctx.fillText(label, x, 1120);
  ctx.fillStyle = CHALK;
  ctx.font = `800 52px ${HEAD}`;
  ctx.fillText(value, x, 1180);
}

export function drawCard(ctx, { card, points, media }) {
  const W = CARD_W;
  const H = CARD_H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  let drewBg = false;
  if (media?.el) {
    try {
      drewBg = coverRect(ctx, media.el, W, H);
    } catch {
      drewBg = false;
    }
  }

  // A flat Ink veil keeps the numbers readable over a photo.
  ctx.fillStyle = drewBg ? 'rgba(11,11,12,0.72)' : INK;
  ctx.fillRect(0, 0, W, H);

  // Header: the logo itself, never the name typed out.
  if (logo?.naturalWidth) {
    const h = 52;
    ctx.drawImage(logo, 72, 62, (logo.naturalWidth / logo.naturalHeight) * h, h);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT_2;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(card.date || '', W - 72, 106);

  drawRoute(ctx, points, { x: 120, y: 200, w: 840, h: 500 });

  // Headline stat
  ctx.textAlign = 'left';
  ctx.fillStyle = STEEL;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText('DISTANCE', 72, 830);

  const big = Number(card.distance_mi || 0).toFixed(2);
  const unit = 'MI';

  ctx.fillStyle = CHALK;
  ctx.font = `italic 900 210px ${HEAD}`;
  ctx.fillText(big, 68, 1000);
  const width = ctx.measureText(big).width;
  ctx.fillStyle = VOLT;
  ctx.font = `800 56px ${HEAD}`;
  ctx.fillText(unit, 68 + width + 28, 998);

  // Three columns
  column(ctx, 72, 'PACE', `${formatPace(card.avg_pace_sec)}`);
  column(ctx, 402, 'TIME', formatDuration(card.duration_sec || 0));
  column(ctx, 732, 'ZONE', card.zone_name || '—');

  // Footer
  ctx.fillStyle = LINE;
  ctx.fillRect(72, 1232, W - 144, 2);
  ctx.fillStyle = TEXT_2;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(card.handle ? `@${card.handle}` : '', 72, 1290);
  ctx.textAlign = 'right';
  ctx.fillStyle = VOLT;
  ctx.fillText(card.title ? card.title.slice(0, 34).toUpperCase() : '', W - 72, 1290);
  ctx.textAlign = 'left';
}

export function loadBackground(type, url) {
  return new Promise((resolve) => {
    if (!url || type === 'none') return resolve(null);
    const el = type === 'video' ? document.createElement('video') : new Image();
    el.crossOrigin = 'anonymous';
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok ? { el, type } : null);
    };
    const timer = setTimeout(() => finish(false), 8000);
    const onReady = () => {
      clearTimeout(timer);
      if (type === 'video') el.play?.().catch(() => {});
      finish(true);
    };
    el.addEventListener(type === 'video' ? 'loadeddata' : 'load', onReady);
    el.addEventListener('error', () => finish(false));
    el.src = url;
  });
}

export function canvasToFile(canvas, name = 'vantrarun-post.png') {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      resolve(new File([blob], name, { type: 'image/png' }));
    }, 'image/png');
  });
}

export async function saveCanvas(canvas, name = 'vantrarun-post.png') {
  const file = await canvasToFile(canvas, name);
  if (!file) return false;
  const href = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
  return true;
}

export async function shareCanvas(canvas, text, link) {
  const file = await canvasToFile(canvas);
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, url: link });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await saveCanvas(canvas);
  return 'saved';
}