import { randomInt } from 'node:crypto';
import { HttpError } from '../lib/http.js';
import { isUuid, serialize } from '../lib/serialize.js';

// Admin-only: mint, list and revoke single-use access codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  const block = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `FP-${block(4)}-${block(4)}`;
}

export default async function adminInviteCodes({ db, user, body }) {
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only');
  const action = body?.action || 'list';

  if (action === 'list') {
    const codes = (await db.query('select * from invite_codes order by created_date desc limit 200', [])).map(serialize);
    const grants = (await db.query('select * from access_grants order by created_date desc limit 200', [])).map(serialize);
    return {
      codes,
      grants,
      stats: {
        available: codes.filter((c) => c.status === 'available').length,
        used: codes.filter((c) => c.status === 'used').length,
        revoked: codes.filter((c) => c.status === 'revoked').length,
      },
    };
  }

  if (action === 'generate') {
    const count = Math.min(25, Math.max(1, Number(body?.count) || 1));
    const note = typeof body?.note === 'string' ? body.note.slice(0, 80) : '';
    const created = [];
    // 32^8 possible codes; a collision is vanishingly rare, but the unique index
    // makes it harmless: that insert is skipped and we try another code.
    let guard = 0;
    while (created.length < count && guard < count * 5) {
      guard += 1;
      const rows = await db.query(
        `insert into invite_codes (code, status, note, created_by_id, created_by)
         values ($1, 'available', $2, $3, $4)
         on conflict (code) do nothing
         returning *`,
        [makeCode(), note, user.id, user.email]
      );
      if (rows[0]) created.push(serialize(rows[0]));
    }
    return { created };
  }

  if (action === 'revoke') {
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) throw new HttpError(400, 'id is required');
    const [record] = isUuid(id) ? await db.query('select * from invite_codes where id = $1', [id]) : [];
    if (!record) throw new HttpError(404, 'Not found');
    if (record.status !== 'available') throw new HttpError(400, 'Only unused codes can be revoked');
    const [updated] = await db.query(
      `update invite_codes set status = 'revoked', updated_date = now() where id = $1 returning *`,
      [id]
    );
    return { code: serialize(updated) };
  }

  throw new HttpError(400, 'Unknown action');
}
