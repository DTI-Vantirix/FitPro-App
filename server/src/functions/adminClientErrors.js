import { HttpError } from '../lib/http.js';
import { serialize } from '../lib/serialize.js';

// Admin-only: read and clear the error reports the phone app and the API recorded
// (see src/errors.js).
export default async function adminClientErrors({ db, user, body }) {
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only');
  const action = body?.action || 'list';

  if (action === 'list') {
    const rows = await db.query(
      `select e.id, e.created_date, e.platform, e.app_version, e.message, e.stack, e.context,
              u.email as user_email
         from client_errors e
         left join users u on u.id = e.user_id
        order by e.created_date desc, e.id desc
        limit 100`,
      []
    );
    const [{ total }] = await db.query('select count(*)::int as total from client_errors', []);
    return { errors: rows.map(serialize), total };
  }

  if (action === 'clear') {
    const removed = await db.query('delete from client_errors returning id', []);
    return { ok: true, removed: removed.length };
  }

  // Lets the owner confirm, on the live host, that an unexpected error is recorded.
  if (action === 'test-crash') throw new Error('Test error requested by an admin.');

  throw new HttpError(400, `Unknown action "${action}".`);
}
