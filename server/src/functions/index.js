import { requireUser } from '../auth/users.js';
import { HttpError } from '../lib/http.js';
import adminInviteCodes from './adminInviteCodes.js';
import challengeBoard from './challengeBoard.js';
import ingestActivity from './ingestActivity.js';
import inviteAccess from './inviteAccess.js';
import snapRoute from './snapRoute.js';
import socialFeed from './socialFeed.js';

// POST /api/functions/:name — same names and bodies the app sent to Base44
// (base44.functions.invoke). Every function needs a signed-in user.
const FUNCTIONS = { adminInviteCodes, challengeBoard, ingestActivity, inviteAccess, snapRoute, socialFeed };

export function registerFunctionRoutes(router) {
  router.add('POST', '/api/functions/:name', async (ctx) => {
    const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, ctx.params.name) ? FUNCTIONS[ctx.params.name] : null;
    if (!fn) throw new HttpError(404, `Unknown function "${ctx.params.name}".`);
    const user = requireUser(ctx);
    return fn({ db: ctx.db, user, body: ctx.body || {}, config: ctx.config });
  });
}
