import { db, content, niches, images } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { mkdir, writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { buildArticle, type BuildResult } from './builder.js';
import { generateSitemap, generateRobotsTxt } from './sitemap.js';
import { generateIndexPage, generateNicheIndexPage } from './index-generator.js';
import { validateContent, autoFixContent } from '../quality/validator.js';
import { buildInteractiveArticle, type InteractiveBuildResult } from '../generation/interactive-builder.js';

const logger = createLogger('publisher:deployer');

export interface DeployResult {
  success: boolean;
  published: string[];
  failed: Array<{ contentId: string; error: string }>;
  sitemap: string;
}

export async function publishContent(contentId: string): Promise<BuildResult> {
  logger.info('Publishing content', { contentId });

  // Get content record
  const article = await db.query.content.findFirst({
    where: eq(content.id, contentId),
  });

  if (!article) {
    throw new Error(`Content not found: ${contentId}`);
  }

  if (article.status !== 'approved' && article.status !== 'review') {
    throw new Error(`Content is not ready for publishing: ${article.status}`);
  }

  // Get niche for keywords
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, article.nicheId),
  });

  // Keywords may be JSON array or comma-separated string
  let keywords: string[] = [];
  if (niche?.keywords) {
    try {
      const parsed = JSON.parse(niche.keywords);
      keywords = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Not JSON, treat as comma-separated string
      keywords = niche.keywords.split(',').map(k => k.trim()).filter(Boolean);
    }
  }

  // Run validation and store scores before publishing
  logger.info('Running quality validation', { contentId });

  let articleContent = article.content;
  const contentInput = {
    title: article.title,
    description: article.description || '',
    content: articleContent,
    keywords,
    components: article.components ? JSON.parse(article.components) : [],
  };

  let validation = await validateContent(contentInput);

  // Auto-fix slop if score is too high
  if (!validation.slop.passed) {
    logger.info('Slop score too high, auto-fixing', {
      score: validation.slop.score,
      threshold: 5
    });

    const { content: fixedContent, fixes } = await autoFixContent(contentInput);

    if (fixes.length > 0) {
      logger.info('Content auto-fixed', { fixes });
      articleContent = fixedContent;

      // Update article content in DB
      await db.update(content)
        .set({ content: fixedContent, updatedAt: new Date().toISOString() })
        .where(eq(content.id, contentId));

      // Re-validate after fix
      validation = await validateContent({
        ...contentInput,
        content: fixedContent,
      });
    }
  }

  // Store validation results
  await db.update(content)
    .set({
      seoScore: validation.seo.score,
      seoAnalysis: JSON.stringify(validation.seo.analysis),
      slopScore: validation.slop.score,
      slopAnalysis: JSON.stringify(validation.slop.analysis),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(content.id, contentId));

  logger.info('Validation complete', {
    contentId,
    seoScore: validation.seo.score,
    slopScore: validation.slop.score,
    isValid: validation.isValid,
  });

  // Build the article
  const result = await buildArticle(contentId);

  if (result.success) {
    // Update content status
    await db.update(content)
      .set({
        status: 'published',
        publishedAt: new Date().toISOString(),
        publishedUrl: result.url,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(content.id, contentId));

    // Regenerate sitemap
    await generateSitemap();

    // Regenerate index pages to include new article
    await generateIndexPage();
    if (niche) {
      await generateNicheIndexPage(niche.id);
    }

    logger.info('Content published successfully', { contentId, url: result.url });
  }

  return result;
}

export interface InteractivePublishResult {
  success: boolean;
  outputPath: string;
  url: string;
  componentsUsed: string[];
  errors: string[];
}

export async function publishAsInteractive(contentId: string): Promise<InteractivePublishResult> {
  logger.info('Publishing content as interactive', { contentId });

  const errors: string[] = [];

  // Get content record
  const article = await db.query.content.findFirst({
    where: eq(content.id, contentId),
  });

  if (!article) {
    throw new Error(`Content not found: ${contentId}`);
  }

  // Get niche
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, article.nicheId),
  });

  if (!niche) {
    throw new Error(`Niche not found: ${article.nicheId}`);
  }

  // Get hero image if exists
  const articleImages = await db.query.images.findMany({
    where: eq(images.contentId, contentId),
  });
  const heroImage = articleImages.find((img) => img.type === 'hero');

  // Build interactive HTML using Opus
  let result: InteractiveBuildResult;
  try {
    result = await buildInteractiveArticle({
      markdown: article.content,
      title: article.title,
      description: article.description || '',
      niche: { name: niche.name, slug: niche.slug },
      heroImage: heroImage
        ? {
            path: `/output/images/${niche.slug}/${heroImage.filename}`,
            alt: heroImage.altText || article.title,
          }
        : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to build interactive article', { contentId, error: message });
    throw new Error(`Failed to build interactive article: ${message}`);
  }

  // Create output directory
  const outputDir = join(config.paths.output, niche.slug);
  await mkdir(outputDir, { recursive: true });

  // Copy images to output folder
  const imagesDir = join(config.paths.output, 'images', niche.slug);
  await mkdir(imagesDir, { recursive: true });

  for (const img of articleImages) {
    if (img.filePath && existsSync(img.filePath)) {
      const destPath = join(imagesDir, img.filename!);
      await copyFile(img.filePath, destPath);
      logger.debug('Copied image', { source: img.filePath, dest: destPath });
    }
  }

  // Write HTML file
  const outputPath = join(outputDir, `${article.slug}.html`);
  await writeFile(outputPath, result.html);

  const url = `${config.output.publicUrl}/${niche.slug}/${article.slug}`;

  // Update content status and metadata
  await db.update(content)
    .set({
      status: 'published',
      publishedAt: new Date().toISOString(),
      publishedUrl: url,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(content.id, contentId));

  // Regenerate sitemap and index pages
  await generateSitemap();
  await generateIndexPage();
  await generateNicheIndexPage(niche.id);

  logger.info('Interactive content published successfully', {
    contentId,
    url,
    componentsUsed: result.componentsUsed,
  });

  return {
    success: true,
    outputPath,
    url,
    componentsUsed: result.componentsUsed,
    errors,
  };
}

export async function publishAllApproved(): Promise<DeployResult> {
  logger.info('Publishing all approved content');

  // Get all approved content
  const approvedContent = await db.query.content.findMany({
    where: eq(content.status, 'approved'),
  });

  const published: string[] = [];
  const failed: Array<{ contentId: string; error: string }> = [];

  for (const article of approvedContent) {
    try {
      const result = await publishContent(article.id);
      if (result.success) {
        published.push(article.id);
      } else {
        failed.push({ contentId: article.id, error: result.errors.join(', ') });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      failed.push({ contentId: article.id, error: message });
      logger.error('Failed to publish content', { contentId: article.id, error });
    }
  }

  // Generate index pages
  await generateIndexPage();
  const allNiches = await db.query.niches.findMany({
    where: eq(niches.isActive, true),
  });
  for (const niche of allNiches) {
    await generateNicheIndexPage(niche.id);
  }

  // Generate sitemap and robots.txt
  const sitemapPath = await generateSitemap();
  await generateRobotsTxt();

  logger.info('Publishing complete', { published: published.length, failed: failed.length });

  return {
    success: failed.length === 0,
    published,
    failed,
    sitemap: sitemapPath,
  };
}

export async function unpublishContent(contentId: string): Promise<void> {
  logger.info('Unpublishing content', { contentId });

  await db.update(content)
    .set({
      status: 'archived',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(content.id, contentId));

  // Regenerate sitemap
  await generateSitemap();

  logger.info('Content unpublished', { contentId });
}

export async function rebuildAll(): Promise<DeployResult> {
  logger.info('Rebuilding all published content');

  // Get all published content
  const publishedContent = await db.query.content.findMany({
    where: eq(content.status, 'published'),
  });

  const published: string[] = [];
  const failed: Array<{ contentId: string; error: string }> = [];

  for (const article of publishedContent) {
    try {
      const result = await buildArticle(article.id);
      if (result.success) {
        published.push(article.id);
      } else {
        failed.push({ contentId: article.id, error: result.errors.join(', ') });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      failed.push({ contentId: article.id, error: message });
    }
  }

  // Generate index pages
  await generateIndexPage();
  const allNiches = await db.query.niches.findMany({
    where: eq(niches.isActive, true),
  });
  for (const niche of allNiches) {
    await generateNicheIndexPage(niche.id);
  }

  // Generate sitemap
  const sitemapPath = await generateSitemap();
  await generateRobotsTxt();

  logger.info('Rebuild complete', { rebuilt: published.length, failed: failed.length });

  return {
    success: failed.length === 0,
    published,
    failed,
    sitemap: sitemapPath,
  };
}
