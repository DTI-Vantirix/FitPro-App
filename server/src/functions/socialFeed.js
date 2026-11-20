import { serialize } from '../lib/serialize.js';

// The posts a signed-in athlete may see in their feed: their own, plus accepted
// friends' posts that are not private.
export default async function socialFeed({ db, user }) {
  const links = await db.query(
    `select from_user_id, to_user_id from connections
      where status = 'accepted' and (from_user_id = $1 or to_user_id = $1)
      limit 500`,
    [user.id]
  );
  const friendIds = [...new Set(links.map((l) => (l.from_user_id === user.id ? l.to_user_id : l.from_user_id)))];

  const posts = await db.query(
    `select * from posts
      where created_by_id = $1
         or (created_by_id = any($2::uuid[]) and visibility <> 'private')
      order by created_date desc
      limit 40`,
    [user.id, friendIds]
  );

  return { posts: posts.map(serialize), friend_ids: friendIds };
}
