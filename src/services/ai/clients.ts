import OpenAI from 'openai';
import { config } from '../../config.js';
import { withRetry } from '../../utils/retry.js';
import { createLogger } from '../../utils/logger.js';
import type {
  AIResponse,
  GenerateOptions,
  GroundedSearchResponse,
  ImageGenerationOptions,
  GeneratedImage,
  TokenUsage,
  UsageStats,
  SearchResult,
} from './types.js';

const logger = createLogger('ai-clients');

// Token usage tracking
class UsageTrackerImpl {
  private stats: UsageStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    byModel: {},
  };

  track(usage: TokenUsage): void {
    this.stats.totalInputTokens += usage.inputTokens;
    this.stats.totalOutputTokens += usage.outputTokens;
    this.stats.totalTokens += usage.totalTokens;
    this.stats.requestCount++;

    if (!this.stats.byModel[usage.model]) {
      this.stats.byModel[usage.model] = {
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
      };
    }
    this.stats.byModel[usage.model].inputTokens += usage.inputTokens;
    this.stats.byModel[usage.model].outputTokens += usage.outputTokens;
    this.stats.byModel[usage.model].requestCount++;
  }

  getStats(): UsageStats {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      byModel: {},
    };
  }
}

export const usageTracker = new UsageTrackerImpl();

// xAI (Grok) client - OpenAI-compatible API
let xaiClient: OpenAI | null = null;

function getXaiClient(): OpenAI {
  if (!xaiClient) {
    if (!config.apiKeys.xai) {
      throw new Error('xAI API key not configured');
    }
    xaiClient = new OpenAI({
      apiKey: config.apiKeys.xai,
      baseURL: 'https://api.x.ai/v1',
      timeout: 15 * 60 * 1000,
    });
  }
  return xaiClient;
}

export type ModelTier = 'fast' | 'pro';

function modelFor(tier: ModelTier = 'fast'): string {
  return tier === 'pro' ? config.ai.xai.proModel : config.ai.xai.fastModel;
}

function trackUsage(model: string, input = 0, output = 0): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    model,
    timestamp: new Date().toISOString(),
  };
  usageTracker.track(usage);
  return usage;
}

export async function generateText(
  prompt: string,
  options: GenerateOptions & { model?: ModelTier } = {}
): Promise<AIResponse> {
  const client = getXaiClient();
  const model = modelFor(options.model);

  logger.debug('Generating with Grok', { model, promptLength: prompt.length });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stop: options.stopSequences,
      // 'fast' tier = grok-4.7 with low reasoning
      ...(options.model === 'pro' ? {} : { reasoning_effort: 'low' as const }),
    })
  );

  const choice = response.choices[0];
  const usage = trackUsage(model, response.usage?.prompt_tokens, response.usage?.completion_tokens);
  logger.debug('Grok response received', { usage, stopReason: choice?.finish_reason });

  return { content: choice?.message?.content || '', usage, stopReason: choice?.finish_reason };
}

export async function generateWithWebSearch(
  query: string,
  options: GenerateOptions = {}
): Promise<GroundedSearchResponse> {
  const client = getXaiClient();
  const model = config.ai.xai.fastModel;

  logger.debug('Generating with Grok web search', { query });

  const response = await withRetry(() =>
    client.responses.create({
      model,
      input: query,
      instructions: options.systemPrompt,
      temperature: options.temperature ?? 0.7,
      tools: [{ type: 'web_search' } as unknown as OpenAI.Responses.Tool],
    })
  );

  const sources: SearchResult[] = [];
  const seen = new Set<string>();
  for (const item of response.output) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type !== 'output_text') continue;
      for (const ann of part.annotations || []) {
        if (ann.type === 'url_citation' && !seen.has(ann.url)) {
          seen.add(ann.url);
          sources.push({ title: ann.title || '', url: ann.url, snippet: '' });
        }
      }
    }
  }

  const usage = trackUsage(`${model}+web_search`, response.usage?.input_tokens, response.usage?.output_tokens);
  logger.debug('Grok web search response received', { usage, sourceCount: sources.length });

  return { content: response.output_text || '', sources, usage };
}

export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<GeneratedImage[]> {
  const client = getXaiClient();
  const model = config.ai.xai.imageModel;

  logger.debug('Generating image with Grok Imagine', { prompt: prompt.substring(0, 100) });

  const response = await withRetry(() =>
    client.images.generate({
      model,
      prompt,
      n: options.numberOfImages || 1,
      response_format: 'b64_json',
      ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
    } as OpenAI.Images.ImageGenerateParamsNonStreaming)
  );

  const images: GeneratedImage[] = (response.data || [])
    .filter(d => d.b64_json)
    .map(d => ({ data: Buffer.from(d.b64_json as string, 'base64'), mimeType: 'image/jpeg' }));

  logger.debug('Image generation complete', { count: images.length });

  return images;
}

// JSON extraction helper
export async function generateJSON<T>(
  prompt: string,
  options: GenerateOptions & { model?: ModelTier } = {}
): Promise<AIResponse<T>> {
  const fullPrompt = `${prompt}

Respond with valid JSON only, no markdown code blocks or other formatting.`;

  const response = await generateText(fullPrompt, options);

  // Clean up the response content
  let jsonContent = response.content.trim();

  // Remove markdown code blocks if present
  if (jsonContent.startsWith('```json')) {
    jsonContent = jsonContent.slice(7);
  } else if (jsonContent.startsWith('```')) {
    jsonContent = jsonContent.slice(3);
  }
  if (jsonContent.endsWith('```')) {
    jsonContent = jsonContent.slice(0, -3);
  }

  jsonContent = jsonContent.trim();

  try {
    const parsed = JSON.parse(jsonContent) as T;
    return { content: parsed, usage: response.usage };
  } catch (error) {
    logger.error('Failed to parse JSON response', { content: jsonContent, error });
    throw new Error(`Failed to parse AI response as JSON: ${error}`);
  }
}

export { getXaiClient };
