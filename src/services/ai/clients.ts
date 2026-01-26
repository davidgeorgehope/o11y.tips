import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
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

// Claude Client
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!config.apiKeys.anthropic) {
      throw new Error('Anthropic API key not configured');
    }
    anthropicClient = new Anthropic({
      apiKey: config.apiKeys.anthropic,
    });
  }
  return anthropicClient;
}

export async function generateWithClaude(
  prompt: string,
  options: GenerateOptions = {}
): Promise<AIResponse> {
  const client = getAnthropicClient();
  const model = config.ai.claude.model;

  logger.debug('Generating with Claude', { model, promptLength: prompt.length });

  const response = await withRetry(async () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt }
    ];

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: options.maxTokens || config.ai.claude.maxTokens,
      messages,
    };

    if (options.systemPrompt) {
      params.system = options.systemPrompt;
    }

    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    if (options.stopSequences) {
      params.stop_sequences = options.stopSequences;
    }

    return client.messages.create(params);
  });

  const content = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');

  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    model,
    timestamp: new Date().toISOString(),
  };

  usageTracker.track(usage);
  logger.debug('Claude response received', { usage, stopReason: response.stop_reason });

  return { content, usage, stopReason: response.stop_reason };
}

// Gemini Client
let googleClient: GoogleGenAI | null = null;

function getGoogleClient(): GoogleGenAI {
  if (!googleClient) {
    if (!config.apiKeys.googleAi) {
      throw new Error('Google AI API key not configured');
    }
    googleClient = new GoogleGenAI({
      apiKey: config.apiKeys.googleAi,
    });
  }
  return googleClient;
}

export async function generateWithGemini(
  prompt: string,
  options: GenerateOptions & { model?: 'flash' | 'pro' } = {}
): Promise<AIResponse> {
  const client = getGoogleClient();
  const modelName = options.model === 'pro'
    ? config.ai.gemini.proModel
    : config.ai.gemini.flashModel;

  logger.debug('Generating with Gemini', { model: modelName, promptLength: prompt.length });

  const response = await withRetry(async () => {
    const result = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        maxOutputTokens: options.maxTokens || 8192,
        temperature: options.temperature,
        stopSequences: options.stopSequences,
        systemInstruction: options.systemPrompt,
      },
    });
    return result;
  });

  const content = response.text || '';
  const usageMetadata = response.usageMetadata;

  const usage: TokenUsage = {
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    totalTokens: usageMetadata?.totalTokenCount || 0,
    model: modelName,
    timestamp: new Date().toISOString(),
  };

  usageTracker.track(usage);
  logger.debug('Gemini response received', { usage });

  return { content, usage };
}

export async function generateWithGeminiGroundedSearch(
  query: string,
  options: GenerateOptions = {}
): Promise<GroundedSearchResponse> {
  const client = getGoogleClient();
  const modelName = config.ai.gemini.flashModel;

  logger.debug('Generating with Gemini grounded search', { query });

  const response = await withRetry(async () => {
    const result = await client.models.generateContent({
      model: modelName,
      contents: query,
      config: {
        maxOutputTokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7,
        systemInstruction: options.systemPrompt,
        tools: [{ googleSearch: {} }],
      },
    });
    return result;
  });

  const content = response.text || '';
  const usageMetadata = response.usageMetadata;

  // Extract grounding metadata for sources
  const sources: SearchResult[] = [];
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

  if (groundingMetadata?.groundingChunks) {
    for (const chunk of groundingMetadata.groundingChunks) {
      if (chunk.web) {
        sources.push({
          title: chunk.web.title || '',
          url: chunk.web.uri || '',
          snippet: '',
        });
      }
    }
  }

  const usage: TokenUsage = {
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    totalTokens: usageMetadata?.totalTokenCount || 0,
    model: `${modelName}+grounding`,
    timestamp: new Date().toISOString(),
  };

  usageTracker.track(usage);
  logger.debug('Gemini grounded search response received', { usage, sourceCount: sources.length });

  return { content, sources, usage };
}

export async function generateImage(
  prompt: string,
  _options: ImageGenerationOptions = {}
): Promise<GeneratedImage[]> {
  const client = getGoogleClient();
  const modelName = config.ai.gemini.imageModel;

  logger.debug('Generating image with Gemini', { prompt: prompt.substring(0, 100) });

  // Use Gemini native image generation (generate_content with IMAGE modality)
  const response = await withRetry(async () => {
    const result = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseModalities: ['IMAGE'],
      },
    });
    return result;
  });

  const images: GeneratedImage[] = [];

  // Extract image from response candidates (Gemini native format)
  if (response.candidates) {
    for (const candidate of response.candidates) {
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          // Check for inline_data (raw image bytes)
          if (part.inlineData?.data) {
            images.push({
              data: Buffer.from(part.inlineData.data, 'base64'),
              mimeType: part.inlineData.mimeType || 'image/png',
            });
          }
        }
      }
    }
  }

  logger.debug('Image generation complete', { count: images.length });

  return images;
}

// JSON extraction helper
export async function generateJSON<T>(
  prompt: string,
  options: GenerateOptions & { model?: 'claude' | 'gemini-flash' | 'gemini-pro' } = {}
): Promise<AIResponse<T>> {
  const fullPrompt = `${prompt}

Respond with valid JSON only, no markdown code blocks or other formatting.`;

  let response: AIResponse;

  if (options.model === 'claude') {
    response = await generateWithClaude(fullPrompt, options);
  } else {
    response = await generateWithGemini(fullPrompt, {
      ...options,
      model: options.model === 'gemini-pro' ? 'pro' : 'flash',
    });
  }

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

export { getAnthropicClient, getGoogleClient };
