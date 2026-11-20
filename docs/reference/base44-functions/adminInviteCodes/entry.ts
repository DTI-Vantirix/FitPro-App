import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  const pick = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  const block = (n) => Array.from({ length: n }, pick).join('');
  return `FP-${block(4)}-${block(4)}`;
}

// Admin-only: mint, list and revoke single-use access codes.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth
      .me()
      .catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admins only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action || 'list';

    if (action === 'list') {
      const [codePage, grantPage] = await Promise.all([
        base44.asServiceRole.entities.InviteCode.list({ sort: '-created_date', limit: 200 }),
        base44.asServiceRole.entities.AccessGrant.list({ sort: '-created_date', limit: 200 }),
      ]);
      const codes = codePage.items || [];
      return Response.json({
        codes,
        grants: grantPage.items || [],
        stats: {
          available: codes.filter((c) => c.status === 'available').length,
          used: codes.filter((c) => c.status === 'used').length,
          revoked: codes.filter((c) => c.status === 'revoked').length,
        },
      });
    }

    if (action === 'generate') {
      const count = Math.min(25, Math.max(1, Number(body?.count) || 1));
      const note = typeof body?.note === 'string' ? body.note.slice(0, 80) : '';
      const existing = await base44.asServiceRole.entities.InviteCode.list({ limit: 500 });
      const taken = new Set((existing.items || []).map((c) => c.code));

      const rows = [];
      for (let i = 0; i < count; i += 1) {
        let code = makeCode();
        let guard = 0;
        while (taken.has(code) && guard < 20) {
          code = makeCode();
          guard += 1;
        }
        taken.add(code);
        rows.push({ code, status: 'available', note });
      }

      const created = await base44.asServiceRole.entities.InviteCode.bulkCreate(rows);
      return Response.json({ created });
    }

    if (action === 'revoke') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      const record = await base44.asServiceRole.entities.InviteCode.get(id).catch((e) =>
        e.status === 404 ? null : Promise.reject(e)
      );
      if (!record) return Response.json({ error: 'Not found' }, { status: 404 });
      if (record.status !== 'available') {
        return Response.json({ error: 'Only unused codes can be revoked' }, { status: 400 });
      }
      const updated = await base44.asServiceRole.entities.InviteCode.update(id, { status: 'revoked' });
      return Response.json({ code: updated });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}