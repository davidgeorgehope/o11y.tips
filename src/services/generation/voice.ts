import { generateJSON } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import type { VoiceAnalysis, GenerationContext } from './types.js';

const logger = createLogger('generation:voice');

export async function analyzeVoice(context: GenerationContext): Promise<VoiceAnalysis> {
  logger.debug('Analyzing voice for post', { postId: context.discoveredPost.id });

  const prompt = buildVoicePrompt(context);

  const response = await generateJSON<VoiceAnalysis>(prompt, {
    model: 'gemini-flash',
    temperature: 0.3,
    systemPrompt: `You are an expert at analyzing how developers communicate and learn.
Your job is to understand the original poster's experience level and learning style
so we can create content perfectly tailored to their needs.`,
  });

  logger.debug('Voice analysis complete', { analysis: response.content });
  return response.content;
}

function buildVoicePrompt(context: GenerationContext): string {
  const { discoveredPost, niche } = context;
  const painAnalysis = discoveredPost.painAnalysis
    ? JSON.parse(discoveredPost.painAnalysis)
    : null;

  return `Analyze this developer's question/problem to understand their experience level and learning style.

Original Post Title: ${discoveredPost.title}

Original Post Content:
${discoveredPost.content.substring(0, 3000)}

${painAnalysis ? `
Pain Analysis:
- Pain Points: ${painAnalysis.painPoints?.join(', ') || 'N/A'}
- Technical Depth: ${painAnalysis.technicalDepth || 'N/A'}/10
- Author Level: ${painAnalysis.authorLevel || 'unknown'}
` : ''}

Niche Context: ${niche.name}
${niche.targetAudience ? `Target Audience: ${niche.targetAudience}` : ''}

Respond with a JSON object:
{
  "experienceLevel": "<'beginner' | 'intermediate' | 'advanced'>",
  "communicationStyle": "<'formal' | 'casual' | 'technical'>",
  "preferredFormat": "<'step-by-step' | 'conceptual' | 'example-heavy'>",
  "terminologyLevel": "<'basic' | 'intermediate' | 'expert'>",
  "learningGoals": ["<what they're trying to learn/achieve>", ...],
  "frustrationPoints": ["<what's frustrating them>", ...],
  "backgroundAssumptions": ["<what they likely already know>", ...]
}

Guidelines:
- "experienceLevel": Based on terminology used, question complexity, and context
- "communicationStyle": Based on how they write (formal docs-style, casual chat, or heavily technical)
- "preferredFormat": Based on what would best help someone at their level
- "terminologyLevel": How much jargon/technical terms to use
- "learningGoals": What they're actually trying to accomplish
- "frustrationPoints": What's blocking or frustrating them
- "backgroundAssumptions": What concepts they likely already understand`;
}
