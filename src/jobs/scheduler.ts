import cron from 'node-cron';
import { createLogger } from '../utils/logger.js';
import { runDiscoveryJob } from './discover.js';
import { runGenerationProcessor } from './generate.js';
import { runCleanupJob } from './cleanup.js';
import { getCronSettings } from '../services/settings.js';

const logger = createLogger('scheduler');

interface ScheduledTask {
  name: string;
  task: cron.ScheduledTask;
  cronExpression: string;
}

const scheduledTasks: ScheduledTask[] = [];

export async function startScheduler(): Promise<void> {
  // Get cron settings from database (with config fallbacks)
  const cronSettings = await getCronSettings();

  logger.info('Starting scheduler with cron settings', cronSettings);

  // Discovery job
  const discoveryTask = cron.schedule(cronSettings.discoveryCron, async () => {
    logger.info('Running scheduled discovery job');
    try {
      await runDiscoveryJob();
    } catch (error) {
      logger.error('Scheduled discovery job failed', { error });
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  scheduledTasks.push({
    name: 'discovery',
    task: discoveryTask,
    cronExpression: cronSettings.discoveryCron,
  });

  // Generation processor job
  const generationTask = cron.schedule(cronSettings.generationCron, async () => {
    logger.info('Running scheduled generation processor');
    try {
      await runGenerationProcessor();
    } catch (error) {
      logger.error('Scheduled generation processor failed', { error });
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  scheduledTasks.push({
    name: 'generation',
    task: generationTask,
    cronExpression: cronSettings.generationCron,
  });

  // Cleanup job
  const cleanupTask = cron.schedule(cronSettings.cleanupCron, async () => {
    logger.info('Running scheduled cleanup job');
    try {
      await runCleanupJob();
    } catch (error) {
      logger.error('Scheduled cleanup job failed', { error });
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  scheduledTasks.push({
    name: 'cleanup',
    task: cleanupTask,
    cronExpression: cronSettings.cleanupCron,
  });

  logger.info('Scheduler started', {
    jobs: scheduledTasks.map(t => ({ name: t.name, cron: t.cronExpression })),
  });
}

// Reload scheduler with new settings from database
export async function reloadScheduler(): Promise<void> {
  logger.info('Reloading scheduler with updated settings');
  stopScheduler();
  await startScheduler();
}

export function stopScheduler(): void {
  logger.info('Stopping scheduler');

  for (const task of scheduledTasks) {
    task.task.stop();
    logger.debug(`Stopped task: ${task.name}`);
  }

  scheduledTasks.length = 0;
  logger.info('Scheduler stopped');
}

export function getSchedulerStatus(): Array<{
  name: string;
  cronExpression: string;
  nextRun: Date | null;
}> {
  return scheduledTasks.map(task => ({
    name: task.name,
    cronExpression: task.cronExpression,
    nextRun: null, // node-cron doesn't expose next run time easily
  }));
}

// Manual trigger functions for API
export async function triggerDiscovery(): Promise<void> {
  logger.info('Manually triggering discovery job');
  await runDiscoveryJob();
}

export async function triggerGeneration(): Promise<void> {
  logger.info('Manually triggering generation processor');
  await runGenerationProcessor();
}

export async function triggerCleanup(): Promise<void> {
  logger.info('Manually triggering cleanup job');
  await runCleanupJob();
}
