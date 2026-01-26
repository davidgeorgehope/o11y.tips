import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { db, content, niches, images } from '../../db/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('publisher:index');

interface ArticleWithImage {
  article: typeof content.$inferSelect;
  niche: typeof niches.$inferSelect | undefined;
  heroImage: typeof images.$inferSelect | null;
}

export async function generateIndexPage(): Promise<string> {
  logger.info('Generating main index page');

  // Get all active niches
  const allNiches = await db.query.niches.findMany({
    where: eq(niches.isActive, true),
  });

  // Get recent published content
  const recentContent = await db.query.content.findMany({
    where: eq(content.status, 'published'),
    orderBy: [desc(content.publishedAt)],
    limit: 10,
  });

  // Fetch hero images for all content
  const articlesWithImages: ArticleWithImage[] = await Promise.all(
    recentContent.map(async (article) => {
      const heroImage = await db.query.images.findFirst({
        where: and(
          eq(images.contentId, article.id),
          eq(images.type, 'hero'),
          eq(images.status, 'completed')
        ),
      });
      const niche = allNiches.find(n => n.id === article.nicheId);
      return { article, niche, heroImage: heroImage ?? null };
    })
  );

  const html = buildMainIndexHtml(allNiches, articlesWithImages);

  const outputPath = join(config.paths.output, 'index.html');
  await mkdir(config.paths.output, { recursive: true });
  await writeFile(outputPath, html);

  logger.info('Main index generated', { path: outputPath });
  return outputPath;
}

export async function generateNicheIndexPage(nicheId: string): Promise<string> {
  logger.info('Generating niche index page', { nicheId });

  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, nicheId),
  });

  if (!niche) {
    throw new Error(`Niche not found: ${nicheId}`);
  }

  // Get all published content for this niche
  const nicheContent = await db.query.content.findMany({
    where: eq(content.nicheId, nicheId),
    orderBy: [desc(content.publishedAt)],
  });

  const publishedContent = nicheContent.filter(c => c.status === 'published');

  // Fetch hero images for all content
  const articlesWithImages: ArticleWithImage[] = await Promise.all(
    publishedContent.map(async (article) => {
      const heroImage = await db.query.images.findFirst({
        where: and(
          eq(images.contentId, article.id),
          eq(images.type, 'hero'),
          eq(images.status, 'completed')
        ),
      });
      return { article, niche, heroImage: heroImage ?? null };
    })
  );

  const html = buildNicheIndexHtml(niche, articlesWithImages);

  const outputDir = join(config.paths.output, niche.slug);
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'index.html');
  await writeFile(outputPath, html);

  logger.info('Niche index generated', { niche: niche.slug, path: outputPath });
  return outputPath;
}

