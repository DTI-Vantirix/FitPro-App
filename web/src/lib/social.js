import { api } from '@/api/client';

// Terrain backgrounds offered when generating an analytics post.
// Served from web/public/backgrounds.
export const BACKGROUNDS = [
  {
    id: 'trees',
    label: 'Tree-lined road',
    url: '/backgrounds/trees.jpg',
  },
  {
    id: 'river',
    label: 'Riverside dusk',
    url: '/backgrounds/river.jpg',
  },
  {
    id: 'trail',
    label: 'Mountain trail',
    url: '/backgrounds/trail.jpg',
  },
];

export function cleanHandle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 24);
}

export async function findProfileByHandle(handle) {
  const page = await api.entities.SocialProfile.filter({ handle }, { limit: 1 });
  return (page.items || [])[0] || null;
}

export async function loadMyProfile(user) {
  const page = await api.entities.SocialProfile.filter(
    { created_by_id: user.id },
    { limit: 1 }
  );
  const existing = (page.items || [])[0];
  if (existing) return existing;

  const base = cleanHandle(
    (user.full_name || user.email || 'athlete').replace(/\s+/g, '.').replace(/@.*/, '')
  );
  let handle = base || 'athlete';
  if (await findProfileByHandle(handle)) {
    handle = `${handle}${Math.floor(1000 + Math.random() * 9000)}`;
  }

  return api.entities.SocialProfile.create({
    handle,
    display_name: user.full_name || handle,
    visibility: 'private',
  });
}

export async function loadConnections(userId) {
  const page = await api.entities.Connection.filter(
    { $or: [{ from_user_id: userId }, { to_user_id: userId }] },
    { sort: '-created_date', limit: 200 }
  );
  return page.items || [];
}

export function splitConnections(connections, userId) {
  return {
    friends: connections.filter((c) => c.status === 'accepted'),
    incoming: connections.filter((c) => c.status === 'pending' && c.to_user_id === userId),
    outgoing: connections.filter((c) => c.status === 'pending' && c.from_user_id === userId),
  };
}

export async function sendRequest({ me, myProfile, target }) {
  const existing = await api.entities.Connection.filter(
    {
      $or: [
        { from_user_id: me.id, to_user_id: target.created_by_id },
        { from_user_id: target.created_by_id, to_user_id: me.id },
      ],
    },
    { limit: 1 }
  );
  const found = (existing.items || [])[0];
  if (found) return found;

  return api.entities.Connection.create({
    from_user_id: me.id,
    to_user_id: target.created_by_id,
    from_handle: myProfile.handle,
    from_name: myProfile.display_name || myProfile.handle,
    to_handle: target.handle,
    to_name: target.display_name || target.handle,
    // A public account accepts straight away; a private one approves first.
    status: target.visibility === 'public' ? 'accepted' : 'pending',
  });
}

export function inviteLink(handle) {
  return `${window.location.origin}/friends?add=${encodeURIComponent(handle)}`;
}

export function postLink(post) {
  return `${window.location.origin}/feed?post=${post.id}`;
}

export function externalShareUrl(id, { text, url }) {
  const t = encodeURIComponent(text);
  const u = encodeURIComponent(url);
  if (id === 'facebook') {
    return `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`;
  }
  if (id === 'x') {
    return `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
  }
  // Instagram has no web intent — the share sheet or the saved image is the path.
  return null;
}

export function postText(post) {
  if (post.kind === 'run') {
    const bits = [`${Number(post.distance_mi || 0).toFixed(2)} mi`];
    if (post.zone_name) bits.push(post.zone_name);
    return `${bits.join(' · ')} — logged on VantraRun`;
  }
  const bits = [`${Number(post.volume_lb || 0).toLocaleString()} lb moved`];
  if (post.set_count) bits.push(`${post.set_count} sets`);
  return `${bits.join(' · ')} — logged on VantraRun`;
}