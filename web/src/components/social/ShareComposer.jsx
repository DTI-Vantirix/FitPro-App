import { useEffect, useMemo, useRef, useState } from 'react';
import moment from 'moment';
import { Check, Download, Globe, ImagePlus, Lock, Share2, Upload, Users, Video } from 'lucide-react';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ShareCardCanvas from './ShareCardCanvas';
import { BACKGROUNDS, externalShareUrl, postLink, postText } from '@/lib/social';
import { saveCanvas, shareCanvas } from '@/lib/shareCard';
import { cn } from '@/lib/utils';

const VISIBILITIES = [
  { id: 'public', label: 'Public', icon: Globe },
  { id: 'friends', label: 'Friends', icon: Users },
  { id: 'private', label: 'Only me', icon: Lock },
];

function thinPoints(points, max = 160) {
  const pts = points || [];
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max);
  return pts.filter((_, i) => i % step === 0);
}

export default function ShareComposer({ open, onOpenChange, profile, initialKind, initialId, onPosted }) {
  const [runs, setRuns] = useState([]);
  const [workouts, setWorkouts] = useState([]);
  const [kind, setKind] = useState(initialKind || 'run');
  const [sourceId, setSourceId] = useState(initialId || '');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState(
    profile?.visibility === 'public' ? 'public' : 'friends'
  );
  const [bg, setBg] = useState({ type: 'none', url: '' });
  const [posting, setPosting] = useState(false);
  const [created, setCreated] = useState(null);
  const [hint, setHint] = useState('');
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setCreated(null);
    setHint('');
    setKind(initialKind || 'run');
    setSourceId(initialId || '');
    Promise.all([
      api.entities.Run.list({ sort: '-created_date', limit: 8 }),
      api.entities.Workout.list({ sort: '-created_date', limit: 8 }),
    ])
      .then(([runPage, workoutPage]) => {
        setRuns(runPage.items || []);
        setWorkouts(workoutPage.items || []);
      })
      .catch(() => {});
  }, [open, initialKind, initialId]);

  const sources = kind === 'run' ? runs : workouts;
  const selected = sources.find((s) => s.id === sourceId) || null;
  const cardPoints = useMemo(
    () => (kind === 'run' ? thinPoints(selected?.points) : []),
    [kind, selected]
  );

  const card = useMemo(() => {
    if (!selected) return null;
    const isRun = kind === 'run';
    return {
      kind,
      date: moment(selected.started_at || selected.performed_at || selected.created_date)
        .format('DD MMM YYYY')
        .toUpperCase(),
      distance_mi: selected.distance_mi || 0,
      avg_pace_sec: selected.avg_pace_sec || 0,
      duration_sec: selected.duration_sec || (selected.duration_min || 0) * 60,
      duration_min: selected.duration_min || Math.round((selected.duration_sec || 0) / 60),
      volume_lb: selected.total_volume || 0,
      set_count: selected.set_count || 0,
      zone_name: isRun ? selected.target_zone_name || '' : '',
      title: isRun ? selected.route_name || 'Free run' : selected.name || 'Gym session',
      handle: profile?.handle || '',
    };
  }, [selected, kind, profile]);

  const uploadBackground = async (file, type) => {
    if (!file) return;
    setHint('');
    const { file_url } = await api.integrations.Core.UploadPublicFile({ file });
    setBg({ type, url: file_url });
  };

  const save = async () => {
    if (!selected) return;
    setPosting(true);
    const isRun = kind === 'run';
    const payload = {
      kind,
      ref_id: selected.id,
      title: isRun ? selected.route_name || 'Free run' : selected.name || 'Gym session',
      caption: caption.trim(),
      distance_mi: selected.distance_mi || 0,
      duration_sec: selected.duration_sec || (selected.duration_min || 0) * 60,
      avg_pace_sec: selected.avg_pace_sec || 0,
      zone_name: isRun ? selected.target_zone_name || '' : '',
      in_zone_pct: selected.in_zone_pct || 0,
      volume_lb: selected.total_volume || 0,
      set_count: selected.set_count || 0,
      route_points: isRun ? thinPoints(selected.points) : [],
      background_type: bg.type,
      background_url: bg.url,
      visibility,
      author_handle: profile?.handle || '',
      author_name: profile?.display_name || profile?.handle || '',
      author_avatar: profile?.avatar_url || '',
      shared_to: [],
    };
    const post = await api.entities.Post.create(payload);
    setCreated(post);
    setPosting(false);
    onPosted?.(post);
  };

  const markShared = async (label) => {
    if (!created) return;
    const next = Array.from(new Set([...(created.shared_to || []), label]));
    await api.entities.Post.update(created.id, { shared_to: next });
    setCreated({ ...created, shared_to: next });
  };

  const shareSystem = async () => {
    if (!canvasRef.current || !created) return;
    const result = await shareCanvas(canvasRef.current, postText(created), postLink(created));
    if (result === 'saved') setHint('Image saved. Attach it in the app you want to post to.');
    else if (result === 'shared') markShared('shared');
  };

  const shareExternal = (id) => {
    const url = externalShareUrl(id, { text: postText(created), url: postLink(created) });
    if (!url) {
      setHint('Instagram has no web link — use Share and pick Instagram, or save the image and post it.');
      return;
    }
    window.open(url, '_blank', 'noopener');
    markShared(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">New post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            {[
              { id: 'run', label: 'Run' },
              { id: 'workout', label: 'Workout' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setKind(t.id);
                  setSourceId('');
                }}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 font-heading text-xs font-medium transition-colors',
                  kind === t.id
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {sources.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                Nothing logged yet — record a {kind} first.
              </p>
            )}
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSourceId(s.id)}
                className={cn(
                  'shrink-0 rounded-xl border px-3 py-2 text-left transition-colors',
                  sourceId === s.id
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="block max-w-[150px] truncate font-heading text-xs font-semibold">
                  {s.route_name || s.name || 'Session'}
                </span>
                <span className="num mt-0.5 block text-[10px] uppercase tracking-[0.1em]">
                  {s.distance_mi
                    ? `${Number(s.distance_mi).toFixed(2)} mi`
                    : `${s.set_count || 0} sets`}
                </span>
              </button>
            ))}
          </div>

          {card && (
            <div className="mx-auto w-full max-w-[280px]">
              <ShareCardCanvas
                card={card}
                points={cardPoints}
                backgroundType={bg.type}
                backgroundUrl={bg.url}
                canvasRef={canvasRef}
              />
            </div>
          )}

          <div>
            <p className="eyebrow mb-2">Background</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setBg({ type: 'none', url: '' })}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[11px] transition-colors',
                  bg.type === 'none' ? 'border-primary/60 text-primary' : 'border-border text-muted-foreground'
                )}
              >
                Clean
              </button>
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBg({ type: 'photo', url: b.url })}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[11px] transition-colors',
                    bg.url === b.url ? 'border-primary/60 text-primary' : 'border-border text-muted-foreground'
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                <ImagePlus className="h-3.5 w-3.5" /> Your photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => uploadBackground(e.target.files?.[0], 'photo')}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                <Video className="h-3.5 w-3.5" /> Your video
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => uploadBackground(e.target.files?.[0], 'video')}
                />
              </label>
              {bg.type !== 'none' && (
                <span className="flex items-center gap-1 px-1 text-[10px] uppercase tracking-[0.1em] text-primary">
                  <Check className="h-3 w-3" /> {bg.type}
                </span>
              )}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Uploads are stored publicly — anyone with the link can open them. A video plays behind the stats in
              the preview; the exported post is a still of that frame.
            </p>
          </div>

          <label className="block">
            <span className="eyebrow">Caption</span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              placeholder="Legs felt heavy, kept it easy."
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>

          <div>
            <p className="eyebrow mb-2">Who sees it</p>
            <div className="flex flex-wrap gap-2">
              {VISIBILITIES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVisibility(v.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors',
                    visibility === v.id
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  <v.icon className="h-3 w-3" /> {v.label}
                </button>
              ))}
            </div>
          </div>

          {hint && <p className="text-[11px] leading-relaxed text-primary">{hint}</p>}

          {!created ? (
            <button
              type="button"
              onClick={save}
              disabled={!selected || posting}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
            >
              <Upload className="h-4 w-4" /> {posting ? 'Posting…' : 'Post to FitPro'}
            </button>
          ) : (
            <div className="space-y-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
              <p className="flex items-center gap-1.5 font-heading text-xs font-bold text-primary">
                <Check className="h-3.5 w-3.5" /> Posted — now send it out
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={shareSystem}
                  className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-heading text-[11px] font-semibold text-primary-foreground transition hover:brightness-95"
                >
                  <Share2 className="h-3 w-3" /> Share sheet
                </button>
                <button
                  type="button"
                  onClick={() => shareExternal('facebook')}
                  className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Facebook
                </button>
                <button
                  type="button"
                  onClick={() => shareExternal('instagram')}
                  className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Instagram
                </button>
                <button
                  type="button"
                  onClick={() => shareExternal('x')}
                  className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  X
                </button>
                <button
                  type="button"
                  onClick={() => canvasRef.current && saveCanvas(canvasRef.current)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Download className="h-3 w-3" /> Save image
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}