function buildMainIndexHtml(
  allNiches: Array<typeof niches.$inferSelect>,
  articles: ArticleWithImage[]
): string {
  const latestArticle = articles[0];
  const otherArticles = articles.slice(1);

  const heroSection = latestArticle ? buildHeroSection(latestArticle) : '';
  const articleGrid = otherArticles.length > 0 ? buildArticleGrid(otherArticles) : '';

  // Organization Schema for index page
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'o11y.tips',
    url: config.output.publicUrl,
    description: 'Practical observability guides for practitioners',
    sameAs: [
      config.author.linkedin,
      `https://twitter.com/${config.author.twitter}`,
    ],
    founder: {
      '@type': 'Person',
      name: config.author.name,
      url: config.author.linkedin,
    },
  };

  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'o11y.tips',
    url: config.output.publicUrl,
    description: 'Practical observability guides for practitioners',
    publisher: {
      '@type': 'Person',
      name: config.author.name,
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>o11y.tips - Practical Observability Guides</title>
  <meta name="description" content="Practical observability guides for practitioners. Learn monitoring, logging, tracing, and more.">
  <meta name="author" content="${config.author.name}">
  <link rel="canonical" href="${config.output.publicUrl}">
  <link rel="icon" type="image/svg+xml" href="/output/favicon.svg">
  <script type="application/ld+json">${JSON.stringify(organizationSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(websiteSchema)}</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#0ea5e9',
            'primary-dark': '#0284c7',
            accent: '#14b8a6',
          }
        }
      }
    }
  </script>
  <style>
    .hero-gradient {
      background: linear-gradient(135deg, #0ea5e9 0%, #14b8a6 100%);
    }
    .card-hover {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .card-hover:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 24px -8px rgba(0, 0, 0, 0.15);
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-800">
  <!-- Header -->
  <header class="bg-white border-b border-slate-200">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 class="text-4xl font-bold text-slate-900">
        <span class="text-primary">o11y</span>.tips
      </h1>
      <p class="text-slate-600 mt-2 text-lg">Practical observability guides for practitioners</p>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
    ${heroSection}
    ${articleGrid}
    ${articles.length === 0 ? '<p class="text-slate-500 text-center py-16">No articles published yet. Check back soon!</p>' : ''}
  </main>

  <!-- Footer -->
  <footer class="bg-white border-t border-slate-200 mt-16">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="flex flex-col gap-6">
        <!-- Author -->
        <div class="flex items-center justify-between pb-6 border-b border-slate-100">
          <div>
            <p class="text-sm text-slate-500 mb-1">Created by</p>
            <p class="font-semibold text-slate-900">${escapeHtml(config.author.name)}</p>
            <p class="text-sm text-slate-600">${escapeHtml(config.author.bio)}</p>
          </div>
          <div class="flex gap-3">
            <a href="${config.author.linkedin}" target="_blank" rel="noopener" class="text-slate-400 hover:text-primary transition-colors" aria-label="LinkedIn">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
            </a>
            <a href="https://twitter.com/${config.author.twitter}" target="_blank" rel="noopener" class="text-slate-400 hover:text-primary transition-colors" aria-label="Twitter">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          </div>
        </div>
        <!-- Copyright & Topics -->
        <div class="flex flex-col sm:flex-row justify-between items-center gap-4">
          <p class="text-slate-500">&copy; ${new Date().getFullYear()} o11y.tips. All rights reserved.</p>
          <div class="flex gap-6">
            ${allNiches.map(n => `<a href="/${n.slug}" class="text-slate-500 hover:text-primary transition-colors">${escapeHtml(n.name)}</a>`).join('')}
          </div>
        </div>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

function buildHeroSection(item: ArticleWithImage): string {
  const { article, niche, heroImage } = item;
  const articleUrl = `/${niche?.slug || ''}/${article.slug}`;
  const imageUrl = heroImage?.filename && niche ? `/output/images/${niche.slug}/${heroImage.filename}` : null;

  return `
    <!-- Hero Section -->
    <section class="mb-16">
      <a href="${articleUrl}" class="block group">
        <div class="bg-white rounded-2xl shadow-lg overflow-hidden card-hover">
          <div class="grid md:grid-cols-2 gap-0">
            ${imageUrl ? `
            <div class="aspect-video md:aspect-auto md:h-full bg-slate-100 overflow-hidden">
              <img
                src="${imageUrl}"
                alt="${escapeHtml(heroImage?.altText || article.title)}"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              >
            </div>
            ` : `
            <div class="aspect-video md:aspect-auto md:h-full hero-gradient flex items-center justify-center">
              <svg class="w-24 h-24 text-white/30" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </div>
            `}
            <div class="p-8 md:p-12 flex flex-col justify-center">
              ${niche ? `
              <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary/10 text-primary w-fit mb-4">
                ${escapeHtml(niche.name)}
              </span>
              ` : ''}
              <h2 class="text-2xl md:text-3xl font-bold text-slate-900 group-hover:text-primary transition-colors mb-4">
                ${escapeHtml(article.title)}
              </h2>
              <p class="text-slate-600 text-lg mb-6 line-clamp-3">
                ${escapeHtml(article.description || '')}
              </p>
              <div class="flex items-center justify-between">
                <time class="text-slate-500" datetime="${article.publishedAt}">
                  ${formatDate(article.publishedAt || '')}
                </time>
                <span class="text-primary font-medium group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                  Read article
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </a>
    </section>
  `;
}

function buildArticleGrid(articles: ArticleWithImage[]): string {
  const cards = articles.map(item => buildArticleCard(item)).join('');

  return `
    <!-- More Articles -->
    <section>
      <h2 class="text-2xl font-bold text-slate-900 mb-8">More Articles</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${cards}
      </div>
    </section>
  `;
}

function buildArticleCard(item: ArticleWithImage): string {
  const { article, niche, heroImage } = item;
  const articleUrl = `/${niche?.slug || ''}/${article.slug}`;
  const imageUrl = heroImage?.filename && niche ? `/output/images/${niche.slug}/${heroImage.filename}` : null;

  return `
    <article class="bg-white rounded-xl shadow-md overflow-hidden card-hover">
      <a href="${articleUrl}" class="block group">
        ${imageUrl ? `
        <div class="aspect-video bg-slate-100 overflow-hidden">
          <img
            src="${imageUrl}"
            alt="${escapeHtml(heroImage?.altText || article.title)}"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          >
        </div>
        ` : `
        <div class="aspect-video hero-gradient flex items-center justify-center">
          <svg class="w-12 h-12 text-white/30" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        </div>
        `}
        <div class="p-6">
          ${niche ? `
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary mb-3">
            ${escapeHtml(niche.name)}
          </span>
          ` : ''}
          <h3 class="text-lg font-semibold text-slate-900 group-hover:text-primary transition-colors mb-2 line-clamp-2">
            ${escapeHtml(article.title)}
          </h3>
          <p class="text-slate-600 text-sm mb-4 line-clamp-2">
            ${escapeHtml(article.description || '')}
          </p>
          <time class="text-slate-500 text-sm" datetime="${article.publishedAt}">
            ${formatDate(article.publishedAt || '')}
          </time>
        </div>
      </a>
    </article>
  `;
}

function buildNicheIndexHtml(
  niche: typeof niches.$inferSelect,
  articles: ArticleWithImage[]
): string {
  const latestArticle = articles[0];
  const otherArticles = articles.slice(1);

  const heroSection = latestArticle ? buildHeroSection(latestArticle) : '';
  const articleGrid = otherArticles.length > 0 ? buildArticleGrid(otherArticles) : '';

  // Breadcrumb Schema for niche page
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: config.output.publicUrl,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: niche.name,
      },
    ],
  };

  // CollectionPage Schema
  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: niche.name,
    description: niche.description || '',
    url: `${config.output.publicUrl}/${niche.slug}`,
    isPartOf: {
      '@type': 'WebSite',
      name: 'o11y.tips',
      url: config.output.publicUrl,
    },
    author: {
      '@type': 'Person',
      name: config.author.name,
      url: config.author.linkedin,
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(niche.name)} - o11y.tips</title>
  <meta name="description" content="${escapeHtml(niche.description || '')}">
  <meta name="author" content="${config.author.name}">
  <link rel="canonical" href="${config.output.publicUrl}/${niche.slug}">
  <link rel="icon" type="image/svg+xml" href="/output/favicon.svg">
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(collectionSchema)}</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#0ea5e9',
            'primary-dark': '#0284c7',
            accent: '#14b8a6',
          }
        }
      }
    }
  </script>
  <style>
    .hero-gradient {
      background: linear-gradient(135deg, #0ea5e9 0%, #14b8a6 100%);
    }
    .card-hover {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .card-hover:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 24px -8px rgba(0, 0, 0, 0.15);
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-800">
  <!-- Header -->
  <header class="bg-white border-b border-slate-200">
    <nav class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <a href="/" class="text-slate-600 hover:text-primary transition-colors inline-flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back to o11y.tips
      </a>
    </nav>
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary/10 text-primary mb-4">
        Topic
      </span>
      <h1 class="text-4xl font-bold text-slate-900">${escapeHtml(niche.name)}</h1>
      <p class="text-slate-600 mt-2 text-lg">${escapeHtml(niche.description || '')}</p>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
    ${heroSection}
    ${articleGrid}
    ${articles.length === 0 ? '<p class="text-slate-500 text-center py-16">No articles in this topic yet. Check back soon!</p>' : ''}
  </main>

  <!-- Footer -->
  <footer class="bg-white border-t border-slate-200 mt-16">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="flex flex-col gap-6">
        <!-- Author -->
        <div class="flex items-center justify-between pb-6 border-b border-slate-100">
          <div>
            <p class="text-sm text-slate-500 mb-1">Created by</p>
            <p class="font-semibold text-slate-900">${escapeHtml(config.author.name)}</p>
            <p class="text-sm text-slate-600">${escapeHtml(config.author.bio)}</p>
          </div>
          <div class="flex gap-3">
            <a href="${config.author.linkedin}" target="_blank" rel="noopener" class="text-slate-400 hover:text-primary transition-colors" aria-label="LinkedIn">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
            </a>
            <a href="https://twitter.com/${config.author.twitter}" target="_blank" rel="noopener" class="text-slate-400 hover:text-primary transition-colors" aria-label="Twitter">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          </div>
        </div>
        <!-- Copyright -->
        <div class="flex flex-col sm:flex-row justify-between items-center gap-4">
          <p class="text-slate-500">&copy; ${new Date().getFullYear()} o11y.tips. All rights reserved.</p>
          <a href="/" class="text-slate-500 hover:text-primary transition-colors">View all topics</a>
        </div>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const escapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => escapes[char]);
}

function formatDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
