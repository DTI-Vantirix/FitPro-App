import { useRef, useState } from 'react';
import moment from 'moment';
import { Download, Globe, Lock, Share2, Trash2, Users } from 'lucide-react';
import { api } from '@/api/client';
import ShareCardCanvas from './ShareCardCanvas';
import RouteTrace from './RouteTrace';
import { postLink, postText } from '@/lib/social';
import { saveCanvas, shareCanvas } from '@/lib/shareCard';
import { formatDuration, formatPace } from '@/lib/format';
import { cn } from '@/lib/utils';

const VISIBILITY = {
  public: { icon: Globe, label: 'Anyone on VantraRun' },
  friends: { icon: Users, label: 'Friends' },
  private: { icon: Lock, label: 'Only me' },
};

function cardFromPost(post) {
  return {
    kind: post.kind,
    date: moment(post.created_date).format('DD MMM YYYY').toUpperCase(),
    distance_mi: post.distance_mi || 0,
    avg_pace_sec: post.avg_pace_sec || 0,
    duration_sec: post.duration_sec || 0,
    duration_min: Math.round((post.duration_sec || 0) / 60),
    volume_lb: post.volume_lb || 0,
    set_count: post.set_count || 0,
    zone_name: post.zone_name || '',
    title: post.title || '',
    handle: post.author_handle || '',
  };
}

export default function PostCard({ post, mine, onDeleted }) {
  const [pending, setPending] = useState(null);
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef(null);
  const text = postText(post);
  const link = postLink(post);
  const Vis = VISIBILITY[post.visibility] || VISIBILITY.friends;

  const handleDrawn = async (canvas) => {
    if (!pending) return;
    const action = pending;
    setPending(null);
    if (action === 'share') await shareCanvas(canvas, text, link);
    else await saveCanvas(canvas, `vantrarun-${post.id}.png`);
    setExporting(false);
  };

  const remove = async () => {
    await api.entities.Post.delete(post.id);
    onDeleted?.(post.id);
  };

  return (
    <article className="panel overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold uppercase text-primary">
          {(post.author_name || post.author_handle || '?').slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm">
            {post.author_name || post.author_handle}
          </p>
          <p className="vr-label truncate text-[10px]">
            @{post.author_handle} · {moment(post.created_date).fromNow()}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          <Vis.icon className="h-3 w-3" />
          {Vis.label}
        </span>
      </header>

      <div className="px-4">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-secondary/40">
          <div className="flex items-stretch gap-4 p-4">
            <div className="min-w-0 flex-1">
              {post.kind === 'run' ? (
                <>
                  <p className="eyebrow text-[9px]">Distance</p>
                  <p className="num mt-1 text-3xl leading-none">
                    {Number(post.distance_mi || 0).toFixed(2)}
                    <span className="ml-1 text-xs text-muted-foreground">mi</span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatPace(post.avg_pace_sec)} /mi
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatDuration(post.duration_sec || 0)}
                    </span>
                    {post.zone_name && (
                      <span className="text-xs text-primary">{post.zone_name}</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="eyebrow text-[9px]">Volume</p>
                  <p className="num mt-1 text-3xl leading-none">
                    {Number(post.volume_lb || 0).toLocaleString()}
                    <span className="ml-1 text-xs text-muted-foreground">lb</span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {post.set_count || 0} sets
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {post.duration_min || Math.round((post.duration_sec || 0) / 60)} min
                    </span>
                  </div>
                </>
              )}
            </div>
            {(post.route_points || []).length > 1 && (
              <RouteTrace points={post.route_points} className="h-24 w-24 shrink-0" />
            )}
          </div>
          {post.title && (
            <p className="border-t border-border px-4 py-2 vr-label text-[10px]">
              {post.title}
            </p>
          )}
        </div>
      </div>

      {post.caption && (
        <p className="whitespace-pre-wrap px-4 pt-3 text-sm leading-relaxed">{post.caption}</p>
      )}

      <footer className="flex items-center gap-1 px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            setPending('share');
            setExporting(true);
          }}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Share2 className="h-3.5 w-3.5" /> Share
        </button>
        <button
          type="button"
          onClick={() => {
            setPending('save');
            setExporting(true);
          }}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" /> Save image
        </button>
        {mine && (
          <button
            type="button"
            onClick={remove}
            aria-label="Delete post"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {(post.shared_to || []).length > 0 && (
          <span className={cn('vr-label text-[9px]', mine ? '' : 'ml-auto')}>
            {post.shared_to.join(' · ')}
          </span>
        )}
      </footer>

      {exporting && (
        <div className="pointer-events-none fixed -left-[2000px] top-0 w-[540px]" aria-hidden="true">
          <ShareCardCanvas
            card={cardFromPost(post)}
            points={post.route_points || []}
            backgroundType={post.background_type || 'none'}
            backgroundUrl={post.background_url || ''}
            canvasRef={canvasRef}
            onDrawn={handleDrawn}
          />
        </div>
      )}
    </article>
  );
}