import { db, generationJobs, discoveredPosts, content, images, niches } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { generateId } from '../../utils/hash.js';
import { analyzeVoice } from './voice.js';
import { conductResearch } from './research.js';
import { generateOutline } from './outline.js';
import { generateContent } from './content.js';
import { generateComponents, bundleComponents } from './components.js';
import { generateImages } from './images.js';
import type { GenerationContext } from './types.js';

const logger = createLogger('generation:orchestrator');

const STEPS = [
  'voice',
  'research',
  'outline',
  'content',
  'components',
  'images',
  'assembly',
] as const;

type StepName = typeof STEPS[number];

export async function runGenerationJob(jobId: string): Promise<void> {
  logger.info('Starting generation job', { jobId });

  const job = await db.query.generationJobs.findFirst({
    where: eq(generationJobs.id, jobId),
  });

  if (!job) {
    throw new Error(`Generation job not found: ${jobId}`);
  }

  // Get the discovered post
  const post = await db.query.discoveredPosts.findFirst({
    where: eq(discoveredPosts.id, job.discoveredPostId),
  });

  if (!post) {
    throw new Error(`Discovered post not found: ${job.discoveredPostId}`);
  }

  // Get the niche
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, job.nicheId),
  });

  if (!niche) {
    throw new Error(`Niche not found: ${job.nicheId}`);
  }

  // Build generation context
  const context: GenerationContext = {
    jobId,
    nicheId: niche.id,
    discoveredPost: {
      id: post.id,
      title: post.title,
      content: post.content,
      sourceUrl: post.sourceUrl,
      author: post.author || undefined,
      authorLevel: post.authorLevel || undefined,
      painAnalysis: post.painAnalysis || undefined,
    },
    niche: {
      name: niche.name,
      voiceGuidelines: niche.voiceGuidelines || undefined,
      targetAudience: niche.targetAudience || undefined,
      keywords: niche.keywords ? JSON.parse(niche.keywords) : [],
    },
  };

  // Update job to running
  await updateJob(jobId, {
    status: 'voice',
    currentStep: 'voice',
    progress: 0,
    startedAt: new Date().toISOString(),
  });

  try {
    // Step 1: Voice Analysis
    await updateJobStep(jobId, 'voice', 10);
    const voiceAnalysis = await analyzeVoice(context);
    await updateJob(jobId, { voiceAnalysis: JSON.stringify(voiceAnalysis) });

    // Step 2: Research
    await updateJobStep(jobId, 'research', 25);
    const research = await conductResearch(context, voiceAnalysis);
    await updateJob(jobId, { research: JSON.stringify(research) });

    // Step 3: Outline
    await updateJobStep(jobId, 'outline', 40);
    const outline = await generateOutline(context, voiceAnalysis, research);
    await updateJob(jobId, { outline: JSON.stringify(outline) });

    // Step 4: Content
    await updateJobStep(jobId, 'content', 55);
    const generatedContent = await generateContent(context, voiceAnalysis, research, outline);

    // Step 5: Components
    await updateJobStep(jobId, 'components', 70);
    const componentResult = await generateComponents(context, outline, generatedContent);
    const components = componentResult.components;
    const componentStatus = componentResult.status;
    const componentBundle = await bundleComponents(components);

    // Step 6: Images
    await updateJobStep(jobId, 'images', 85);
    const generatedImages = await generateImages(context, outline, generatedContent);

    // Step 7: Assembly - Create content record
    await updateJobStep(jobId, 'assembly', 95);

    const contentId = generateId();

    await db.insert(content).values({
      id: contentId,
      nicheId: niche.id,
      jobId,
      discoveredPostId: post.id,
      slug: outline.slug,
      title: outline.title,
      description: outline.description,
      content: generatedContent.content,
      components: JSON.stringify(components),
      componentBundle,
      componentStatus: JSON.stringify(componentStatus),
      status: 'review',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Store images
    for (const img of generatedImages) {
      await db.insert(images).values({
        id: img.id,
        contentId,
        type: img.type,
        prompt: img.prompt,
        altText: img.altText,
        filename: img.filename,
        filePath: img.filePath,
        width: img.width,
        height: img.height,
        mimeType: img.mimeType,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Update discovered post status
    await db.update(discoveredPosts)
      .set({
        status: 'completed',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(discoveredPosts.id, post.id));

    // Mark job as completed
    await updateJob(jobId, {
      status: 'completed',
      currentStep: 'completed',
      progress: 100,
      completedAt: new Date().toISOString(),
    });

    logger.info('Generation job completed', { jobId, contentId });

  } catch (error) {
    logger.error('Generation job failed', { jobId, error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    await updateJob(jobId, {
      status: 'failed',
      errorMessage,
      errorStack,
    });

    // Update discovered post status
    await db.update(discoveredPosts)
      .set({
        status: 'pending', // Allow retry
        updatedAt: new Date().toISOString(),
      })
      .where(eq(discoveredPosts.id, post.id));

    throw error;
  }
}

async function updateJob(jobId: string, updates: Partial<typeof generationJobs.$inferInsert>): Promise<void> {
  await db.update(generationJobs)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(generationJobs.id, jobId));
}

async function updateJobStep(jobId: string, step: StepName, progress: number): Promise<void> {
  logger.debug('Job step update', { jobId, step, progress });
  await updateJob(jobId, {
    status: step,
    currentStep: step,
    progress,
  });
}

export async function createGenerationJob(discoveredPostId: string): Promise<string> {
  const post = await db.query.discoveredPosts.findFirst({
    where: eq(discoveredPosts.id, discoveredPostId),
  });

  if (!post) {
    throw new Error(`Discovered post not found: ${discoveredPostId}`);
  }

  if (post.status !== 'pending' && post.status !== 'queued') {
    throw new Error(`Post is not in a valid state for generation: ${post.status}`);
  }

  const jobId = generateId();

  await db.insert(generationJobs).values({
    id: jobId,
    discoveredPostId,
    nicheId: post.nicheId,
    status: 'pending',
    progress: 0,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Update post status to queued
  await db.update(discoveredPosts)
    .set({
      status: 'queued',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(discoveredPosts.id, discoveredPostId));

  logger.info('Created generation job', { jobId, discoveredPostId });
  return jobId;
}

export async function retryGenerationJob(jobId: string): Promise<void> {
  const job = await db.query.generationJobs.findFirst({
    where: eq(generationJobs.id, jobId),
  });

  if (!job) {
    throw new Error(`Generation job not found: ${jobId}`);
  }

  if (job.status !== 'failed') {
    throw new Error(`Job is not in failed state: ${job.status}`);
  }

  await updateJob(jobId, {
    status: 'pending',
    currentStep: null,
    progress: 0,
    errorMessage: null,
    errorStack: null,
    retryCount: (job.retryCount || 0) + 1,
  });

  logger.info('Job marked for retry', { jobId, retryCount: (job.retryCount || 0) + 1 });
}
