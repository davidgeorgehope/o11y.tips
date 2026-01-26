import { generateJSON } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import type { PainAnalysis, RawDiscoveredPost, ScoredPost } from './types.js';
import { hashContent } from '../../utils/hash.js';

const logger = createLogger('discovery:scorer');

export async function scorePainPoint(post: RawDiscoveredPost): Promise<ScoredPost> {
  const prompt = buildScoringPrompt(post);

  try {
    const response = await generateJSON<PainAnalysis>(prompt, {
      model: 'gemini-flash',
      temperature: 0.3,
      systemPrompt: `You are an expert at analyzing developer pain points and questions.
Score how valuable this pain point would be for creating educational content.
Consider: specificity, emotional intensity, technical depth, and how common this problem likely is.`,
    });

    const analysis = response.content;

    return {
      ...post,
      painScore: analysis.score,
      painAnalysis: analysis,
      authorLevel: analysis.authorLevel,
      contentHash: hashContent(`${post.title}${post.content}`),
    };
  } catch (error) {
    logger.error('Failed to score pain point', { post: post.title, error });

    // Return with a default low score on error
    return {
      ...post,
      painScore: 0,
      painAnalysis: {
        score: 0,
        reasoning: 'Scoring failed',
        authorLevel: 'intermediate',
        painPoints: [],
        emotionalIndicators: [],
        technicalDepth: 0,
        urgency: 0,
        specificity: 0,
      },
      authorLevel: 'intermediate',
      contentHash: hashContent(`${post.title}${post.content}`),
    };
  }
}

export async function scorePainPoints(posts: RawDiscoveredPost[]): Promise<ScoredPost[]> {
  const results: ScoredPost[] = [];

  // Process in batches to manage rate limits
  const batchSize = 5;
  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);

    const scored = await Promise.all(
      batch.map(post => scorePainPoint(post))
    );

    results.push(...scored);

    // Small delay between batches
    if (i + batchSize < posts.length) {
      await sleep(500);
    }
  }

  return results;
}

function buildScoringPrompt(post: RawDiscoveredPost): string {
  return `Analyze this developer pain point and score its value for creating educational content.

Title: ${post.title}

Content:
${post.content.substring(0, 2000)}

Source: ${post.sourceType}
Author: ${post.author || 'Unknown'}

Respond with a JSON object:
{
  "score": <number 0-100, where higher means more valuable for content>,
  "reasoning": "<1-2 sentences explaining the score>",
  "authorLevel": "<'beginner' | 'intermediate' | 'advanced'>",
  "painPoints": ["<specific pain point 1>", "<specific pain point 2>", ...],
  "emotionalIndicators": ["<frustration word/phrase>", ...],
  "technicalDepth": <number 1-10>,
  "urgency": <number 1-10>,
  "specificity": <number 1-10>
}

Scoring guidelines:
- High score (70-100): Specific technical problem, clear emotional indicators, common issue, good for tutorial
- Medium score (40-69): Decent question but generic, or very niche
- Low score (0-39): Too vague, already well-documented, or not a real pain point`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
