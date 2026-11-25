import { formatDuration, formatPace } from '@/lib/format';

export const CARD_W = 1080;
export const CARD_H = 1350;

const HEAD = "'Archivo', 'Inter', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

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
  ctx.strokeStyle = '#C9F84A';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(201,248,74,0.5)';
  ctx.shadowBlur = 34;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const [sx, sy] = toXY(pts[0]);
  const [ex, ey] = toXY(pts[pts.length - 1]);
  ctx.fillStyle = '#C9F84A';
  [ [sx, sy], [ex, ey] ].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
  });
  return true;
}

function column(ctx, x, label, value) {
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(240,240,232,0.45)';
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText(label, x, 1120);
  ctx.fillStyle = '#F5F5EE';
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

  if (drewBg) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(12,12,11,0.5)');
    g.addColorStop(0.42, 'rgba(12,12,11,0.68)');
    g.addColorStop(1, 'rgba(12,12,11,0.97)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#0C0C0B';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.5, H * 0.08, 0, W * 0.5, H * 0.08, H * 0.85);
    glow.addColorStop(0, 'rgba(201,248,74,0.18)');
    glow.addColorStop(1, 'rgba(12,12,11,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  // Header
  ctx.textAlign = 'left';
  ctx.fillStyle = '#C9F84A';
  ctx.font = `800 30px ${HEAD}`;
  ctx.fillText('FITPRO', 72, 108);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(240,240,232,0.6)';
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(card.date || '', W - 72, 106);

  drawRoute(ctx, points, { x: 120, y: 200, w: 840, h: 500 });

  // Headline stat
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(240,240,232,0.5)';
  ctx.font = `600 24px ${MONO}`;
  ctx.fillText('DISTANCE', 72, 830);

  const big = Number(card.distance_mi || 0).toFixed(2);
  const unit = 'MI';

  ctx.fillStyle = '#F5F5EE';
  ctx.font = `900 200px ${HEAD}`;
  ctx.fillText(big, 68, 1000);
  const width = ctx.measureText(big).width;
  ctx.fillStyle = '#C9F84A';
  ctx.font = `800 44px ${MONO}`;
  ctx.fillText(unit, 68 + width + 20, 998);

  // Three columns
  column(ctx, 72, 'PACE', `${formatPace(card.avg_pace_sec)}`);
  column(ctx, 402, 'TIME', formatDuration(card.duration_sec || 0));
  column(ctx, 732, 'ZONE', card.zone_name || '—');

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(72, 1232, W - 144, 2);
  ctx.fillStyle = 'rgba(240,240,232,0.65)';
  ctx.font = `600 24px ${MONO}`;
  ctx.fillText(card.handle ? `@${card.handle}` : '', 72, 1290);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(201,248,74,0.85)';
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

export function canvasToFile(canvas, name = 'fitpro-post.png') {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      resolve(new File([blob], name, { type: 'image/png' }));
    }, 'image/png');
  });
}

export async function saveCanvas(canvas, name = 'fitpro-post.png') {
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