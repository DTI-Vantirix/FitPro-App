import { requireAccess } from '../access.js';
import { requireUser } from '../auth/users.js';
import { HttpError } from '../lib/http.js';
import adminAccess from './adminAccess.js';
import adminClientErrors from './adminClientErrors.js';
import adminInviteCodes from './adminInviteCodes.js';
import challengeBoard from './challengeBoard.js';
import ingestActivity from './ingestActivity.js';
import inviteAccess from './inviteAccess.js';
import routeDirections from './routeDirections.js';
import snapRoute from './snapRoute.js';
import socialFeed from './socialFeed.js';

// POST /api/functions/:name — same names and bodies the app sent to Base44
// (base44.functions.invoke). Every function needs a signed-in user, and every one
// except those in OPEN needs access to the product.
const FUNCTIONS = { adminAccess, adminClientErrors, adminInviteCodes, challengeBoard, ingestActivity, inviteAccess, routeDirections, snapRoute, socialFeed };

// What a person without access can still call: read their access status and redeem a code.
const OPEN = new Set(['inviteAccess']);

export function registerFunctionRoutes(router) {
  router.add('POST', '/api/functions/:name', async (ctx) => {
    // Sign-in comes first, so someone who is not signed in gets the same 401 for a
    // name that exists and one that does not, and cannot find out which functions there are.
    requireUser(ctx);
    const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, ctx.params.name) ? FUNCTIONS[ctx.params.name] : null;
    if (!fn) throw new HttpError(404, `Unknown function "${ctx.params.name}".`);
    const user = OPEN.has(ctx.params.name) ? requireUser(ctx) : await requireAccess(ctx);
    return fn({ db: ctx.db, user, body: ctx.body || {}, config: ctx.config });
  });
}
