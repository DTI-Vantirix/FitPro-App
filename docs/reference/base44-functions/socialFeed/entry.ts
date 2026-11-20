import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// Returns the posts a signed-in athlete may see in their feed: their own, plus
// accepted friends' posts that are not private. Post RLS only opens public posts
// to the client, so friends-only posts are resolved here with the service role.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth
      .me()
      .catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const links = await base44.asServiceRole.entities.Connection.filter(
      {
        status: 'accepted',
        $or: [{ from_user_id: user.id }, { to_user_id: user.id }],
      },
      { limit: 500 }
    );

    const friendIds = (links.items || []).map((l) =>
      l.from_user_id === user.id ? l.to_user_id : l.from_user_id
    );

    const query = friendIds.length
      ? { $or: [{ created_by_id: user.id }, { created_by_id: { $in: friendIds } }] }
      : { created_by_id: user.id };

    const page = await base44.asServiceRole.entities.Post.filter(query, {
      sort: '-created_date',
      limit: 40,
    });

    const posts = (page.items || []).filter(
      (p) => p.created_by_id === user.id || p.visibility !== 'private'
    );

    return Response.json({ posts, friend_ids: friendIds });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}