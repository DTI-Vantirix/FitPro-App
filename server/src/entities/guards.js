import { HttpError } from '../lib/http.js';

// Rules the "rls" blocks cannot express: ones that depend on which field is
// changing, or on another record. They run after the entity's own access rules,
// for single and bulk writes alike.
//
// Connection: an accepted connection lets each side read the other's friends-only
// posts, so only the person who was asked may accept. The sender's client says
// "accepted" when the target account is public; the server checks that for itself
// and otherwise files the request as pending.
const connection = {
  async create(db, user, row) {
    if (String(row.to_user_id) === String(row.from_user_id)) {
      throw new HttpError(400, "You can't send a friend request to yourself.");
    }
    let accepted = false;
    if (row.status === 'accepted') {
      const [target] = await db.query(
        `select 1 from social_profiles where created_by_id = $1 and visibility = 'public' limit 1`,
        [row.to_user_id]
      );
      accepted = Boolean(target);
    }
    row.status = accepted ? 'accepted' : 'pending';
  },

  update(user, existing, changes) {
    for (const field of ['from_user_id', 'to_user_id']) {
      if (field in changes && String(changes[field]) !== String(existing[field])) {
        throw new HttpError(403, "A friend request can't be pointed at someone else.");
      }
    }
    if ('status' in changes && changes.status !== existing.status && String(existing.to_user_id) !== String(user.id)) {
      throw new HttpError(403, 'Only the person who was asked can answer a friend request.');
    }
  },
};

export const GUARDS = { Connection: connection };
