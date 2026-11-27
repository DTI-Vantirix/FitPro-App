import { requireAccess } from '../access.js';
import { HttpError, reply } from '../lib/http.js';

// REST surface for entity records. Every route needs a signed-in user with access
// to the product (see ../access.js); what they can see and change is decided by
// the entity's rules (see rules.js).
//
//   POST   /api/entities/:entity/query        { q, sort, limit, skip } -> { items }
//   GET    /api/entities/:entity              ?q=<json>&sort=&limit=&skip=
//   POST   /api/entities/:entity              create
//   POST   /api/entities/:entity/bulk         create many
//   PUT    /api/entities/:entity/bulk         update many by id
//   POST   /api/entities/:entity/update-many  { q, data }
//   POST   /api/entities/:entity/delete-many  { q }
//   GET    /api/entities/:entity/:id
//   PUT    /api/entities/:entity/:id
//   DELETE /api/entities/:entity/:id
export function registerEntityRoutes(router, entities) {
  const parseQ = (raw) => {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'q must be JSON.');
    }
  };

  router.add('POST', '/api/entities/:entity/query', async (ctx) =>
    entities.query(await requireAccess(ctx), ctx.params.entity, ctx.body)
  );

  router.add('GET', '/api/entities/:entity', async (ctx) => {
    const sp = ctx.url.searchParams;
    return entities.query(await requireAccess(ctx), ctx.params.entity, {
      q: parseQ(sp.get('q')),
      sort: sp.get('sort') || undefined,
      limit: sp.get('limit') || undefined,
      skip: sp.get('skip') || undefined,
    });
  });

  router.add('POST', '/api/entities/:entity/bulk', async (ctx) =>
    entities.bulkCreate(await requireAccess(ctx), ctx.params.entity, ctx.body)
  );

  router.add('PUT', '/api/entities/:entity/bulk', async (ctx) =>
    entities.bulkUpdate(await requireAccess(ctx), ctx.params.entity, ctx.body)
  );

  router.add('POST', '/api/entities/:entity/update-many', async (ctx) =>
    entities.updateMany(await requireAccess(ctx), ctx.params.entity, ctx.body.q, ctx.body.data)
  );

  router.add('POST', '/api/entities/:entity/delete-many', async (ctx) =>
    entities.deleteMany(await requireAccess(ctx), ctx.params.entity, ctx.body.q)
  );

  router.add('POST', '/api/entities/:entity', async (ctx) =>
    reply(201, await entities.create(await requireAccess(ctx), ctx.params.entity, ctx.body))
  );

  router.add('GET', '/api/entities/:entity/:id', async (ctx) =>
    entities.get(await requireAccess(ctx), ctx.params.entity, ctx.params.id)
  );

  router.add('PUT', '/api/entities/:entity/:id', async (ctx) =>
    entities.update(await requireAccess(ctx), ctx.params.entity, ctx.params.id, ctx.body)
  );

  router.add('DELETE', '/api/entities/:entity/:id', async (ctx) =>
    entities.delete(await requireAccess(ctx), ctx.params.entity, ctx.params.id)
  );
}
