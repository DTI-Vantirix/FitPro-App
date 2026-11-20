import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// FitPro is invite-only: a single-use code has to be redeemed once per athlete
// before the app opens for them.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth
      .me()
      .catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action || 'status';

    if (action === 'status') {
      if (user.role === 'admin') return Response.json({ allowed: true, admin: true });
      const grants = await base44.asServiceRole.entities.AccessGrant.filter(
        { user_id: user.id },
        { limit: 1 }
      );
      return Response.json({ allowed: (grants.items || []).length > 0 });
    }

    if (action === 'redeem') {
      const code = String(body?.code || '').trim().toUpperCase();
      if (!code) return Response.json({ allowed: false, error: 'Enter an invite code.' });

      const granted = await base44.asServiceRole.entities.AccessGrant.filter(
        { user_id: user.id },
        { limit: 1 }
      );
      if ((granted.items || []).length) return Response.json({ allowed: true });

      const found = await base44.asServiceRole.entities.InviteCode.filter({ code }, { limit: 1 });
      const invite = (found.items || [])[0];
      if (!invite) return Response.json({ allowed: false, error: 'That code is not recognised.' });
      if (invite.status !== 'available') {
        return Response.json({ allowed: false, error: 'That code has already been used.' });
      }

      // Only an available code can be claimed, so two people cannot share one.
      await base44.asServiceRole.entities.InviteCode.updateMany(
        { code: invite.code, status: 'available' },
        {
          $set: {
            status: 'used',
            used_by_id: user.id,
            used_by_email: user.email,
            used_at: new Date().toISOString(),
          },
        }
      );

      const after = await base44.asServiceRole.entities.InviteCode.get(invite.id);
      if (after.used_by_id !== user.id) {
        return Response.json({ allowed: false, error: 'That code was just used by someone else.' });
      }

      await base44.asServiceRole.entities.AccessGrant.create({
        user_id: user.id,
        email: user.email,
        code: invite.code,
        granted_at: new Date().toISOString(),
      });

      return Response.json({ allowed: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}