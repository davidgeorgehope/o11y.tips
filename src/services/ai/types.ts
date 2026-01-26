export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  timestamp: string;
}

export interface AIResponse<T = string> {
  content: T;
  usage: TokenUsage;
  stopReason?: string | null;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stopSequences?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface GroundedSearchResponse {
  content: string;
  sources: SearchResult[];
  usage: TokenUsage;
}

export interface ImageGenerationOptions {
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  numberOfImages?: number;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
}

export interface ComponentGenerationResult {
  code: string;
  exports: string[];
  dependencies: string[];
}

export type AIModel = 'claude-opus' | 'gemini-flash' | 'gemini-pro';

export interface UsageTracker {
  track(usage: TokenUsage): void;
  getStats(): UsageStats;
  reset(): void;
}

export interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  requestCount: number;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    requestCount: number;
  }>;
}
