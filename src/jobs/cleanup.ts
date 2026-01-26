import { db, discoveredPosts, generationJobs, content, images } from '../db/index.js';
import { eq, and, lt, inArray } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('jobs:cleanup');

export interface CleanupResult {
  deletedPosts: number;
  deletedJobs: number;
  deletedImages: number;
  freedSpace: number;
}

export async function runCleanupJob(): Promise<CleanupResult> {
  logger.info('Starting cleanup job');

  const result: CleanupResult = {
    deletedPosts: 0,
    deletedJobs: 0,
    deletedImages: 0,
    freedSpace: 0,
  };

  // 1. Clean up old rejected posts (older than 30 days)
  result.deletedPosts = await cleanupOldRejectedPosts();

  // 2. Clean up old failed jobs (older than 7 days)
  result.deletedJobs = await cleanupOldFailedJobs();

  // 3. Clean up orphaned images
  const imageResult = await cleanupOrphanedImages();
  result.deletedImages = imageResult.count;
  result.freedSpace = imageResult.size;

  logger.info('Cleanup job complete', result);
  return result;
}

async function cleanupOldRejectedPosts(): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffDate = thirtyDaysAgo.toISOString();

  // Find old rejected posts
  const oldPosts = await db.query.discoveredPosts.findMany({
    where: and(
      eq(discoveredPosts.status, 'rejected'),
      lt(discoveredPosts.updatedAt, cutoffDate)
    ),
    columns: { id: true },
  });

  if (oldPosts.length === 0) {
    return 0;
  }

  const ids = oldPosts.map(p => p.id);

  await db.delete(discoveredPosts)
    .where(inArray(discoveredPosts.id, ids));

  logger.info(`Deleted ${oldPosts.length} old rejected posts`);
  return oldPosts.length;
}

async function cleanupOldFailedJobs(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffDate = sevenDaysAgo.toISOString();

  // Find old failed jobs
  const oldJobs = await db.query.generationJobs.findMany({
    where: and(
      eq(generationJobs.status, 'failed'),
      lt(generationJobs.updatedAt, cutoffDate)
    ),
    columns: { id: true },
  });

  if (oldJobs.length === 0) {
    return 0;
  }

  const ids = oldJobs.map(j => j.id);

  await db.delete(generationJobs)
    .where(inArray(generationJobs.id, ids));

  logger.info(`Deleted ${oldJobs.length} old failed jobs`);
  return oldJobs.length;
}

async function cleanupOrphanedImages(): Promise<{ count: number; size: number }> {
  // Find images whose content has been deleted or archived
  const archivedContent = await db.query.content.findMany({
    where: eq(content.status, 'archived'),
    columns: { id: true },
  });

  if (archivedContent.length === 0) {
    return { count: 0, size: 0 };
  }

  const contentIds = archivedContent.map(c => c.id);

  // Get images for archived content
  const orphanedImages = await db.query.images.findMany({
    where: inArray(images.contentId, contentIds),
  });

  let deletedCount = 0;
  let freedSize = 0;

  for (const image of orphanedImages) {
    // Delete file from disk
    if (image.filePath && existsSync(image.filePath)) {
      try {
        const stats = await import('fs').then(fs =>
          new Promise<{ size: number }>((resolve, reject) => {
            fs.stat(image.filePath!, (err, stats) => {
              if (err) reject(err);
              else resolve({ size: stats.size });
            });
          })
        );

        await unlink(image.filePath);
        freedSize += stats.size;
        deletedCount++;
      } catch (error) {
        logger.warn(`Failed to delete image file: ${image.filePath}`, { error });
      }
    }
  }

  // Delete image records
  if (orphanedImages.length > 0) {
    const imageIds = orphanedImages.map(i => i.id);
    await db.delete(images)
      .where(inArray(images.id, imageIds));
  }

  logger.info(`Cleaned up ${deletedCount} orphaned images, freed ${formatBytes(freedSize)}`);
  return { count: deletedCount, size: freedSize };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
