import { db, settings } from '../db/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { config } from '../config.js';

// Get a setting value from DB, falling back to config default
export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const setting = await db.query.settings.findFirst({
    where: and(eq(settings.key, key), isNull(settings.nicheId)),
  });
  return setting?.value ?? defaultValue;
}

// Get cron settings with config fallbacks
export async function getCronSettings(): Promise<{
  discoveryCron: string;
  generationCron: string;
  cleanupCron: string;
}> {
  const [discoveryCron, generationCron, cleanupCron] = await Promise.all([
    getSetting('discovery_cron', config.jobs.discoveryCron),
    getSetting('generation_cron', config.jobs.generationCron),
    getSetting('cleanup_cron', config.jobs.cleanupCron),
  ]);

  return { discoveryCron, generationCron, cleanupCron };
}
