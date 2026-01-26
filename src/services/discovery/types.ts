export type SourceType = 'grounded_search' | 'reddit' | 'stackoverflow' | 'hackernews' | 'github';

export interface DiscoverySource {
  type: SourceType;
  discover(config: SourceConfig): Promise<RawDiscoveredPost[]>;
}

export interface SourceConfig {
  nicheId: string;
  scheduleId: string;
  keywords: string[];
  subreddits?: string[];
  tags?: string[];
  repositories?: string[];
  searchQueries?: string[];
  maxResults?: number;
}

export interface RawDiscoveredPost {
  sourceType: SourceType;
  sourceUrl: string;
  sourceId?: string;
  title: string;
  content: string;
  author?: string;
  metadata?: Record<string, unknown>;
  discoveredAt: string;
}

export interface PainAnalysis {
  score: number;
  reasoning: string;
  authorLevel: 'beginner' | 'intermediate' | 'advanced';
  painPoints: string[];
  emotionalIndicators: string[];
  technicalDepth: number;
  urgency: number;
  specificity: number;
}

export interface ScoredPost extends RawDiscoveredPost {
  painScore: number;
  painAnalysis: PainAnalysis;
  authorLevel: string;
  contentHash: string;
}

export interface DiscoveryResult {
  posts: ScoredPost[];
  sourceType: SourceType;
  scheduleId: string;
  nicheId: string;
  timestamp: string;
  stats: {
    discovered: number;
    scored: number;
    duplicates: number;
    belowThreshold: number;
  };
}
