import { generateWithGeminiGroundedSearch, generateJSON } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import type { ResearchResult, GenerationContext, VoiceAnalysis } from './types.js';

const logger = createLogger('generation:research');

export async function conductResearch(
  context: GenerationContext,
  voiceAnalysis: VoiceAnalysis
): Promise<ResearchResult> {
  logger.debug('Conducting research', { postId: context.discoveredPost.id });

  // Build research queries based on the pain point
  const queries = buildResearchQueries(context, voiceAnalysis);

  // Gather information from multiple searches
  const searchResults: string[] = [];
  const sources: Array<{ title: string; url: string; relevance: string }> = [];

  for (const query of queries.slice(0, 3)) {
    try {
      const result = await generateWithGeminiGroundedSearch(query, {
        systemPrompt: `You are a technical researcher. Find accurate, up-to-date information about the topic.
Focus on best practices, common solutions, and authoritative sources.
Provide specific, actionable information.`,
        temperature: 0.5,
      });

      searchResults.push(result.content);

      for (const source of result.sources) {
        sources.push({
          title: source.title,
          url: source.url,
          relevance: 'Related to query',
        });
      }
    } catch (error) {
      logger.warn('Research query failed', { query, error });
    }
  }

  // Synthesize research into structured format
  const synthesis = await synthesizeResearch(context, voiceAnalysis, searchResults, sources);

  logger.debug('Research complete', {
    sourceCount: sources.length,
    keyPointCount: synthesis.keyPoints.length,
  });

  return synthesis;
}

function buildResearchQueries(context: GenerationContext, voice: VoiceAnalysis): string[] {
  const { discoveredPost, niche } = context;
  const keywords = niche.keywords || [];

  // Extract key terms from the post
  const title = discoveredPost.title.toLowerCase();

  const queries = [
    // Main topic research
    `${discoveredPost.title} best practices solutions`,
    // How-to focused
    `how to ${extractMainAction(title)} ${keywords[0] || ''}`,
    // Troubleshooting focused
    `${keywords[0] || niche.name} common problems solutions`,
  ];

  // Add voice-specific queries
  if (voice.experienceLevel === 'beginner') {
    queries.push(`${keywords[0] || niche.name} tutorial beginner guide`);
  } else if (voice.experienceLevel === 'advanced') {
    queries.push(`${keywords[0] || niche.name} advanced techniques performance`);
  }

  return queries;
}

function extractMainAction(title: string): string {
  // Extract the main action/verb from the title
  const actionWords = ['setup', 'configure', 'install', 'fix', 'debug', 'implement', 'create', 'deploy', 'monitor', 'optimize'];

  for (const action of actionWords) {
    if (title.includes(action)) {
      // Get the action and following words
      const idx = title.indexOf(action);
      return title.substring(idx, idx + 50).split(/[?.!,]/).pop() || action;
    }
  }

  // Return first few meaningful words
  return title.split(' ').slice(0, 5).join(' ');
}

async function synthesizeResearch(
  context: GenerationContext,
  voice: VoiceAnalysis,
  searchResults: string[],
  sources: Array<{ title: string; url: string; relevance: string }>
): Promise<ResearchResult> {
  const prompt = `Synthesize this research into a structured format for creating educational content.

Original Question/Problem:
${context.discoveredPost.title}
${context.discoveredPost.content.substring(0, 1000)}

Target Audience Level: ${voice.experienceLevel}
Learning Goals: ${voice.learningGoals.join(', ')}

Research Gathered:
${searchResults.map((r, i) => `--- Source ${i + 1} ---\n${r.substring(0, 2000)}`).join('\n\n')}

Create a JSON object:
{
  "topic": "<main topic being addressed>",
  "summary": "<2-3 sentence summary of the solution/answer>",
  "keyPoints": ["<key point 1>", "<key point 2>", ...],
  "sources": [
    {"title": "<source title>", "url": "<url>", "relevance": "<why relevant>"},
    ...
  ],
  "relatedTopics": ["<related topic 1>", ...],
  "bestPractices": ["<best practice 1>", ...],
  "commonMistakes": ["<common mistake to avoid>", ...]
}`;

  const response = await generateJSON<ResearchResult>(prompt, {
    model: 'gemini-flash',
    temperature: 0.4,
  });

  // Merge in sources from search
  const uniqueSources = new Map<string, { title: string; url: string; relevance: string }>();
  for (const source of [...response.content.sources, ...sources]) {
    if (source.url && !uniqueSources.has(source.url)) {
      uniqueSources.set(source.url, source);
    }
  }

  return {
    ...response.content,
    sources: Array.from(uniqueSources.values()).slice(0, 10),
  };
}
