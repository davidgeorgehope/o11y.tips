import { createLogger } from '../../../utils/logger.js';
import { config } from '../../../config.js';
import type { DiscoverySource, RawDiscoveredPost, SourceConfig } from '../types.js';

const logger = createLogger('discovery:github');

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  html_url: string;
  user: {
    login: string;
  };
  labels: Array<{
    name: string;
  }>;
  state: string;
  comments: number;
  created_at: string;
  reactions: {
    '+1': number;
    '-1': number;
    total_count: number;
  };
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubIssue[];
}

export const githubSource: DiscoverySource = {
  type: 'github',

  async discover(sourceConfig: SourceConfig): Promise<RawDiscoveredPost[]> {
    const posts: RawDiscoveredPost[] = [];

    // Search for issues in specified repositories or by keywords
    if (sourceConfig.repositories && sourceConfig.repositories.length > 0) {
      for (const repo of sourceConfig.repositories) {
        try {
          const issues = await fetchRepoIssues(repo, sourceConfig.keywords);
          posts.push(...issues.map(issue => mapIssueToPost(issue, repo)));
          await sleep(1000); // Rate limiting
        } catch (error) {
          logger.error('Failed to fetch issues from repo', { repo, error });
        }
      }
    } else {
      // Search across GitHub
      try {
        const issues = await searchIssues(sourceConfig.keywords);
        posts.push(...issues.map(issue => mapIssueToPost(issue)));
      } catch (error) {
        logger.error('Failed to search GitHub issues', { error });
      }
    }

    return posts.slice(0, sourceConfig.maxResults || 30);
  },
};

async function fetchRepoIssues(repo: string, keywords: string[]): Promise<GitHubIssue[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ContentEngine/1.0',
  };

  if (config.apiKeys.github) {
    headers['Authorization'] = `token ${config.apiKeys.github}`;
  }

  const url = `https://api.github.com/repos/${repo}/issues?state=open&per_page=50&sort=created&direction=desc`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const issues = await response.json() as GitHubIssue[];

  // Filter by keywords and question indicators
  return issues.filter(issue => isHelpIssue(issue, keywords));
}

async function searchIssues(keywords: string[]): Promise<GitHubIssue[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ContentEngine/1.0',
  };

  if (config.apiKeys.github) {
    headers['Authorization'] = `token ${config.apiKeys.github}`;
  }

  // Build search query
  const keywordQuery = keywords.slice(0, 3).join(' OR ');
  const searchQuery = `${keywordQuery} is:issue is:open label:help-wanted,question,bug`;

  const params = new URLSearchParams({
    q: searchQuery,
    sort: 'created',
    order: 'desc',
    per_page: '50',
  });

  const url = `https://api.github.com/search/issues?${params}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json() as GitHubSearchResponse;
  return data.items;
}

function isHelpIssue(issue: GitHubIssue, keywords: string[]): boolean {
  const titleLower = issue.title.toLowerCase();
  const bodyLower = (issue.body || '').toLowerCase();
  const combined = `${titleLower} ${bodyLower}`;

  // Check labels for help/question indicators
  const helpLabels = ['help wanted', 'question', 'bug', 'help', 'needs help'];
  const hasHelpLabel = issue.labels.some(label =>
    helpLabels.includes(label.name.toLowerCase())
  );

  // Check content for question indicators
  const questionIndicators = [
    '?',
    'how to',
    'help',
    'issue',
    'error',
    'bug',
    'problem',
    'not working',
    'doesn\'t work',
    'unable to',
    'cannot',
    'can\'t',
  ];

  const hasQuestion = questionIndicators.some(indicator =>
    combined.includes(indicator)
  );

  // Check for keyword relevance
  const hasKeyword = keywords.some(keyword =>
    combined.includes(keyword.toLowerCase())
  );

  return (hasHelpLabel || hasQuestion) && hasKeyword;
}

function mapIssueToPost(issue: GitHubIssue, repo?: string): RawDiscoveredPost {
  return {
    sourceType: 'github',
    sourceUrl: issue.html_url,
    sourceId: issue.id.toString(),
    title: issue.title,
    content: issue.body || issue.title,
    author: issue.user.login,
    metadata: {
      repo,
      issueNumber: issue.number,
      labels: issue.labels.map(l => l.name),
      comments: issue.comments,
      reactions: issue.reactions?.total_count || 0,
      state: issue.state,
    },
    discoveredAt: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
