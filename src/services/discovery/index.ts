import { db, discoveredPosts, discoverySchedules } from '../../db/index.js';
import { eq, and, gte } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { generateId } from '../../utils/hash.js';
import { groundedSearchSource } from './sources/grounded-search.js';
import { redditSource } from './sources/reddit.js';
import { stackoverflowSource } from './sources/stackoverflow.js';
import { hackernewsSource } from './sources/hackernews.js';
import { githubSource } from './sources/github.js';
import { scorePainPoints } from './scorer.js';
import type {
  DiscoverySource,
  SourceConfig,
  SourceType,
  ScoredPost,
  DiscoveryResult,
} from './types.js';

const logger = createLogger('discovery');

// Source registry
const sources: Record<SourceType, DiscoverySource> = {
  grounded_search: groundedSearchSource,
  reddit: redditSource,
  stackoverflow: stackoverflowSource,
  hackernews: hackernewsSource,
  github: githubSource,
};

export async function runDiscovery(scheduleId: string): Promise<DiscoveryResult> {
  logger.info('Starting discovery run', { scheduleId });

  // Get schedule configuration
  const schedule = await db.query.discoverySchedules.findFirst({
    where: eq(discoverySchedules.id, scheduleId),
  });

  if (!schedule) {
    throw new Error(`Discovery schedule not found: ${scheduleId}`);
  }

  if (!schedule.isActive) {
    throw new Error(`Discovery schedule is not active: ${scheduleId}`);
  }

  const scheduleConfig = JSON.parse(schedule.config) as Partial<SourceConfig>;
  const source = sources[schedule.sourceType as SourceType];

  if (!source) {
    throw new Error(`Unknown source type: ${schedule.sourceType}`);
  }

  // Build source configuration
  const sourceConfig: SourceConfig = {
    nicheId: schedule.nicheId,
    scheduleId: schedule.id,
    keywords: scheduleConfig.keywords || [],
    ...scheduleConfig,
  };

  // Discover posts
  logger.debug('Running source discovery', { sourceType: schedule.sourceType });
  const rawPosts = await source.discover(sourceConfig);
  logger.info('Discovered raw posts', { count: rawPosts.length });

  // Score posts
  logger.debug('Scoring pain points');
  const scoredPosts = await scorePainPoints(rawPosts);

  // Deduplicate against existing posts
  const { newPosts, duplicates } = await deduplicatePosts(scoredPosts, schedule.nicheId);
  logger.info('Deduplication complete', { new: newPosts.length, duplicates });

  // Filter by pain score threshold
  const minScore = config.discovery.minPainScore;
  const qualifyingPosts = newPosts.filter(post => post.painScore >= minScore);
  const belowThreshold = newPosts.length - qualifyingPosts.length;

  logger.info('Filtered by pain score', {
    qualifying: qualifyingPosts.length,
    belowThreshold,
    threshold: minScore,
  });

  // Store qualifying posts
  await storePosts(qualifyingPosts, schedule.nicheId, schedule.id);

  // Update schedule last run time
  await db.update(discoverySchedules)
    .set({
      lastRunAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(discoverySchedules.id, scheduleId));

  const result: DiscoveryResult = {
    posts: qualifyingPosts,
    sourceType: schedule.sourceType as SourceType,
    scheduleId,
    nicheId: schedule.nicheId,
    timestamp: new Date().toISOString(),
    stats: {
      discovered: rawPosts.length,
      scored: scoredPosts.length,
      duplicates,
      belowThreshold,
    },
  };

  logger.info('Discovery run complete', result.stats);
  return result;
}

export async function runAllActiveDiscoveries(nicheId?: string): Promise<DiscoveryResult[]> {
  // Get all active schedules
  const whereClause = nicheId
    ? and(eq(discoverySchedules.isActive, true), eq(discoverySchedules.nicheId, nicheId))
    : eq(discoverySchedules.isActive, true);

  const activeSchedules = await db.query.discoverySchedules.findMany({
    where: whereClause,
  });

  logger.info('Running all active discoveries', { count: activeSchedules.length });

  const results: DiscoveryResult[] = [];

  for (const schedule of activeSchedules) {
    try {
      const result = await runDiscovery(schedule.id);
      results.push(result);
    } catch (error) {
      logger.error('Discovery run failed', { scheduleId: schedule.id, error });
    }
  }

  return results;
}

async function deduplicatePosts(
  posts: ScoredPost[],
  nicheId: string
): Promise<{ newPosts: ScoredPost[]; duplicates: number }> {
  // Get existing content hashes from recent posts
  const windowDays = config.discovery.deduplicationWindowDays;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);

  const existingPosts = await db.query.discoveredPosts.findMany({
    where: and(
      eq(discoveredPosts.nicheId, nicheId),
      gte(discoveredPosts.discoveredAt, cutoffDate.toISOString())
    ),
    columns: {
      contentHash: true,
      sourceUrl: true,
    },
  });

  const existingHashes = new Set(existingPosts.map(p => p.contentHash));
  const existingUrls = new Set(existingPosts.map(p => p.sourceUrl));

  const newPosts: ScoredPost[] = [];
  let duplicates = 0;

  for (const post of posts) {
    if (existingHashes.has(post.contentHash) || existingUrls.has(post.sourceUrl)) {
      duplicates++;
    } else {
      newPosts.push(post);
    }
  }

  return { newPosts, duplicates };
}

async function storePosts(
  posts: ScoredPost[],
  nicheId: string,
  scheduleId: string
): Promise<void> {
  for (const post of posts) {
    await db.insert(discoveredPosts).values({
      id: generateId(),
      nicheId,
      scheduleId,
      sourceType: post.sourceType,
      sourceUrl: post.sourceUrl,
      sourceId: post.sourceId,
      title: post.title,
      content: post.content,
      author: post.author,
      authorLevel: post.authorLevel,
      metadata: JSON.stringify(post.metadata),
      painScore: post.painScore,
      painAnalysis: JSON.stringify(post.painAnalysis),
      status: 'pending',
      contentHash: post.contentHash,
      discoveredAt: post.discoveredAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

export type { DiscoveryResult, SourceType, SourceConfig };
