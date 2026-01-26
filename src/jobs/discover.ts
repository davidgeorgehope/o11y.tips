import { db, discoverySchedules } from '../db/index.js';
import { eq, and, or, lte, isNull } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { runDiscovery, type DiscoveryResult } from '../services/discovery/index.js';

const logger = createLogger('jobs:discover');

export interface DiscoveryJobResult {
  schedulesProcessed: number;
  totalDiscovered: number;
  results: DiscoveryResult[];
  errors: Array<{ scheduleId: string; error: string }>;
}

export async function runDiscoveryJob(): Promise<DiscoveryJobResult> {
  logger.info('Starting discovery job');

  const now = new Date().toISOString();

  // Find schedules that are due to run
  // Either nextRunAt is null (never run) or nextRunAt is in the past
  const dueSchedules = await db.query.discoverySchedules.findMany({
    where: and(
      eq(discoverySchedules.isActive, true),
      or(
        isNull(discoverySchedules.nextRunAt),
        lte(discoverySchedules.nextRunAt, now)
      )
    ),
  });

  logger.info(`Found ${dueSchedules.length} schedules due for discovery`);

  const results: DiscoveryResult[] = [];
  const errors: Array<{ scheduleId: string; error: string }> = [];
  let totalDiscovered = 0;

  for (const schedule of dueSchedules) {
    try {
      logger.debug(`Running discovery for schedule ${schedule.id}`);

      const result = await runDiscovery(schedule.id);
      results.push(result);
      totalDiscovered += result.posts.length;

      // Update next run time (4 hours from now by default)
      const nextRun = new Date();
      nextRun.setHours(nextRun.getHours() + 4);

      await db.update(discoverySchedules)
        .set({
          nextRunAt: nextRun.toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(discoverySchedules.id, schedule.id));

      logger.info(`Discovery complete for schedule ${schedule.id}`, {
        discovered: result.stats.discovered,
        stored: result.posts.length,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ scheduleId: schedule.id, error: message });
      logger.error(`Discovery failed for schedule ${schedule.id}`, { error });
    }

    // Small delay between schedules to avoid rate limits
    await sleep(2000);
  }

  const jobResult: DiscoveryJobResult = {
    schedulesProcessed: dueSchedules.length,
    totalDiscovered,
    results,
    errors,
  };

  logger.info('Discovery job complete', {
    processed: jobResult.schedulesProcessed,
    discovered: jobResult.totalDiscovered,
    errors: jobResult.errors.length,
  });

  return jobResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
