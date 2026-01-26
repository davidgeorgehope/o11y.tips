import { Hono } from 'hono';
import { db, content, niches, images } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';

const app = new Hono();

// List all niches (public)
app.get('/niches', async (c) => {
  const allNiches = await db.query.niches.findMany({
    where: eq(niches.isActive, true),
    columns: {
      id: true,
      name: true,
      slug: true,
      description: true,
    },
  });

  return c.json(allNiches);
});

// Get niche by slug
app.get('/niches/:slug', async (c) => {
  const slug = c.req.param('slug');

  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.slug, slug), eq(niches.isActive, true)),
    columns: {
      id: true,
      name: true,
      slug: true,
      description: true,
    },
  });

  if (!niche) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  return c.json(niche);
});

// List published content for a niche
app.get('/niches/:slug/articles', async (c) => {
  const slug = c.req.param('slug');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.slug, slug), eq(niches.isActive, true)),
  });

  if (!niche) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  const articles = await db.query.content.findMany({
    where: and(eq(content.nicheId, niche.id), eq(content.status, 'published')),
    columns: {
      id: true,
      slug: true,
      title: true,
      description: true,
      publishedAt: true,
    },
    orderBy: [desc(content.publishedAt)],
    limit,
    offset,
  });

  return c.json({
    niche: {
      name: niche.name,
      slug: niche.slug,
    },
    articles,
  });
});

// Get single article by slug
app.get('/articles/:nicheSlug/:articleSlug', async (c) => {
  const nicheSlug = c.req.param('nicheSlug');
  const articleSlug = c.req.param('articleSlug');

  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.slug, nicheSlug), eq(niches.isActive, true)),
  });

  if (!niche) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  const article = await db.query.content.findFirst({
    where: and(
      eq(content.nicheId, niche.id),
      eq(content.slug, articleSlug),
      eq(content.status, 'published')
    ),
    columns: {
      id: true,
      slug: true,
      title: true,
      description: true,
      content: true,
      componentBundle: true,
      publishedAt: true,
    },
  });

  if (!article) {
    return c.json({ error: 'Article not found' }, 404);
  }

  // Get images
  const articleImages = await db.query.images.findMany({
    where: eq(images.contentId, article.id),
    columns: {
      type: true,
      filename: true,
      altText: true,
      width: true,
      height: true,
    },
  });

  return c.json({
    niche: {
      name: niche.name,
      slug: niche.slug,
    },
    article: {
      ...article,
      images: articleImages,
    },
  });
});

// Get recent articles across all niches
app.get('/articles/recent', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10');

  const articles = await db.query.content.findMany({
    where: eq(content.status, 'published'),
    columns: {
      id: true,
      nicheId: true,
      slug: true,
      title: true,
      description: true,
      publishedAt: true,
    },
    orderBy: [desc(content.publishedAt)],
    limit,
  });

  // Get niche info for each article
  const allNiches = await db.query.niches.findMany({
    where: eq(niches.isActive, true),
    columns: {
      id: true,
      name: true,
      slug: true,
    },
  });

  const nicheMap = new Map(allNiches.map(n => [n.id, n]));

  const articlesWithNiche = articles.map(article => ({
    ...article,
    niche: nicheMap.get(article.nicheId),
  }));

  return c.json(articlesWithNiche);
});

export default app;
