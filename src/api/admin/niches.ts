import { Hono } from 'hono';
import { db, niches } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { generateId, slugify } from '../../utils/hash.js';

const app = new Hono();

// List all niches
app.get('/', async (c) => {
  const allNiches = await db.query.niches.findMany({
    orderBy: (niches, { desc }) => [desc(niches.createdAt)],
  });
  return c.json(allNiches);
});

// Get single niche
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, id),
  });

  if (!niche) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  return c.json(niche);
});

// Create niche
app.post('/', async (c) => {
  const body = await c.req.json();

  const { name, description, voiceGuidelines, targetAudience, keywords } = body;

  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const slug = slugify(name);

  // Check for existing slug
  const existing = await db.query.niches.findFirst({
    where: eq(niches.slug, slug),
  });

  if (existing) {
    return c.json({ error: 'A niche with this name already exists' }, 400);
  }

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(niches).values({
    id,
    name,
    slug,
    description,
    voiceGuidelines,
    targetAudience,
    keywords: keywords ? JSON.stringify(keywords) : null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.niches.findFirst({
    where: eq(niches.id, id),
  });

  return c.json(created, 201);
});

// Update niche
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.query.niches.findFirst({
    where: eq(niches.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  const updates: Partial<typeof niches.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.name !== undefined) {
    updates.name = body.name;
    updates.slug = slugify(body.name);
  }
  if (body.description !== undefined) updates.description = body.description;
  if (body.voiceGuidelines !== undefined) updates.voiceGuidelines = body.voiceGuidelines;
  if (body.targetAudience !== undefined) updates.targetAudience = body.targetAudience;
  if (body.keywords !== undefined) updates.keywords = JSON.stringify(body.keywords);
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(niches)
    .set(updates)
    .where(eq(niches.id, id));

  const updated = await db.query.niches.findFirst({
    where: eq(niches.id, id),
  });

  return c.json(updated);
});

// Delete niche
app.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const existing = await db.query.niches.findFirst({
    where: eq(niches.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  await db.delete(niches).where(eq(niches.id, id));

  return c.json({ success: true });
});

export default app;
