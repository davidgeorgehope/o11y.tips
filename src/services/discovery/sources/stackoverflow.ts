import { createLogger } from '../../../utils/logger.js';
import type { DiscoverySource, RawDiscoveredPost, SourceConfig } from '../types.js';

const logger = createLogger('discovery:stackoverflow');

interface SOQuestion {
  question_id: number;
  title: string;
  body: string;
  link: string;
  tags: string[];
  owner: {
    display_name: string;
    reputation: number;
  };
  score: number;
  answer_count: number;
  view_count: number;
  creation_date: number;
  is_answered: boolean;
}

interface SOResponse {
  items: SOQuestion[];
  has_more: boolean;
  quota_remaining: number;
}

export const stackoverflowSource: DiscoverySource = {
  type: 'stackoverflow',

  async discover(config: SourceConfig): Promise<RawDiscoveredPost[]> {
    const posts: RawDiscoveredPost[] = [];
    const tags = config.tags || config.keywords;

    try {
      // Fetch questions with the specified tags
      const tagString = tags.slice(0, 5).join(';');
      const questions = await fetchQuestions(tagString, config.maxResults || 50);

      for (const question of questions) {
        // Focus on unanswered or low-score answers
        if (question.is_answered && question.answer_count > 2) continue;

        posts.push({
          sourceType: 'stackoverflow',
          sourceUrl: question.link,
          sourceId: question.question_id.toString(),
          title: decodeHtmlEntities(question.title),
          content: stripHtml(question.body),
          author: question.owner?.display_name,
          metadata: {
            tags: question.tags,
            score: question.score,
            answerCount: question.answer_count,
            viewCount: question.view_count,
            isAnswered: question.is_answered,
            ownerReputation: question.owner?.reputation,
          },
          discoveredAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Failed to fetch from Stack Overflow', { error });
    }

    return posts;
  },
};

async function fetchQuestions(tags: string, limit: number): Promise<SOQuestion[]> {
  const baseUrl = 'https://api.stackexchange.com/2.3/questions';
  const params = new URLSearchParams({
    order: 'desc',
    sort: 'creation',
    tagged: tags,
    site: 'stackoverflow',
    filter: 'withbody',
    pagesize: Math.min(limit, 100).toString(),
  });

  const response = await fetch(`${baseUrl}?${params}`);

  if (!response.ok) {
    throw new Error(`Stack Overflow API error: ${response.status}`);
  }

  const data = await response.json() as SOResponse;
  logger.debug('Stack Overflow quota remaining', { quota: data.quota_remaining });

  return data.items;
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };

  return text.replace(/&[^;]+;/g, entity => entities[entity] || entity);
}

function stripHtml(html: string): string {
  // Convert code blocks to preserve them
  let text = html.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');

  // Convert paragraphs and line breaks
  text = text.replace(/<p>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode entities
  text = decodeHtmlEntities(text);

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}
