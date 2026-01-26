import { createLogger } from '../../../utils/logger.js';
import type { DiscoverySource, RawDiscoveredPost, SourceConfig } from '../types.js';

const logger = createLogger('discovery:hackernews');

interface HNSearchHit {
  objectID: string;
  title: string;
  url?: string;
  story_text?: string;
  author: string;
  points: number;
  num_comments: number;
  created_at: string;
  _tags: string[];
}

interface HNSearchResponse {
  hits: HNSearchHit[];
  nbHits: number;
  page: number;
  nbPages: number;
}

export const hackernewsSource: DiscoverySource = {
  type: 'hackernews',

  async discover(config: SourceConfig): Promise<RawDiscoveredPost[]> {
    const posts: RawDiscoveredPost[] = [];
    const queries = config.searchQueries || config.keywords;

    for (const query of queries.slice(0, 5)) {
      try {
        // Search for Ask HN and Show HN posts
        const askPosts = await searchHN(`Ask HN ${query}`, 'story');
        const showPosts = await searchHN(query, 'ask_hn');

        for (const post of [...askPosts, ...showPosts]) {
          // Filter for relevant posts
          if (!isRelevantPost(post, config.keywords)) continue;

          const content = post.story_text || post.title;

          posts.push({
            sourceType: 'hackernews',
            sourceUrl: `https://news.ycombinator.com/item?id=${post.objectID}`,
            sourceId: post.objectID,
            title: post.title,
            content,
            author: post.author,
            metadata: {
              points: post.points,
              numComments: post.num_comments,
              createdAt: post.created_at,
              externalUrl: post.url,
            },
            discoveredAt: new Date().toISOString(),
          });
        }

        // Respect rate limits
        await sleep(500);
      } catch (error) {
        logger.error('Failed to search Hacker News', { query, error });
      }
    }

    // Deduplicate by ID
    const seen = new Set<string>();
    const unique = posts.filter(post => {
      if (seen.has(post.sourceId!)) return false;
      seen.add(post.sourceId!);
      return true;
    });

    return unique.slice(0, config.maxResults || 30);
  },
};

async function searchHN(query: string, tags?: string): Promise<HNSearchHit[]> {
  const baseUrl = 'https://hn.algolia.com/api/v1/search_by_date';
  const params = new URLSearchParams({
    query,
    hitsPerPage: '50',
  });

  if (tags) {
    params.set('tags', tags);
  }

  const response = await fetch(`${baseUrl}?${params}`);

  if (!response.ok) {
    throw new Error(`Hacker News API error: ${response.status}`);
  }

  const data = await response.json() as HNSearchResponse;
  return data.hits;
}

function isRelevantPost(post: HNSearchHit, keywords: string[]): boolean {
  const titleLower = post.title.toLowerCase();
  const textLower = (post.story_text || '').toLowerCase();
  const combined = `${titleLower} ${textLower}`;

  // Check for question/help indicators
  const questionIndicators = [
    'ask hn',
    '?',
    'help',
    'how to',
    'how do',
    'why does',
    'problem',
    'issue',
    'struggling',
    'advice',
    'recommendations',
  ];

  const hasQuestion = questionIndicators.some(indicator =>
    combined.includes(indicator)
  );

  // Check for keyword relevance
  const hasKeyword = keywords.some(keyword =>
    combined.includes(keyword.toLowerCase())
  );

  return hasQuestion && hasKeyword;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
