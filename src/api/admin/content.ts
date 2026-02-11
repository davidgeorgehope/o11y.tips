import { Hono } from 'hono';
import { db, content, niches, images, generationJobs } from '../../db/index.js';
import { eq, desc, and, like, or } from 'drizzle-orm';
import { generateId, slugify } from '../../utils/hash.js';
import { publishContent, unpublishContent, publishAsInteractive } from '../../services/publisher/deployer.js';
import { buildArticle } from '../../services/publisher/builder.js';
import { generateIndexPage, generateNicheIndexPage } from '../../services/publisher/index-generator.js';
import { validateContent } from '../../services/quality/validator.js';
import { generateWithClaude } from '../../services/ai/clients.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('api:admin:content');
import { generateComponentWithRetry, bundleComponents, type ComponentGenerationResult } from '../../services/generation/components.js';
import { marked } from 'marked';
import type { GenerationContext, GeneratedContent, ContentOutline } from '../../services/generation/types.js';

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

// Create new content manually
app.post('/', async (c) => {
  const body = await c.req.json();
  const { nicheId, title, slug: rawSlug, description, content: markdownContent } = body;

  if (!nicheId || !title || !markdownContent) {
    return c.json({ error: 'nicheId, title, and content are required' }, 400);
  }

  // Verify niche exists
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, nicheId),
  });
  if (!niche) {
    return c.json({ error: 'Niche not found' }, 404);
  }

  const slug = rawSlug ? slugify(rawSlug) : slugify(title);

  // Check slug uniqueness within niche
  const existing = await db.query.content.findFirst({
    where: and(eq(content.nicheId, nicheId), eq(content.slug, slug)),
  });
  if (existing) {
    return c.json({ error: `Slug "${slug}" already exists in this niche` }, 409);
  }

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(content).values({
    id,
    nicheId,
    slug,
    title,
    description: description || null,
    content: markdownContent,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  return c.json(created, 201);
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

  // If article is already published, rebuild the static HTML so the live site updates
  if (existing.status === 'published') {
    try {
      await buildArticle(id);
      // Regenerate index pages in case title/description changed
      await generateNicheIndexPage(existing.nicheId);
      await generateIndexPage();
      logger.info('Rebuilt published article after save', { id, title: existing.title });
    } catch (err) {
      logger.error('Failed to rebuild published article after save', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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

// Get content preview with rendered HTML and component status
app.get('/:id/preview', async (c) => {
  const id = c.req.param('id');

  const article = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!article) {
    return c.json({ error: 'Content not found' }, 404);
  }

  // Parse component status
  const componentStatus: ComponentGenerationResult[] | null = article.componentStatus
    ? JSON.parse(article.componentStatus)
    : null;

  // Convert markdown to HTML
  let html = await marked.parse(article.content);

  // Replace component placeholders with status indicators
  if (componentStatus) {
    for (const status of componentStatus) {
      const placeholderRegex = new RegExp("<!--\\s*component:\\s*" + status.spec.type + "\\s*-->", "gi");

      if (status.success) {
        const replacement = '<div class="component-placeholder component-success" data-type="' + status.spec.type + '">' +
          '<div class="component-badge success">Component: ' + status.spec.type + '</div>' +
          '<div class="component-info">Purpose: ' + status.spec.purpose + '</div>' +
          '</div>';
        html = html.replace(placeholderRegex, replacement);
      } else {
        const replacement = '<div class="component-placeholder component-failed" data-type="' + status.spec.type + '">' +
          '<div class="component-badge failed">Failed: ' + status.spec.type + '</div>' +
          '<div class="component-info">Error: ' + (status.error || 'Unknown error') + '</div>' +
          '</div>';
        html = html.replace(placeholderRegex, replacement);
      }
    }
  }

  return c.json({
    html,
    componentStatus,
  });
});

// Regenerate a single component
app.post('/:id/components/regenerate', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { componentType } = body;

  if (!componentType) {
    return c.json({ error: 'componentType is required' }, 400);
  }

  const article = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!article) {
    return c.json({ error: 'Content not found' }, 404);
  }

  // Get the job to retrieve the original outline
  if (!article.jobId) {
    return c.json({ error: 'No job associated with this content - cannot retrieve component spec' }, 400);
  }

  const job = await db.query.generationJobs.findFirst({
    where: eq(generationJobs.id, article.jobId),
  });

  if (!job || !job.outline) {
    return c.json({ error: 'Job outline not found - cannot regenerate component' }, 400);
  }

  const outline: ContentOutline = JSON.parse(job.outline);
  const componentSpec = outline.interactiveComponents.find(c => c.type === componentType);

  if (!componentSpec) {
    return c.json({ error: 'Component spec not found in outline for type: ' + componentType }, 400);
  }

  // Get niche for context
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, article.nicheId),
  });

  if (!niche) {
    return c.json({ error: 'Niche not found' }, 400);
  }

  // Build generation context
  const context: GenerationContext = {
    jobId: article.jobId,
    nicheId: article.nicheId,
    discoveredPost: {
      id: article.discoveredPostId || '',
      title: article.title,
      content: article.content,
      sourceUrl: '',
    },
    niche: {
      name: niche.name,
      voiceGuidelines: niche.voiceGuidelines || undefined,
      targetAudience: niche.targetAudience || undefined,
      keywords: niche.keywords ? JSON.parse(niche.keywords) : [],
    },
  };

  const generatedContent: GeneratedContent = {
    title: article.title,
    slug: article.slug,
    description: article.description || '',
    content: article.content,
    sections: [],
  };

  try {
    // Generate the component
    const result = await generateComponentWithRetry(context, componentSpec, generatedContent);

    // Parse existing components and status
    const components = article.components ? JSON.parse(article.components) : [];
    const componentStatus: ComponentGenerationResult[] = article.componentStatus
      ? JSON.parse(article.componentStatus)
      : [];

    if (result.success && result.component) {
      // Update components array - replace existing or add new
      const existingIndex = components.findIndex((c: { type: string }) => c.type === componentType);
      if (existingIndex >= 0) {
        components[existingIndex] = result.component;
      } else {
        components.push(result.component);
      }

      // Rebundle components
      const componentBundle = await bundleComponents(components);

      // Update component status
      const statusIndex = componentStatus.findIndex(s => s.spec.type === componentType);
      if (statusIndex >= 0) {
        componentStatus[statusIndex] = result;
      } else {
        componentStatus.push(result);
      }

      // Save to database
      await db.update(content)
        .set({
          components: JSON.stringify(components),
          componentBundle,
          componentStatus: JSON.stringify(componentStatus),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(content.id, id));

      return c.json({
        success: true,
        component: result.component,
        status: result,
      });
    } else {
      // Update status with failure
      const statusIndex = componentStatus.findIndex(s => s.spec.type === componentType);
      if (statusIndex >= 0) {
        componentStatus[statusIndex] = result;
      } else {
        componentStatus.push(result);
      }

      await db.update(content)
        .set({
          componentStatus: JSON.stringify(componentStatus),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(content.id, id));

      return c.json({
        success: false,
        error: result.error,
        status: result,
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Component regeneration failed: ' + errorMsg }, 500);
  }
});

// Chat with LLM for content editing
app.post('/:id/chat', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { message, currentContent, conversationHistory = [], includePreview = false } = body;

  if (!message) {
    return c.json({ error: 'Message is required' }, 400);
  }

  const article = await db.query.content.findFirst({
    where: eq(content.id, id),
  });

  if (!article) {
    return c.json({ error: 'Content not found' }, 404);
  }

  // Build preview context if requested
  let previewContext = '';
  if (includePreview) {
    const componentStatus: ComponentGenerationResult[] | null = article.componentStatus
      ? JSON.parse(article.componentStatus)
      : null;

    const renderedHtml = await marked.parse(currentContent || article.content);

    previewContext = '\n\nPREVIEW CONTEXT (rendered HTML and component status):\n';
    previewContext += '--- Rendered HTML Preview ---\n';
    previewContext += renderedHtml.substring(0, 3000); // Limit HTML size
    if (renderedHtml.length > 3000) {
      previewContext += '\n... (truncated)\n';
    }

    if (componentStatus && componentStatus.length > 0) {
      previewContext += '\n\n--- Component Status ---\n';
      for (const status of componentStatus) {
        previewContext += 'Component: ' + status.spec.type + '\n';
        previewContext += '  Status: ' + (status.success ? 'SUCCESS' : 'FAILED') + '\n';
        previewContext += '  Purpose: ' + status.spec.purpose + '\n';
        if (!status.success && status.error) {
          previewContext += '  Error: ' + status.error + '\n';
        }
        previewContext += '  Attempts: ' + status.attempts + '\n\n';
      }
    }
  }

  let systemPrompt = "You are a technical content editor helping to improve observability and technical articles.\n\nYour role:\n- Help the user refine, edit, and improve their article content\n- Make changes that maintain technical accuracy and a professional, direct writing style\n- Remove AI-generated \"slop\" patterns: unnecessary filler words, hedging language, buzzwords, and overwrought phrases";

  if (includePreview) {
    systemPrompt += "\n- Diagnose rendering or formatting issues based on the HTML preview\n- Identify and explain component generation failures";
  }

  systemPrompt += "\n\nAvoid these patterns:\n- Hedging: \"It's worth noting that\", \"It's important to understand\", \"Keep in mind that\"\n- Filler: \"In today's world\", \"As we know\", \"needless to say\"\n- Buzzwords: \"leverage\", \"utilize\", \"paradigm\", \"synergy\", \"game-changer\"\n- Overwrought: \"dive deep\", \"journey\", \"landscape\", \"unlock\", \"empower\"\n- Unnecessary transitions: \"Furthermore\", \"Moreover\", \"Additionally\" (when not needed)\n\nWriting style guidelines:\n- Be direct and concise\n- Use active voice\n- Prefer concrete examples over abstract statements\n- Maintain technical accuracy\n- Keep the reader engaged without being flashy\n\nResponse format:\nAlways structure your response with these XML-like tags:\n\n<explanation>\nBrief explanation of what changes you're making and why (2-3 sentences max)\n</explanation>\n\n<diff>\nShow the key changes in a readable diff format:\n- OLD: [original text snippet]\n+ NEW: [revised text snippet]\n(Only show the most significant changes, not every minor edit)\n</diff>\n\n<content>\nThe complete updated markdown content\n</content>\n\nIf the user's request doesn't require content changes (e.g., they're asking a question), omit the <diff> and <content> tags and just provide your response in <explanation>.";

  // Build the conversation prompt
  let conversationPrompt = '';
  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      conversationPrompt += 'User: ' + msg.content + '\n\n';
    } else {
      conversationPrompt += 'Assistant: ' + msg.content + '\n\n';
    }
  }

  const userPrompt = 'Article Title: ' + article.title + '\n\nCurrent Content:\n```markdown\n' + (currentContent || article.content) + '\n```' + previewContext + '\n\n' + conversationPrompt + 'User request: ' + message;

  try {
    const response = await generateWithClaude(userPrompt, {
      systemPrompt,
      maxTokens: 8192,
      temperature: 0.7,
    });

    // Parse the response to extract parts
    const explanationMatch = response.content.match(/<explanation>([\s\S]*?)<\/explanation>/);
    const diffMatch = response.content.match(/<diff>([\s\S]*?)<\/diff>/);
    const contentMatch = response.content.match(/<content>([\s\S]*?)<\/content>/);

    return c.json({
      response: response.content,
      explanation: explanationMatch ? explanationMatch[1].trim() : null,
      diff: diffMatch ? diffMatch[1].trim() : null,
      updatedContent: contentMatch ? contentMatch[1].trim() : null,
      usage: response.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: `Chat failed: ${message}` }, 500);
  }
});

export default app;
