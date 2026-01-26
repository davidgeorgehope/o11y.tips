import { generateWithGemini, generateJSON } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('quality:deslop');

export interface SlopAnalysis {
  score: number; // 0-10, lower is better (less slop)
  patterns: Array<{
    type: string;
    examples: string[];
    count: number;
  }>;
  suggestions: string[];
  overallAssessment: string;
}

// Common AI writing patterns to detect
const SLOP_PATTERNS = {
  hedging: [
    'it\'s worth noting',
    'it\'s important to',
    'it should be noted',
    'in general',
    'generally speaking',
    'typically',
    'as a general rule',
  ],
  transitions: [
    'let\'s dive in',
    'let\'s explore',
    'now let\'s',
    'first, let\'s',
    'moving on',
    'with that said',
    'that being said',
    'speaking of which',
  ],
  fillers: [
    'in today\'s',
    'in this article',
    'as we\'ll see',
    'as mentioned',
    'as discussed',
    'importantly',
    'essentially',
    'fundamentally',
    'basically',
  ],
  overused: [
    'robust',
    'leverage',
    'utilize',
    'facilitate',
    'seamless',
    'cutting-edge',
    'game-changer',
    'revolutionary',
    'transformative',
    'holistic',
    'synergy',
    'paradigm',
  ],
  enthusiasm: [
    'exciting',
    'amazing',
    'incredible',
    'fantastic',
    'awesome',
    'powerful',
    'great',
  ],
  cliches: [
    'at the end of the day',
    'in a nutshell',
    'the bottom line',
    'tip of the iceberg',
    'think outside the box',
    'hit the ground running',
    'low-hanging fruit',
  ],
};

export async function analyzeSlop(content: string): Promise<SlopAnalysis> {
  logger.debug('Analyzing content for slop patterns');

  // Rule-based detection
  const patterns = detectSlopPatterns(content);

  // Calculate base score from pattern detection
  let baseScore = calculateBaseScore(patterns);

  // AI-powered analysis for context
  const aiAnalysis = await getAIAnalysis(content);

  // Combine scores
  const finalScore = Math.min(10, (baseScore + aiAnalysis.score) / 2);

  const analysis: SlopAnalysis = {
    score: Math.round(finalScore * 10) / 10,
    patterns,
    suggestions: aiAnalysis.suggestions,
    overallAssessment: aiAnalysis.overallAssessment,
  };

  logger.debug('Slop analysis complete', { score: analysis.score });
  return analysis;
}

function detectSlopPatterns(content: string): SlopAnalysis['patterns'] {
  const contentLower = content.toLowerCase();
  const results: SlopAnalysis['patterns'] = [];

  for (const [type, patterns] of Object.entries(SLOP_PATTERNS)) {
    const found: string[] = [];
    let count = 0;

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = contentLower.match(regex);
      if (matches) {
        found.push(pattern);
        count += matches.length;
      }
    }

    if (found.length > 0) {
      results.push({
        type,
        examples: found.slice(0, 5),
        count,
      });
    }
  }

  return results;
}

function calculateBaseScore(patterns: SlopAnalysis['patterns']): number {
  let score = 0;

  for (const pattern of patterns) {
    const weight = {
      hedging: 0.5,
      transitions: 0.8,
      fillers: 0.6,
      overused: 1.0,
      enthusiasm: 0.7,
      cliches: 1.2,
    }[pattern.type] || 0.5;

    score += pattern.count * weight;
  }

  // Normalize to 0-10 scale (cap at 10)
  return Math.min(10, score / 2);
}

async function getAIAnalysis(content: string): Promise<{
  score: number;
  suggestions: string[];
  overallAssessment: string;
}> {
  const prompt = `Analyze this technical content for AI writing patterns ("slop").

CONTENT (first 2500 chars):
${content.substring(0, 2500)}

Look for:
1. Generic filler phrases that add no value
2. Overly formal or stiff language
3. Unnecessary hedging or qualifications
4. Buzzwords and jargon without substance
5. Repetitive sentence structures
6. Lack of specific examples or data
7. Excessive use of passive voice

Respond with JSON:
{
  "score": <0-10, where 0 is no slop and 10 is heavy slop>,
  "suggestions": [
    "<specific improvement suggestion>",
    ...
  ],
  "overallAssessment": "<1-2 sentence summary of content quality>"
}

Be specific in suggestions - point to actual issues in the text.`;

  try {
    const response = await generateJSON<{
      score: number;
      suggestions: string[];
      overallAssessment: string;
    }>(prompt, {
      model: 'gemini-flash',
      temperature: 0.2,
    });

    return response.content;
  } catch (error) {
    logger.error('AI slop analysis failed', { error });
    return {
      score: 5,
      suggestions: [],
      overallAssessment: 'Analysis unavailable',
    };
  }
}

export async function deslop(content: string): Promise<string> {
  logger.debug('De-slopping content');

  const prompt = `Rewrite this technical content to remove AI writing patterns while preserving all information.

ORIGINAL CONTENT:
${content}

RULES:
1. Remove filler phrases ("It's worth noting", "Let's dive in", etc.)
2. Replace buzzwords with plain language
3. Remove unnecessary hedging
4. Use active voice where possible
5. Keep the same structure and all technical information
6. Make it sound like an experienced developer wrote it
7. Preserve all code blocks exactly as-is
8. Keep the markdown formatting

DO NOT:
- Add new information
- Remove technical details
- Change code examples
- Add emojis or excessive formatting

Output the improved content directly, no explanations.`;

  const response = await generateWithGemini(prompt, {
    model: 'pro',
    temperature: 0.3,
    maxTokens: 8192,
  });

  logger.debug('De-slop complete', {
    originalLength: content.length,
    newLength: response.content.length,
  });

  return response.content;
}

export async function deslopIfNeeded(
  content: string,
  threshold: number = 5
): Promise<{ content: string; wasDeslopped: boolean; analysis: SlopAnalysis }> {
  const analysis = await analyzeSlop(content);

  if (analysis.score > threshold) {
    logger.info('Content exceeds slop threshold, rewriting', {
      score: analysis.score,
      threshold,
    });

    const deslopped = await deslop(content);

    // Re-analyze to verify improvement
    const newAnalysis = await analyzeSlop(deslopped);

    return {
      content: deslopped,
      wasDeslopped: true,
      analysis: newAnalysis,
    };
  }

  return {
    content,
    wasDeslopped: false,
    analysis,
  };
}
