import { db, generationJobs, discoveredPosts, content } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { runGenerationJob, createGenerationJob } from '../services/generation/orchestrator.js';
import { generateJSON } from '../services/ai/clients.js';

const logger = createLogger('jobs:generate');

export interface GenerationProcessorResult {
  jobsStarted: number;
  jobsCompleted: number;
  jobsFailed: number;
  autoQueued: number;
}

// Track currently running jobs to prevent double-processing
const runningJobs = new Set<string>();

export async function runGenerationProcessor(): Promise<GenerationProcessorResult> {
  logger.info('Starting generation processor');

  const result: GenerationProcessorResult = {
    jobsStarted: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    autoQueued: 0,
  };

  // 1. Auto-queue high-scoring discovered posts
  result.autoQueued = await autoQueueDiscoveredPosts();

  // 2. Get pending jobs
  const pendingJobs = await db.query.generationJobs.findMany({
    where: eq(generationJobs.status, 'pending'),
    orderBy: [desc(generationJobs.createdAt)],
    limit: config.generation.maxConcurrentJobs,
  });

  // Filter out jobs that are already running
  const jobsToProcess = pendingJobs.filter(job => !runningJobs.has(job.id));

  // Calculate how many more we can start
  const availableSlots = config.generation.maxConcurrentJobs - runningJobs.size;
  const jobsToStart = jobsToProcess.slice(0, availableSlots);

  logger.info(`Found ${pendingJobs.length} pending jobs, starting ${jobsToStart.length}`);

  // Start jobs concurrently (but limited)
  const jobPromises = jobsToStart.map(async (job) => {
    runningJobs.add(job.id);
    result.jobsStarted++;

    try {
      await runGenerationJob(job.id);
      result.jobsCompleted++;
      logger.info(`Job ${job.id} completed`);
    } catch (error) {
      result.jobsFailed++;
      logger.error(`Job ${job.id} failed`, { error });
    } finally {
      runningJobs.delete(job.id);
    }
  });

  // Wait for all started jobs to complete
  await Promise.allSettled(jobPromises);

  logger.info('Generation processor complete', result);
  return result;
}

async function autoQueueDiscoveredPosts(): Promise<number> {
  // Get pending posts to consider
  const pendingPosts = await db.query.discoveredPosts.findMany({
    where: eq(discoveredPosts.status, 'pending'),
    orderBy: [desc(discoveredPosts.painScore)],
    limit: 20, // Consider top 20 by pain score
  });

  if (pendingPosts.length === 0) {
    logger.info('No pending posts to consider');
    return 0;
  }

  // Get recently published articles to avoid similar topics
  const recentArticles = await db.query.content.findMany({
    orderBy: [desc(content.createdAt)],
    limit: 10,
  });

  const recentTitles = recentArticles.map(a => a.title);

  // Have LLM select the best 1-2 topics
  const prompt = `You are selecting topics for an observability blog (o11y.tips).

RECENTLY PUBLISHED ARTICLES (avoid similar topics):
${recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

CANDIDATE TOPICS (with pain scores):
${pendingPosts.map((p, i) => `${i + 1}. [ID: ${p.id}] (score: ${p.painScore}) "${p.title}"`).join('\n')}

Select the BEST 1-2 topics to write about next. Consider:
- Avoid topics too similar to recently published articles
- Prefer specific, actionable pain points over generic ones
- Prefer topics with higher pain scores
- Ensure variety in the content

Respond with JSON:
{
  "selectedIds": ["<id1>", "<id2>"],
  "reasoning": "<brief explanation of why these were chosen>"
}

If none of the candidates are good enough, return empty selectedIds array.`;

  try {
    const response = await generateJSON<{ selectedIds: string[]; reasoning: string }>(prompt, {
      model: 'gemini-flash',
      temperature: 0.3,
    });

    const { selectedIds, reasoning } = response.content;

    logger.info('LLM topic selection', { selectedIds, reasoning });

    if (!selectedIds || selectedIds.length === 0) {
      logger.info('LLM decided no topics are good enough to queue');
      return 0;
    }

    let queued = 0;
    for (const postId of selectedIds.slice(0, 2)) { // Max 2
      // Verify the post exists and is pending
      const post = pendingPosts.find(p => p.id === postId);
      if (!post) {
        logger.warn(`Selected post ${postId} not found in pending posts`);
        continue;
      }

      try {
        await createGenerationJob(postId);
        queued++;
        logger.info(`LLM-selected post queued`, { postId, title: post.title, painScore: post.painScore });
      } catch (error) {
        logger.warn(`Failed to queue post ${postId}`, { error });
      }
    }

    return queued;
  } catch (error) {
    logger.error('LLM topic selection failed', { error });
    return 0;
  }
}

export function getRunningJobsCount(): number {
  return runningJobs.size;
}

export function isJobRunning(jobId: string): boolean {
  return runningJobs.has(jobId);
}
