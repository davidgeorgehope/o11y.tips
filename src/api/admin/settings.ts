import { Hono } from 'hono';
import { db, settings } from '../../db/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { generateId } from '../../utils/hash.js';
import { usageTracker } from '../../services/ai/clients.js';
import { reloadScheduler, getSchedulerStatus } from '../../jobs/scheduler.js';

const app = new Hono();

// Get all settings (global and for a specific niche)
app.get('/', async (c) => {
  const nicheId = c.req.query('nicheId');

  // Get global settings
  const globalSettings = await db.query.settings.findMany({
    where: isNull(settings.nicheId),
  });

  let nicheSettings: typeof settings.$inferSelect[] = [];
  if (nicheId) {
    nicheSettings = await db.query.settings.findMany({
      where: eq(settings.nicheId, nicheId),
    });
  }

  return c.json({
    global: settingsToObject(globalSettings),
    niche: nicheId ? settingsToObject(nicheSettings) : null,
  });
});

// Get a specific setting
app.get('/:key', async (c) => {
  const key = c.req.param('key');
  const nicheId = c.req.query('nicheId');

  // First try niche-specific, then fall back to global
  if (nicheId) {
    const nicheSetting = await db.query.settings.findFirst({
      where: and(eq(settings.key, key), eq(settings.nicheId, nicheId)),
    });
    if (nicheSetting) {
      return c.json(nicheSetting);
    }
  }

  const globalSetting = await db.query.settings.findFirst({
    where: and(eq(settings.key, key), isNull(settings.nicheId)),
  });

  if (!globalSetting) {
    return c.json({ error: 'Setting not found' }, 404);
  }

  return c.json(globalSetting);
});

// Set a setting
app.put('/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();
  const { value, nicheId, description } = body;

  if (value === undefined) {
    return c.json({ error: 'value is required' }, 400);
  }

  // Check if setting exists
  const whereCondition = nicheId
    ? and(eq(settings.key, key), eq(settings.nicheId, nicheId))
    : and(eq(settings.key, key), isNull(settings.nicheId));

  const existing = await db.query.settings.findFirst({
    where: whereCondition,
  });

  const now = new Date().toISOString();

  if (existing) {
    await db.update(settings)
      .set({
        value: String(value),
        description: description || existing.description,
        updatedAt: now,
      })
      .where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values({
      id: generateId(),
      key,
      value: String(value),
      nicheId: nicheId || null,
      description,
      createdAt: now,
      updatedAt: now,
    });
  }

  const updated = await db.query.settings.findFirst({
    where: whereCondition,
  });

  return c.json(updated);
});

// Delete a setting
app.delete('/:key', async (c) => {
  const key = c.req.param('key');
  const nicheId = c.req.query('nicheId');

  const whereCondition = nicheId
    ? and(eq(settings.key, key), eq(settings.nicheId, nicheId))
    : and(eq(settings.key, key), isNull(settings.nicheId));

  const existing = await db.query.settings.findFirst({
    where: whereCondition,
  });

  if (!existing) {
    return c.json({ error: 'Setting not found' }, 404);
  }

  await db.delete(settings).where(eq(settings.id, existing.id));

  return c.json({ success: true });
});

// Get AI usage stats
app.get('/ai/usage', async (c) => {
  const stats = usageTracker.getStats();
  return c.json(stats);
});

// Reset AI usage stats
app.post('/ai/usage/reset', async (c) => {
  usageTracker.reset();
  return c.json({ success: true });
});

// Get scheduler status
app.get('/scheduler/status', async (c) => {
  const status = getSchedulerStatus();
  return c.json({ jobs: status });
});

// Reload scheduler with new settings
app.post('/scheduler/reload', async (c) => {
  try {
    await reloadScheduler();
    const status = getSchedulerStatus();
    return c.json({ success: true, jobs: status });
  } catch (error) {
    return c.json({ error: 'Failed to reload scheduler' }, 500);
  }
});

// Helper function to convert settings array to object
function settingsToObject(settingsArray: typeof settings.$inferSelect[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const setting of settingsArray) {
    result[setting.key] = setting.value;
  }
  return result;
}

export default app;
