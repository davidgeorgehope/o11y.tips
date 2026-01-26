import { createLogger } from '../../../utils/logger.js';
import type { DiscoverySource, RawDiscoveredPost, SourceConfig } from '../types.js';

const logger = createLogger('discovery:reddit');

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  url: string;
  permalink: string;
  created_utc: number;
  score: number;
  num_comments: number;
  subreddit: string;
}

interface RedditResponse {
  data: {
    children: Array<{
      data: RedditPost;
    }>;
  };
}

export const redditSource: DiscoverySource = {
  type: 'reddit',

  async discover(config: SourceConfig): Promise<RawDiscoveredPost[]> {
    const posts: RawDiscoveredPost[] = [];
    const subreddits = config.subreddits || getDefaultSubreddits(config.keywords);

    for (const subreddit of subreddits) {
      try {
        // Fetch from Reddit JSON API (no auth required for public data)
        const newPosts = await fetchSubredditPosts(subreddit, 'new', 25);
        const hotPosts = await fetchSubredditPosts(subreddit, 'hot', 25);

        const allPosts = [...newPosts, ...hotPosts];
        const seen = new Set<string>();

        for (const post of allPosts) {
          if (seen.has(post.id)) continue;
          seen.add(post.id);

          // Filter for question/help posts
          if (!isHelpPost(post, config.keywords)) continue;

          posts.push({
            sourceType: 'reddit',
            sourceUrl: `https://reddit.com${post.permalink}`,
            sourceId: post.id,
            title: post.title,
            content: post.selftext || post.title,
            author: post.author,
            metadata: {
              subreddit: post.subreddit,
              score: post.score,
              numComments: post.num_comments,
              createdUtc: post.created_utc,
            },
            discoveredAt: new Date().toISOString(),
          });
        }

        // Respect rate limits
        await sleep(2000);
      } catch (error) {
        logger.error('Failed to fetch from subreddit', { subreddit, error });
      }
    }

    return posts.slice(0, config.maxResults || 50);
  },
};

async function fetchSubredditPosts(
  subreddit: string,
  sort: 'new' | 'hot',
  limit: number
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ContentEngine/1.0 (educational research bot)',
    },
  });

  if (!response.ok) {
    throw new Error(`Reddit API error: ${response.status}`);
  }

  const data = await response.json() as RedditResponse;
  return data.data.children.map(child => child.data);
}

function getDefaultSubreddits(keywords: string[]): string[] {
  const techSubreddits = [
    'devops',
    'kubernetes',
    'docker',
    'aws',
    'programming',
    'webdev',
    'node',
    'golang',
    'rust',
    'python',
  ];

  // Try to match keywords to subreddits
  const matched: string[] = [];
  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    for (const sub of techSubreddits) {
      if (sub.includes(lower) || lower.includes(sub)) {
        matched.push(sub);
      }
    }
  }

  return matched.length > 0 ? matched : techSubreddits.slice(0, 3);
}

function isHelpPost(post: RedditPost, keywords: string[]): boolean {
  const titleLower = post.title.toLowerCase();
  const contentLower = (post.selftext || '').toLowerCase();
  const combined = `${titleLower} ${contentLower}`;

  // Check for question indicators
  const questionIndicators = [
    '?',
    'help',
    'issue',
    'problem',
    'error',
    'how to',
    'how do',
    'why does',
    'struggling',
    'stuck',
    'confused',
    'can\'t',
    'cannot',
    'doesn\'t work',
    'not working',
    'failing',
    'trouble',
  ];

  const hasQuestion = questionIndicators.some(indicator =>
    combined.includes(indicator)
  );

  if (!hasQuestion) return false;

  // Check for keyword relevance
  const hasKeyword = keywords.some(keyword =>
    combined.includes(keyword.toLowerCase())
  );

  return hasKeyword;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
