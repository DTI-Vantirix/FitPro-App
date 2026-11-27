import { decideAccess, grantFree } from '../access.js';
import { HttpError } from '../lib/http.js';
import { isUuid } from '../lib/serialize.js';

// Admin-only: who has access and why, with free passes given and taken back by hand.
// Paid subscriptions are shown but never changed here; those are cancelled with the
// payment provider, which then tells the server.
const MAX_PEOPLE = 200;
const FREE_SOURCES = ['invite', 'admin'];

const iso = (value) => (value ? new Date(value).toISOString() : null);

const publicEntitlement = (row) => ({
  id: row.id,
  source: row.source,
  status: row.status,
  plan: row.plan ?? null,
  expires_at: iso(row.expires_at),
  granted_by: row.granted_by ?? null,
  note: row.note ?? null,
  created_date: iso(row.created_date),
});

// Turns what the admin typed into a pattern that matches it literally, anywhere in the email.
const containing = (text) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export default async function adminAccess({ db, user, body }) {
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only');
  const action = body?.action || 'list';

  if (action === 'list') {
    const search = typeof body?.search === 'string' ? body.search.trim().toLowerCase().slice(0, 254) : '';
    const users = await db.query(
      `select id, email, full_name, role
         from users
        where ($1 = '' or lower(email) like $2 escape '\\')
        order by created_date desc, id desc
        limit ${MAX_PEOPLE}`,
      [search, containing(search)]
    );
    const rows = users.length
      ? await db.query('select * from entitlements where user_id = any($1::uuid[]) order by created_date, id', [users.map((u) => u.id)])
      : [];
    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push(row);
    }
    const now = new Date();
    const people = users.map((person) => {
      const own = byUser.get(person.id) || [];
      const { admin: _admin, ...access } = decideAccess(person, own, now);
      return {
        user_id: person.id,
        email: person.email,
        full_name: person.full_name ?? null,
        role: person.role,
        ...access,
        entitlements: own.map(publicEntitlement),
      };
    });
    return { people };
  }

  if (action === 'grant') {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    const [person] = email ? await db.query('select id from users where lower(email) = $1', [email]) : [];
    if (!person) throw new HttpError(404, 'No account with that email yet. Send them an invite code instead.');
    const entitlement = await db.tx((tx) =>
      grantFree(tx, { userId: person.id, source: 'admin', grantedBy: user.email, note })
    );
    return { ok: true, entitlement: publicEntitlement(entitlement) };
  }

  if (action === 'revoke') {
    const id = typeof body?.entitlement_id === 'string' ? body.entitlement_id : '';
    if (!id) throw new HttpError(400, 'entitlement_id is required');
    const [row] = isUuid(id) ? await db.query('select id, source from entitlements where id = $1', [id]) : [];
    if (!row) throw new HttpError(404, 'Not found');
    if (!FREE_SOURCES.includes(row.source)) {
      throw new HttpError(400, 'Paid subscriptions are cancelled with the payment provider.');
    }
    await db.query(`update entitlements set status = 'revoked', updated_date = now() where id = $1 returning id`, [id]);
    return { ok: true };
  }

  throw new HttpError(400, 'Unknown action');
}
