import { Hono } from 'hono';
import { db, discoveredPosts } from '../../db/index.js';
import { eq, desc, and, gte, like, or } from 'drizzle-orm';
import { runDiscovery, runAllActiveDiscoveries } from '../../services/discovery/index.js';

const app = new Hono();

// List discovered posts with filtering and pagination
app.get('/', async (c) => {
  const nicheId = c.req.query('nicheId');
  const status = c.req.query('status');
  const minScore = c.req.query('minScore');
  const search = c.req.query('search');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  // Build where conditions
  const conditions = [];

  if (nicheId) {
    conditions.push(eq(discoveredPosts.nicheId, nicheId));
  }

  if (status) {
    conditions.push(eq(discoveredPosts.status, status));
  }

  if (minScore) {
    conditions.push(gte(discoveredPosts.painScore, parseFloat(minScore)));
  }

  if (search) {
    conditions.push(
      or(
        like(discoveredPosts.title, `%${search}%`),
        like(discoveredPosts.content, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const posts = await db.query.discoveredPosts.findMany({
    where: whereClause,
    orderBy: [desc(discoveredPosts.painScore), desc(discoveredPosts.discoveredAt)],
    limit,
    offset,
  });

  // Get total count for pagination
  const allPosts = await db.query.discoveredPosts.findMany({
    where: whereClause,
    columns: { id: true },
  });

  return c.json({
    posts,
    pagination: {
      total: allPosts.length,
      limit,
      offset,
      hasMore: offset + posts.length < allPosts.length,
    },
  });
});

// Get single discovered post
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const post = await db.query.discoveredPosts.findFirst({
    where: eq(discoveredPosts.id, id),
  });

  if (!post) {
    return c.json({ error: 'Post not found' }, 404);
  }

  return c.json(post);
});

// Update discovered post (change status, reject, etc.)
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.query.discoveredPosts.findFirst({
    where: eq(discoveredPosts.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Post not found' }, 404);
  }

  const updates: Partial<typeof discoveredPosts.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.status !== undefined) updates.status = body.status;
  if (body.rejectionReason !== undefined) updates.rejectionReason = body.rejectionReason;

  await db.update(discoveredPosts)
    .set(updates)
    .where(eq(discoveredPosts.id, id));

  const updated = await db.query.discoveredPosts.findFirst({
    where: eq(discoveredPosts.id, id),
  });

  return c.json(updated);
});

// Reject a post
app.post('/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.query.discoveredPosts.findFirst({
    where: eq(discoveredPosts.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Post not found' }, 404);
  }

  await db.update(discoveredPosts)
    .set({
      status: 'rejected',
      rejectionReason: body.reason || 'Rejected by admin',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(discoveredPosts.id, id));

  return c.json({ success: true });
});

// Trigger discovery for a schedule
app.post('/run/:scheduleId', async (c) => {
  const scheduleId = c.req.param('scheduleId');

  try {
    const result = await runDiscovery(scheduleId);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Trigger all discoveries for a niche
app.post('/run-all', async (c) => {
  const body = await c.req.json();
  const nicheId = body.nicheId;

  try {
    const results = await runAllActiveDiscoveries(nicheId);
    return c.json({
      runs: results.length,
      totalDiscovered: results.reduce((sum, r) => sum + r.stats.discovered, 0),
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get discovery stats
app.get('/stats', async (c) => {
  const nicheId = c.req.query('nicheId');

  const whereClause = nicheId ? eq(discoveredPosts.nicheId, nicheId) : undefined;

  const allPosts = await db.query.discoveredPosts.findMany({
    where: whereClause,
    columns: {
      status: true,
      painScore: true,
    },
  });

  const stats = {
    total: allPosts.length,
    byStatus: {
      pending: allPosts.filter(p => p.status === 'pending').length,
      queued: allPosts.filter(p => p.status === 'queued').length,
      processing: allPosts.filter(p => p.status === 'processing').length,
      completed: allPosts.filter(p => p.status === 'completed').length,
      rejected: allPosts.filter(p => p.status === 'rejected').length,
    },
    avgPainScore: allPosts.length > 0
      ? allPosts.reduce((sum, p) => sum + (p.painScore || 0), 0) / allPosts.length
      : 0,
    highValuePosts: allPosts.filter(p => (p.painScore || 0) >= 70).length,
  };

  return c.json(stats);
});

export default app;
