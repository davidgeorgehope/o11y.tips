import { marked } from 'marked';
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { db, content, images, niches } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('publisher:builder');

export interface BuildResult {
  success: boolean;
  outputPath: string;
  url: string;
  errors: string[];
}

export async function buildArticle(contentId: string): Promise<BuildResult> {
  logger.info('Building article', { contentId });

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

  // Get images
  const articleImages = await db.query.images.findMany({
    where: eq(images.contentId, contentId),
  });

  // Parse markdown to HTML
  const htmlContent = await marked.parse(article.content);

  // Parse components metadata (needed for both mounting script and type reconciliation)
  let parsedComponents: Array<{ type: string; name: string }> = [];
  if (article.components) {
    try {
      parsedComponents = JSON.parse(article.components as string);
    } catch {
      logger.warn('Failed to parse components JSON', { contentId });
    }
  }

  // Build component script (React CDN + bundle + mounting) if needed
  let componentScript = '';
  if (parsedComponents.length > 0 && article.componentBundle) {

    // Generate mounting script for these components
    const mountingScript = generateMountingScriptForArticle(parsedComponents);

    // Combine: React CDN + component bundle + mounting script
    componentScript = `
<!-- React CDN -->
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<!-- Component Bundle -->
<script>
${article.componentBundle}
</script>
<!-- Component Mounting -->
<script>
${mountingScript}
</script>`;
  }

  // Load template
  const templatePath = join(config.paths.templates, 'article.html');
  let template: string;

  if (existsSync(templatePath)) {
    template = await readFile(templatePath, 'utf-8');
  } else {
    template = getDefaultTemplate();
  }

  // Find hero image
  const heroImage = articleImages.find(img => img.type === 'hero');

  // Format date for display
  const publishedDate = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const publishedIso = article.publishedAt || new Date().toISOString();

  // Hero image URLs
  const heroImagePath = heroImage ? `/output/images/${niche.slug}/${heroImage.filename}` : '';
  const heroImageOg = heroImage ? `${config.output.publicUrl}/output/images/${niche.slug}/${heroImage.filename}` : '';

  // Replace component placeholders with mountable divs, reconciling types with actual components
  let contentWithMounts = htmlContent.replace(
    /\{\{COMPONENT:([^:]+):([^}]+)\}\}/g,
    '<div class="component-mount my-8 p-4 bg-gray-50 rounded-lg border border-gray-200" data-component-type="$1" data-component-id="$2"></div>'
  );

  // Reconcile mount point types with actual component types
  // The content LLM may use different type names than the outline's interactiveComponents
  if (parsedComponents.length > 0) {
    const mountTypeRegex = /data-component-type="([^"]+)"/g;
    const mountTypes = new Set<string>();
    let m;
    while ((m = mountTypeRegex.exec(contentWithMounts)) !== null) {
      mountTypes.add(m[1]);
    }
    const componentTypes = new Set(parsedComponents.map(c => c.type));

    // Find unmatched mount points and unmatched components
    const unmatchedMounts = [...mountTypes].filter(t => !componentTypes.has(t));
    const unmatchedComponents = [...componentTypes].filter(t => !mountTypes.has(t));

    // If we have equal unmatched on both sides, remap mount points to component types
    if (unmatchedMounts.length > 0 && unmatchedMounts.length === unmatchedComponents.length) {
      logger.info('Reconciling component type mismatches', {
        unmatchedMounts,
        unmatchedComponents,
      });
      for (let i = 0; i < unmatchedMounts.length; i++) {
        contentWithMounts = contentWithMounts.replace(
          `data-component-type="${unmatchedMounts[i]}"`,
          `data-component-type="${unmatchedComponents[i]}"`
        );
      }
    }
  }

  // Generate structured data schemas
  const schemaMarkup = generateArticleSchemas({
    title: article.title,
    description: article.description || '',
    publishedIso,
    canonicalUrl: `${config.output.publicUrl}/${niche.slug}/${article.slug}`,
    ogImage: heroImageOg,
    nicheName: niche.name,
    nicheSlug: niche.slug,
    htmlContent: contentWithMounts,
  });

  // Build the final HTML with all replacements (use replaceAll for multiple occurrences)
  let html = template
    .replaceAll('{{TITLE}}', escapeHtml(article.title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(article.description || ''))
    .replaceAll('{{CONTENT}}', contentWithMounts)
    .replaceAll('{{NICHE_NAME}}', escapeHtml(niche.name))
    .replaceAll('{{NICHE_SLUG}}', niche.slug)
    .replaceAll('{{PUBLISHED_DATE}}', publishedDate)
    .replaceAll('{{PUBLISHED_ISO}}', publishedIso)
    .replaceAll('{{HERO_IMAGE}}', heroImagePath)
    .replaceAll('{{HERO_ALT}}', escapeHtml(heroImage?.altText || article.title))
    .replaceAll('{{COMPONENT_SCRIPT}}', componentScript)
    .replaceAll('{{CANONICAL_URL}}', `${config.output.publicUrl}/${niche.slug}/${article.slug}`)
    .replaceAll('{{OG_IMAGE}}', heroImageOg)
    .replaceAll('{{AUTHOR_NAME}}', escapeHtml(config.author.name))
    .replaceAll('{{AUTHOR_BIO}}', escapeHtml(config.author.bio))
    .replaceAll('{{AUTHOR_LINKEDIN}}', config.author.linkedin)
    .replaceAll('{{AUTHOR_TWITTER}}', config.author.twitter)
    .replaceAll('{{YEAR}}', new Date().getFullYear().toString())
    .replaceAll('{{SCHEMA_MARKUP}}', schemaMarkup);

  // Handle conditional blocks: {{#if VAR}}...{{/if}}
  // If hero image exists, keep the content; otherwise remove the block
  if (heroImage) {
    html = html.replace(/\{\{#if HERO_IMAGE\}\}/g, '').replace(/\{\{\/if\}\}/g, '');
  } else {
    html = html.replace(/\{\{#if HERO_IMAGE\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  // Create output directory
  const outputDir = join(config.paths.output, niche.slug);
  await mkdir(outputDir, { recursive: true });

  // Write HTML file
  const outputPath = join(outputDir, `${article.slug}.html`);
  await writeFile(outputPath, html);

  // Copy images
  const imagesDir = join(config.paths.output, 'images', niche.slug);
  await mkdir(imagesDir, { recursive: true });

  for (const img of articleImages) {
    if (img.filePath && existsSync(img.filePath)) {
      const destPath = join(imagesDir, img.filename!);
      await copyFile(img.filePath, destPath);
    }
  }

  const url = `${config.output.publicUrl}/${niche.slug}/${article.slug}`;

  logger.info('Article built successfully', { outputPath, url });

  return {
    success: errors.length === 0,
    outputPath,
    url,
    errors,
  };
}

export async function bundleComponentsForArticle(componentCode: string): Promise<string> {
  try {
    const result = await esbuild.build({
      stdin: {
        contents: componentCode,
        loader: 'tsx',
      },
      bundle: true,
      format: 'esm',
      target: 'es2020',
      minify: true,
      write: false,
      jsx: 'automatic',
      external: ['react', 'react-dom'],
    });

    return result.outputFiles[0].text;
  } catch (error) {
    logger.error('Failed to bundle components', { error });
    return '';
  }
}

function generateMountingScriptForArticle(components: Array<{ type: string; name: string }>): string {
  if (components.length === 0) {
    return '';
  }

  const mounts = components.map(c => `
    // Mount ${c.name}
    try {
      var Component = window.${c.name};
      if (!Component) {
        console.error('Component ${c.name} not found on window');
        return;
      }
      var mounts = document.querySelectorAll('[data-component-type="${c.type}"]');
      if (mounts.length > 0) {
        mounts.forEach(function(el) {
          if (el.dataset.mounted) return;
          el.dataset.mounted = 'true';
          var root = window.ReactDOM.createRoot(el);
          root.render(window.React.createElement(Component));
        });
      } else {
        // Fallback: mount to #components-root if no inline mount points
        var fallbackRoot = document.getElementById('components-root');
        if (fallbackRoot) {
          var mountDiv = document.createElement('div');
          mountDiv.className = 'component-fallback my-8 p-4 bg-gray-50 rounded-lg border border-gray-200';
          mountDiv.dataset.componentType = '${c.type}';
          fallbackRoot.appendChild(mountDiv);
          var root = window.ReactDOM.createRoot(mountDiv);
          root.render(window.React.createElement(Component));
        }
      }
    } catch (err) {
      console.error('Failed to mount ${c.name}:', err);
    }
  `).join('\n');

  return `
document.addEventListener('DOMContentLoaded', function() {
  // Add header for fallback components section if needed
  var componentsRoot = document.getElementById('components-root');
  if (componentsRoot && !componentsRoot.dataset.initialized) {
    componentsRoot.dataset.initialized = 'true';
    var header = document.createElement('h2');
    header.className = 'text-2xl font-bold text-gray-900 mt-12 mb-6';
    header.textContent = 'Interactive Learning';
    componentsRoot.parentNode.insertBefore(header, componentsRoot);
  }

  ${mounts}

  // Remove header if no components were mounted to fallback
  setTimeout(function() {
    var componentsRoot = document.getElementById('components-root');
    if (componentsRoot && componentsRoot.children.length === 0) {
      var header = componentsRoot.previousElementSibling;
      if (header && header.tagName === 'H2') {
        header.remove();
      }
    }
  }, 100);
});
`;
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

interface SchemaParams {
  title: string;
  description: string;
  publishedIso: string;
  canonicalUrl: string;
  ogImage: string;
  nicheName: string;
  nicheSlug: string;
  htmlContent: string;
}

function generateArticleSchemas(params: SchemaParams): string {
  const { title, description, publishedIso, canonicalUrl, ogImage, nicheName, nicheSlug, htmlContent } = params;

  // Article Schema
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: description,
    author: {
      '@type': 'Person',
      name: config.author.name,
      url: config.author.linkedin,
      sameAs: [
        config.author.linkedin,
        `https://twitter.com/${config.author.twitter}`,
        config.author.website,
      ],
    },
    datePublished: publishedIso,
    image: ogImage || undefined,
    publisher: {
      '@type': 'Organization',
      name: 'o11y.tips',
      url: config.output.publicUrl,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
  };

  // Breadcrumb Schema
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
        name: nicheName,
        item: `${config.output.publicUrl}/${nicheSlug}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: title,
      },
    ],
  };

  // Extract FAQ pairs from content (looks for ### headings with ? followed by content)
  const faqPairs = extractFaqPairs(htmlContent);

  let schemas = `<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>`;

  // Add FAQ Schema if FAQs were found
  if (faqPairs.length > 0) {
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqPairs.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    };
    schemas += `\n  <script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`;
  }

  return schemas;
}

function extractFaqPairs(htmlContent: string): Array<{ question: string; answer: string }> {
  const faqPairs: Array<{ question: string; answer: string }> = [];

  // Look for FAQ section in HTML (h2 or h3 with "FAQ" or "Frequently Asked")
  const faqSectionMatch = htmlContent.match(/<h[23][^>]*>.*?(?:FAQ|Frequently Asked Questions?).*?<\/h[23]>([\s\S]*?)(?=<h2|$)/i);

  if (!faqSectionMatch) return faqPairs;

  const faqSection = faqSectionMatch[1];

  // Extract Q&A pairs: h3 questions followed by paragraph answers
  const qaRegex = /<h3[^>]*>([^<]+\?)<\/h3>\s*<p>([^<]+(?:<[^>]+>[^<]*)*?)<\/p>/gi;
  let match;

  while ((match = qaRegex.exec(faqSection)) !== null) {
    const question = match[1].trim();
    // Strip HTML tags from answer
    const answer = match[2].replace(/<[^>]+>/g, '').trim();

    if (question && answer) {
      faqPairs.push({ question, answer });
    }
  }

  return faqPairs;
}

function getDefaultTemplate(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}}</title>
  <meta name="description" content="{{DESCRIPTION}}">
  <link rel="canonical" href="{{CANONICAL_URL}}">
  <link rel="icon" type="image/svg+xml" href="/output/favicon.svg">
  <meta property="og:title" content="{{TITLE}}">
  <meta property="og:description" content="{{DESCRIPTION}}">
  <meta property="og:image" content="{{OG_IMAGE}}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .prose { max-width: 65ch; }
    .prose h2 { margin-top: 2em; margin-bottom: 1em; font-size: 1.5em; font-weight: 700; }
    .prose h3 { margin-top: 1.5em; margin-bottom: 0.75em; font-size: 1.25em; font-weight: 600; }
    .prose p { margin-bottom: 1.25em; line-height: 1.75; }
    .prose pre { background: #1e293b; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 1.5em 0; }
    .prose code { font-family: ui-monospace, monospace; font-size: 0.875em; }
    .prose pre code { color: #e2e8f0; }
    .prose :not(pre) > code { background: #f1f5f9; padding: 0.2em 0.4em; border-radius: 0.25rem; }
    .prose ul, .prose ol { margin: 1em 0; padding-left: 1.5em; }
    .prose li { margin: 0.5em 0; }
    .prose blockquote { border-left: 4px solid #3b82f6; padding-left: 1em; margin: 1.5em 0; font-style: italic; }
    .prose a { color: #3b82f6; text-decoration: underline; }
    .prose img { max-width: 100%; height: auto; border-radius: 0.5rem; margin: 1.5em 0; }
  </style>
</head>
<body class="bg-gray-50 text-gray-900">
  <header class="bg-white border-b border-gray-200">
    <nav class="max-w-4xl mx-auto px-4 py-4">
      <a href="/" class="text-xl font-bold text-gray-900">{{NICHE_NAME}}</a>
    </nav>
  </header>

  <main class="max-w-4xl mx-auto px-4 py-8">
    <article>
      <header class="mb-8">
        <h1 class="text-4xl font-bold text-gray-900 mb-4">{{TITLE}}</h1>
        <p class="text-xl text-gray-600 mb-4">{{DESCRIPTION}}</p>
        <time class="text-sm text-gray-500" datetime="{{PUBLISHED_DATE}}">
          Published: {{PUBLISHED_DATE}}
        </time>
      </header>

      {{#if HERO_IMAGE}}
      <figure class="mb-8">
        <img src="{{HERO_IMAGE}}" alt="{{HERO_ALT}}" class="w-full rounded-lg shadow-lg">
      </figure>
      {{/if}}

      <div class="prose prose-lg">
        {{CONTENT}}
      </div>

      <div id="components-root"></div>
    </article>
  </main>

  <footer class="bg-gray-100 border-t border-gray-200 mt-16">
    <div class="max-w-4xl mx-auto px-4 py-8 text-center text-gray-600">
      <p>&copy; ${new Date().getFullYear()} {{NICHE_NAME}}. All rights reserved.</p>
    </div>
  </footer>

  {{COMPONENT_SCRIPT}}
</body>
</html>`;
}
