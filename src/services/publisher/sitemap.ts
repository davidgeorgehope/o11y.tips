import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { db, content, niches } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('publisher:sitemap');

export interface SitemapEntry {
  loc: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

export async function generateSitemap(): Promise<string> {
  logger.info('Generating sitemap');

  const entries: SitemapEntry[] = [];

  // Add homepage
  entries.push({
    loc: config.output.publicUrl,
    lastmod: new Date().toISOString(),
    changefreq: 'daily',
    priority: 1.0,
  });

  // Add all niches
  const allNiches = await db.query.niches.findMany({
    where: eq(niches.isActive, true),
  });

  for (const niche of allNiches) {
    entries.push({
      loc: `${config.output.publicUrl}/${niche.slug}`,
      lastmod: niche.updatedAt,
      changefreq: 'weekly',
      priority: 0.8,
    });
  }

  // Add all published content
  const publishedContent = await db.query.content.findMany({
    where: eq(content.status, 'published'),
  });

  for (const article of publishedContent) {
    const niche = allNiches.find(n => n.id === article.nicheId);
    if (!niche) continue;

    entries.push({
      loc: `${config.output.publicUrl}/${niche.slug}/${article.slug}`,
      lastmod: article.publishedAt || article.updatedAt,
      changefreq: 'monthly',
      priority: 0.6,
    });
  }

  // Generate XML
  const xml = buildSitemapXml(entries);

  // Write sitemap
  const outputPath = join(config.paths.output, 'sitemap.xml');
  await mkdir(config.paths.output, { recursive: true });
  await writeFile(outputPath, xml);

  logger.info('Sitemap generated', { entries: entries.length, path: outputPath });

  return outputPath;
}

export async function generateRobotsTxt(): Promise<string> {
  logger.info('Generating robots.txt');

  const robotsTxt = `User-agent: *
Allow: /

Sitemap: ${config.output.publicUrl}/sitemap.xml
`;

  const outputPath = join(config.paths.output, 'robots.txt');
  await writeFile(outputPath, robotsTxt);

  logger.info('robots.txt generated', { path: outputPath });

  return outputPath;
}

function buildSitemapXml(entries: SitemapEntry[]): string {
  const urlEntries = entries.map(entry => `
  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod.split('T')[0]}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority.toFixed(1)}</priority>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

function escapeXml(text: string): string {
  const escapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return text.replace(/[&<>"']/g, char => escapes[char]);
}
