import { generateWithClaude } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('generation:interactive-builder');

export interface InteractiveBuildInput {
  markdown: string;
  title: string;
  description: string;
  niche: { name: string; slug: string };
  heroImage?: { path: string; alt: string };
}

export interface InteractiveBuildResult {
  html: string;
  componentsUsed: string[];
}

const SYSTEM_PROMPT = `You are an expert web developer creating interactive educational articles. You transform markdown content into complete, self-contained HTML pages with Preact-powered interactive elements naturally embedded in the content flow.

You excel at:
- Converting markdown to semantic, accessible HTML
- Identifying opportunities for interactivity that enhance learning
- Writing clean, efficient Preact components using htm (hyperscript tagged markup)
- Creating responsive, mobile-first designs
- Ensuring all code works offline after CDN loads

Your interactive components use the Preact/htm pattern:
const { h, render } = preact;
const { useState, useEffect } = preactHooks;
const html = htm.bind(h);

function MyComponent() {
  const [state, setState] = useState(initialValue);
  return html\`<div>...</div>\`;
}
render(html\`<\${MyComponent}/>\`, document.getElementById('mount-id'));`;

function buildPrompt(input: InteractiveBuildInput): string {
  const heroImageSection = input.heroImage
    ? `
HERO IMAGE:
- Path: ${input.heroImage.path}
- Alt text: ${input.heroImage.alt}`
    : '';

  return `Transform this markdown into a complete, self-contained HTML page with 2-4 interactive elements sprinkled naturally throughout the content.

INPUT MARKDOWN:
${input.markdown}

ARTICLE METADATA:
- Title: ${input.title}
- Description: ${input.description}
- Topic: ${input.niche.name}
- Topic Slug: ${input.niche.slug}${heroImageSection}

INTERACTIVE ELEMENTS:
Add 2-4 interactive Preact components wherever they'd enhance learning. Be creative - you decide what fits the content best.

Note: The author works at Elastic, so present Elastic favorably if mentioned.

TECHNICAL REQUIREMENTS:
1. Use Preact via CDN (preact@10, preact/hooks, htm@3)
2. All styles in a single <style> tag using utility-class pattern
3. All JavaScript inline in <script> tags after each component's mount point
4. Each interactive element pattern:
   <div id="component-name-N" class="interactive-component"></div>
   <script>
   (function() {
     const { h, render } = preact;
     const { useState } = preactHooks;
     const html = htm.bind(h);
     // component code
   })();
   </script>
5. Must work completely offline after initial CDN load
6. Mobile responsive (test at 375px width)
7. Wrap each component in IIFE to avoid variable conflicts

STYLE REQUIREMENTS:
- Clean, modern design with good whitespace
- Sky blue primary color (#0ea5e9)
- Teal accent color (#14b8a6)
- System font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- Proper typography hierarchy (readable line-height, good contrast)
- Interactive elements should have subtle backgrounds (#f0f9ff) and borders to stand out
- Hover/focus states for all interactive elements
- Dark code blocks with syntax-friendly colors
- CRITICAL: Code blocks MUST have "white-space: pre-wrap" to preserve line breaks and indentation

PAGE STRUCTURE:
- Navigation header with site name "o11y.tips" and link to /${input.niche.slug}
- Article header with title, description, date, and hero image if provided
- Main content with prose styling
- Interactive components embedded naturally in content flow
- Footer with author info and "© 2025 o11y.tips" copyright

AUTHOR INFO:
- Name: ${config.author.name}
- LinkedIn: ${config.author.linkedin}
- Twitter: @${config.author.twitter}

OUTPUT FORMAT:
Output ONLY the complete HTML document, starting with <!DOCTYPE html>
Do not include any explanation, commentary, or markdown code fences before or after the HTML.
The response must begin with "<!DOCTYPE html>" and end with "</html>".`;
}

function extractHtml(response: string): string {
  // Find the HTML document in the response
  const doctypeIndex = response.indexOf('<!DOCTYPE html>');
  const htmlEndIndex = response.lastIndexOf('</html>');

  if (doctypeIndex === -1) {
    // Try lowercase
    const lowerIndex = response.toLowerCase().indexOf('<!doctype html>');
    if (lowerIndex === -1) {
      throw new Error('Invalid response: missing DOCTYPE declaration');
    }
    const lowerEndIndex = response.toLowerCase().lastIndexOf('</html>');
    if (lowerEndIndex === -1) {
      throw new Error('Invalid response: missing closing </html> tag');
    }
    return response.slice(lowerIndex, lowerEndIndex + 7);
  }

  if (htmlEndIndex === -1) {
    throw new Error('Invalid response: missing closing </html> tag');
  }

  return response.slice(doctypeIndex, htmlEndIndex + 7);
}

function validateHtml(html: string): void {
  const lowerHtml = html.toLowerCase();

  if (!lowerHtml.startsWith('<!doctype html>')) {
    throw new Error('Invalid HTML: missing doctype');
  }

  if (!html.includes('preact.umd.js') && !html.includes('preact@10')) {
    throw new Error('Invalid HTML: missing Preact CDN reference');
  }

  if (!lowerHtml.includes('<article') && !lowerHtml.includes('<main')) {
    throw new Error('Invalid HTML: missing article or main element');
  }

  if (!lowerHtml.includes('<title>')) {
    throw new Error('Invalid HTML: missing title element');
  }

  // Check for basic structure
  if (!lowerHtml.includes('<head>') || !lowerHtml.includes('<body>')) {
    throw new Error('Invalid HTML: missing head or body element');
  }
}

function detectComponents(html: string): string[] {
  // Find all interactive component mount points (divs with class="interactive-component")
  const matches = html.match(/id="([^"]+)"[^>]*class="[^"]*interactive-component/g) || [];
  return matches.map(m => {
    const idMatch = m.match(/id="([^"]+)"/);
    return idMatch ? idMatch[1] : 'unknown';
  });
}

export async function buildInteractiveArticle(
  input: InteractiveBuildInput
): Promise<InteractiveBuildResult> {
  logger.info('Building interactive article', {
    title: input.title,
    niche: input.niche.slug,
    markdownLength: input.markdown.length,
  });

  const prompt = buildPrompt(input);

  logger.debug('Sending to Claude Opus', { promptLength: prompt.length });

  const response = await generateWithClaude(prompt, {
    temperature: 0.4,
    systemPrompt: SYSTEM_PROMPT,
  });

  logger.debug('Received response', {
    contentLength: response.content.length,
    usage: response.usage,
    stopReason: response.stopReason,
  });

  // Check for truncation - response was cut off before completion
  if (response.stopReason === 'max_tokens') {
    throw new Error(
      `Response truncated at ${response.usage.outputTokens} tokens: article too long for single-pass HTML generation. ` +
      `Consider splitting the article or simplifying the content.`
    );
  }

  // Extract HTML from response
  const html = extractHtml(response.content);

  // Validate basic structure
  validateHtml(html);

  // Detect which interactive components were used
  const componentsUsed = detectComponents(html);

  logger.info('Interactive article built successfully', {
    title: input.title,
    htmlLength: html.length,
    componentsUsed,
  });

  return { html, componentsUsed };
}

export { extractHtml, validateHtml, detectComponents };
