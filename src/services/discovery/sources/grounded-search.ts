import { generateWithGeminiGroundedSearch } from '../../ai/clients.js';
import { createLogger } from '../../../utils/logger.js';
import type { DiscoverySource, RawDiscoveredPost, SourceConfig } from '../types.js';

const logger = createLogger('discovery:grounded-search');

export const groundedSearchSource: DiscoverySource = {
  type: 'grounded_search',

  async discover(config: SourceConfig): Promise<RawDiscoveredPost[]> {
    const posts: RawDiscoveredPost[] = [];
    const queries = config.searchQueries || buildDefaultQueries(config.keywords);

    for (const query of queries) {
      try {
        logger.debug('Running grounded search', { query });

        const currentYear = new Date().getFullYear();
        const response = await generateWithGeminiGroundedSearch(
          buildSearchPrompt(query, currentYear),
          {
            systemPrompt: `You are a research assistant finding developer pain points from ${currentYear}.
Extract specific questions, problems, and frustrations developers are experiencing.
Focus on real issues from forums, discussions, and Q&A sites.
Return structured data about each discovered pain point.
When referencing dates, use ${currentYear} as the current year.`,
            temperature: 0.7,
          }
        );

        // Parse the response to extract pain points
        const extracted = parseGroundedResponse(response.content, response.sources);

        for (const item of extracted) {
          posts.push({
            sourceType: 'grounded_search',
            sourceUrl: item.url || `https://search.google.com/search?q=${encodeURIComponent(query)}`,
            sourceId: undefined,
            title: item.title,
            content: item.content,
            author: item.author,
            metadata: {
              query,
              sources: response.sources,
            },
            discoveredAt: new Date().toISOString(),
          });
        }

        // Respect rate limits
        await sleep(1000);
      } catch (error) {
        logger.error('Grounded search failed for query', { query, error });
      }
    }

    return posts.slice(0, config.maxResults || 20);
  },
};

function buildDefaultQueries(keywords: string[]): string[] {
  const templates = [
    '{keyword} common problems developers face',
    '{keyword} frustrating issues',
    '{keyword} help needed troubleshooting',
    'how to fix {keyword} errors',
    '{keyword} best practices questions',
    'struggling with {keyword}',
  ];

  const queries: string[] = [];
  for (const keyword of keywords.slice(0, 3)) {
    for (const template of templates.slice(0, 2)) {
      queries.push(template.replace('{keyword}', keyword));
    }
  }

  return queries;
}

function buildSearchPrompt(query: string, currentYear: number): string {
  return `Search for: "${query}"

Current year: ${currentYear}

Find discussions, forum posts, and questions from ${currentYear} where developers are experiencing problems or asking for help.

For each pain point you find, extract:
1. The title or main question
2. The full context of the problem
3. The author if available
4. The source URL

Format your response as a list of discoveries:

DISCOVERY 1:
Title: [title]
URL: [url]
Author: [author or "unknown"]
Content: [full description of the problem]

DISCOVERY 2:
...

Find 3-5 relevant pain points from ${currentYear}.`;
}

interface ExtractedItem {
  title: string;
  content: string;
  url?: string;
  author?: string;
}

function parseGroundedResponse(content: string, sources: Array<{ url: string; title: string }>): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const discoveryRegex = /(?:###?\s*)?DISCOVERY\s+\d+:\s*\*{0,2}Title:\*{0,2}\s*"?(.+?)"?\s*\*{0,2}URL:\*{0,2}\s*"?(.+?)"?\s*\*{0,2}Author:\*{0,2}\s*"?(.+?)"?\s*\*{0,2}Content:\*{0,2}\s*([\s\S]+?)(?=(?:###?\s*)?DISCOVERY\s+\d+:|$)/gi;

  let match;
  while ((match = discoveryRegex.exec(content)) !== null) {
    const [, title, url, author, itemContent] = match;
    items.push({
      title: title.trim(),
      url: url.trim() !== 'N/A' && url.trim() !== 'unknown' ? url.trim() : sources[0]?.url,
      author: author.trim() !== 'unknown' ? author.trim() : undefined,
      content: itemContent.trim(),
    });
  }

  // If parsing failed, try to extract from plain text
  if (items.length === 0 && content.length > 100) {
    items.push({
      title: 'Discovered Pain Point',
      content: content,
      url: sources[0]?.url,
    });
  }

  return items;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
