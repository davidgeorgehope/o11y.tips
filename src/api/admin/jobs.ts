import { Hono } from 'hono';
import { db, generationJobs, discoveredPosts } from '../../db/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { createGenerationJob, runGenerationJob, retryGenerationJob } from '../../services/generation/orchestrator.js';

const app = new Hono();

// List generation jobs with filtering
app.get('/', async (c) => {
  const nicheId = c.req.query('nicheId');
  const status = c.req.query('status');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const conditions = [];

  if (nicheId) {
    conditions.push(eq(generationJobs.nicheId, nicheId));
  }

  if (status) {
    conditions.push(eq(generationJobs.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const jobs = await db.query.generationJobs.findMany({
    where: whereClause,
    orderBy: [desc(generationJobs.createdAt)],
    limit,
    offset,
  });

  // Get total count
  const allJobs = await db.query.generationJobs.findMany({
    where: whereClause,
    columns: { id: true },
  });

  return c.json({
    jobs,
    pagination: {
      total: allJobs.length,
      limit,
      offset,
      hasMore: offset + jobs.length < allJobs.length,
    },
  });
});

// Get single job
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const job = await db.query.generationJobs.findFirst({
    where: eq(generationJobs.id, id),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Get associated discovered post
  const post = await db.query.discoveredPosts.findFirst({
    where: eq(discoveredPosts.id, job.discoveredPostId),
  });

  return c.json({ ...job, discoveredPost: post });
});

// Create a new generation job from a discovered post
app.post('/', async (c) => {
  const body = await c.req.json();
  const { discoveredPostId } = body;

  if (!discoveredPostId) {
    return c.json({ error: 'discoveredPostId is required' }, 400);
  }

  try {
    const jobId = await createGenerationJob(discoveredPostId);

    const job = await db.query.generationJobs.findFirst({
      where: eq(generationJobs.id, jobId),
    });

    return c.json(job, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Start a pending job
app.post('/:id/start', async (c) => {
  const id = c.req.param('id');

  const job = await db.query.generationJobs.findFirst({
    where: eq(generationJobs.id, id),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  if (job.status !== 'pending') {
    return c.json({ error: `Cannot start job with status: ${job.status}` }, 400);
  }

  // Start the job asynchronously
  runGenerationJob(id).catch(err => {
    console.error('Job failed:', err);
  });

  return c.json({ success: true, message: 'Job started' });
});

// Retry a failed job
app.post('/:id/retry', async (c) => {
  const id = c.req.param('id');

  try {
    await retryGenerationJob(id);

    // Start the job asynchronously
    runGenerationJob(id).catch(err => {
      console.error('Job retry failed:', err);
    });

    return c.json({ success: true, message: 'Job retrying' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Cancel a job
app.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');

  const job = await db.query.generationJobs.findFirst({
    where: eq(generationJobs.id, id),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Note: This doesn't actually stop a running job, just marks it
  await db.update(generationJobs)
    .set({
      status: 'failed',
      errorMessage: 'Cancelled by user',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(generationJobs.id, id));

  return c.json({ success: true });
});

// Get job stats
app.get('/stats/summary', async (c) => {
  const nicheId = c.req.query('nicheId');

  const whereClause = nicheId ? eq(generationJobs.nicheId, nicheId) : undefined;

  const allJobs = await db.query.generationJobs.findMany({
    where: whereClause,
    columns: {
      status: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const stats = {
    total: allJobs.length,
    byStatus: {
      pending: allJobs.filter(j => j.status === 'pending').length,
      running: allJobs.filter(j => !['pending', 'completed', 'failed'].includes(j.status)).length,
      completed: allJobs.filter(j => j.status === 'completed').length,
      failed: allJobs.filter(j => j.status === 'failed').length,
    },
  };

  return c.json(stats);
});

export default app;
