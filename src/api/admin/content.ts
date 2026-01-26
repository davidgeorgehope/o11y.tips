import { Hono } from 'hono';
import { db, content, niches, images } from '../../db/index.js';
import { eq, desc, and, like, or } from 'drizzle-orm';
import { publishContent, unpublishContent, publishAsInteractive } from '../../services/publisher/deployer.js';
import { validateContent } from '../../services/quality/validator.js';

const app = new Hono();

// List content with filtering
app.get('/', async (c) => {
  const nicheId = c.req.query('nicheId');
  const status = c.req.query('status');
  const search = c.req.query('search');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const conditions = [];

  if (nicheId) {
    conditions.push(eq(content.nicheId, nicheId));
  }

  if (status) {
    conditions.push(eq(content.status, status));
  }

  if (search) {
    conditions.push(
      or(
        like(content.title, `%${search}%`),
        like(content.description, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const articles = await db.query.content.findMany({
    where: whereClause,
    orderBy: [desc(content.createdAt)],
    limit,
    offset,
  });

  // Get total count
  const allContent = await db.query.content.findMany({
    where: whereClause,
    columns: { id: true },
  });

  return c.json({
    content: articles,
    pagination: {
      total: allContent.length,
      limit,
      offset,
      hasMore: offset + articles.length < allContent.length,
    },
  });
});

// Get single content item with full details
app.get('/:id', async (c) => {
  const id = c.req.param('id');

  const article = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!article) {
    return c.json({ error: 'Content not found' }, 404);
  }

  // Get niche
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, article.nicheId),
  });

  // Get images
  const articleImages = await db.query.images.findMany({
    where: eq(images.contentId, id),
  });

  return c.json({
    ...article,
    niche,
    images: articleImages,
    components: article.components ? JSON.parse(article.components) : [],
    seoAnalysis: article.seoAnalysis ? JSON.parse(article.seoAnalysis) : null,
    slopAnalysis: article.slopAnalysis ? JSON.parse(article.slopAnalysis) : null,
  });
});

// Update content
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Content not found' }, 404);
  }

  const updates: Partial<typeof content.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.content !== undefined) updates.content = body.content;
  if (body.status !== undefined) updates.status = body.status;
  if (body.reviewNotes !== undefined) updates.reviewNotes = body.reviewNotes;

  await db.update(content)
    .set(updates)
    .where(eq(content.id, id));

  const updated = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  return c.json(updated);
});

// Approve content for publishing
app.post('/:id/approve', async (c) => {
  const id = c.req.param('id');

  const article = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!article) {
    return c.json({ error: 'Content not found' }, 404);
  }

  if (article.status !== 'review' && article.status !== 'draft') {
    return c.json({ error: `Cannot approve content with status: ${article.status}` }, 400);
  }

  await db.update(content)
    .set({
      status: 'approved',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(content.id, id));

  return c.json({ success: true });
});

// Publish content
app.post('/:id/publish', async (c) => {
  const id = c.req.param('id');

  try {
    const result = await publishContent(id);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Publish content as interactive (using Opus-powered builder)
app.post('/:id/publish-interactive', async (c) => {
  const id = c.req.param('id');

  try {
    const result = await publishAsInteractive(id);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Unpublish content
app.post('/:id/unpublish', async (c) => {
  const id = c.req.param('id');

  try {
    await unpublishContent(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Delete content
app.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const article = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!article) {
    return c.json({ error: 'Content not found' }, 404);
  }

  // Don't allow deleting published content
  if (article.status === 'published') {
    return c.json({ error: 'Cannot delete published content. Unpublish first.' }, 400);
  }

  // Delete associated images
  await db.delete(images).where(eq(images.contentId, id));

  // Delete the content
  await db.delete(content).where(eq(content.id, id));

  return c.json({ success: true });
});

// Validate content quality
app.post('/:id/validate', async (c) => {
  const id = c.req.param('id');

  const article = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!article) {
    return c.json({ error: 'Content not found' }, 404);
  }

  // Get niche for keywords
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, article.nicheId),
  });

  const keywords = niche?.keywords ? JSON.parse(niche.keywords) : [];

  const validation = await validateContent({
    title: article.title,
    description: article.description || '',
    content: article.content,
    keywords,
    components: article.components ? JSON.parse(article.components) : [],
  });

  // Store validation results
  await db.update(content)
    .set({
      seoScore: validation.seo.score,
      seoAnalysis: JSON.stringify(validation.seo.analysis),
      slopScore: validation.slop.score,
      slopAnalysis: JSON.stringify(validation.slop.analysis),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(content.id, id));

  return c.json(validation);
});

// Get content stats
app.get('/stats/summary', async (c) => {
  const nicheId = c.req.query('nicheId');

  const whereClause = nicheId ? eq(content.nicheId, nicheId) : undefined;

  const allContent = await db.query.content.findMany({
    where: whereClause,
    columns: {
      status: true,
      seoScore: true,
      slopScore: true,
    },
  });

  const stats = {
    total: allContent.length,
    byStatus: {
      draft: allContent.filter(c => c.status === 'draft').length,
      review: allContent.filter(c => c.status === 'review').length,
      approved: allContent.filter(c => c.status === 'approved').length,
      published: allContent.filter(c => c.status === 'published').length,
      archived: allContent.filter(c => c.status === 'archived').length,
    },
    avgSeoScore: allContent.filter(c => c.seoScore).length > 0
      ? allContent.reduce((sum, c) => sum + (c.seoScore || 0), 0) / allContent.filter(c => c.seoScore).length
      : 0,
    avgSlopScore: allContent.filter(c => c.slopScore).length > 0
      ? allContent.reduce((sum, c) => sum + (c.slopScore || 0), 0) / allContent.filter(c => c.slopScore).length
      : 0,
  };

  return c.json(stats);
});

export default app;
