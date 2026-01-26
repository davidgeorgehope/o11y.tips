import { Hono } from 'hono';
import { db, discoverySchedules, niches } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { generateId } from '../../utils/hash.js';

const app = new Hono();

// List all schedules
app.get('/', async (c) => {
  const nicheId = c.req.query('nicheId');

  let schedules;
  if (nicheId) {
    schedules = await db.query.discoverySchedules.findMany({
      where: eq(discoverySchedules.nicheId, nicheId),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
  } else {
    schedules = await db.query.discoverySchedules.findMany({
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });
  }

  return c.json(schedules);
});

// Get single schedule
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const schedule = await db.query.discoverySchedules.findFirst({
    where: eq(discoverySchedules.id, id),
  });

  if (!schedule) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  return c.json(schedule);
});

// Create schedule
app.post('/', async (c) => {
  const body = await c.req.json();

  const { nicheId, sourceType, config: sourceConfig } = body;

  if (!nicheId || !sourceType || !sourceConfig) {
    return c.json({ error: 'nicheId, sourceType, and config are required' }, 400);
  }

  // Verify niche exists
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, nicheId),
  });

  if (!niche) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  // Validate source type
  const validSourceTypes = ['grounded_search', 'reddit', 'stackoverflow', 'hackernews', 'github'];
  if (!validSourceTypes.includes(sourceType)) {
    return c.json({ error: `Invalid source type. Must be one of: ${validSourceTypes.join(', ')}` }, 400);
  }

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(discoverySchedules).values({
    id,
    nicheId,
    sourceType,
    config: JSON.stringify(sourceConfig),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.discoverySchedules.findFirst({
    where: eq(discoverySchedules.id, id),
  });

  return c.json(created, 201);
});

// Update schedule
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.query.discoverySchedules.findFirst({
    where: eq(discoverySchedules.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  const updates: Partial<typeof discoverySchedules.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.config !== undefined) updates.config = JSON.stringify(body.config);
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(discoverySchedules)
    .set(updates)
    .where(eq(discoverySchedules.id, id));

  const updated = await db.query.discoverySchedules.findFirst({
    where: eq(discoverySchedules.id, id),
  });

  return c.json(updated);
});

// Delete schedule
app.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const existing = await db.query.discoverySchedules.findFirst({
    where: eq(discoverySchedules.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  await db.delete(discoverySchedules).where(eq(discoverySchedules.id, id));

  return c.json({ success: true });
});

export default app;
