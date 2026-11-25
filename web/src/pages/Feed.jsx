import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { api } from '@/api/client';
import PostCard from '@/components/social/PostCard';
import ShareComposer from '@/components/social/ShareComposer';
import { loadMyProfile } from '@/lib/social';
import { cn } from '@/lib/utils';

// Gym is hidden for now: older workout posts stay stored but are not shown.
const visiblePosts = (posts) => (posts || []).filter((post) => post.kind !== 'workout');

export default function Feed() {
  const [params] = useSearchParams();
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('feed');
  const [posts, setPosts] = useState(null);
  const [discover, setDiscover] = useState(null);
  const [composer, setComposer] = useState(false);
  const [initial, setInitial] = useState({});

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then(async (user) => {
        if (!alive) return;
        setMe(user);
        const p = await loadMyProfile(user);
        if (alive) setProfile(p);
        const res = await api.functions.invoke('socialFeed', {});
        if (alive) setPosts(visiblePosts(res.data?.posts));
      })
      .catch(() => {
        if (alive) setPosts([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const kind = params.get('compose');
    const id = params.get('id');
    if (kind === 'run') {
      setInitial({ id: id || '' });
      setComposer(true);
    }
  }, [params]);

  useEffect(() => {
    if (tab !== 'discover' || discover) return;
    api.entities.Post.filter({ visibility: 'public' }, { sort: '-created_date', limit: 30 })
      .then((page) => setDiscover(visiblePosts(page.items)))
      .catch(() => setDiscover([]));
  }, [tab, discover]);

  const list = tab === 'feed' ? posts : discover;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Training circle</p>
          <h1 className="mt-1 font-heading text-3xl font-extrabold leading-none">Feed</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/friends"
            className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2.5 font-heading text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Users className="h-3.5 w-3.5" /> Friends
          </Link>
          <button
            type="button"
            onClick={() => {
              setInitial({});
              setComposer(true);
            }}
            className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2.5 font-heading text-xs font-semibold text-primary-foreground transition hover:brightness-95"
          >
            <Plus className="h-3.5 w-3.5" /> New post
          </button>
        </div>
      </div>

      <div className="flex gap-1 rounded-full border border-border p-1">
        {[
          { id: 'feed', label: 'Your circle' },
          { id: 'discover', label: 'Discover' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-full py-2 font-heading text-xs font-medium transition-colors',
              tab === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {list === null && <div className="panel h-40 animate-pulse" />}

      {list?.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="font-heading text-base font-bold">
            {tab === 'feed' ? 'Nothing in your circle yet' : 'No public posts yet'}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
            {tab === 'feed'
              ? 'Post a run, then add friends so you can see each other’s sessions.'
              : 'When athletes share a run publicly, it shows up here.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setInitial({});
              setComposer(true);
            }}
            className="mt-4 rounded-full bg-primary px-4 py-2.5 font-heading text-xs font-semibold text-primary-foreground transition hover:brightness-95"
          >
            Create a post
          </button>
        </div>
      )}

      <div className="space-y-4">
        {(list || []).map((post) => (
          <PostCard
            key={post.id}
            post={post}
            mine={post.created_by_id === me?.id}
            onDeleted={(id) => {
              setPosts((p) => (p || []).filter((x) => x.id !== id));
              setDiscover((p) => (p || []).filter((x) => x.id !== id));
            }}
          />
        ))}
      </div>

      {list?.length > 0 && (
        <p className="pb-2 text-center text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Nothing posts unless you create it
        </p>
      )}

      <ShareComposer
        open={composer}
        onOpenChange={setComposer}
        profile={profile}
        initialId={initial.id}
        onPosted={() => {
          api.functions
            .invoke('socialFeed', {})
            .then((res) => setPosts(visiblePosts(res.data?.posts)))
            .catch(() => {});
          setDiscover(null);
        }}
      />
    </div>
  );
}