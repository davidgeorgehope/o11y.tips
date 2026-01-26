import { generateJSON } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import { slugify } from '../../utils/hash.js';
import type { ContentOutline, GenerationContext, VoiceAnalysis, ResearchResult } from './types.js';

const logger = createLogger('generation:outline');

export async function generateOutline(
  context: GenerationContext,
  voiceAnalysis: VoiceAnalysis,
  research: ResearchResult
): Promise<ContentOutline> {
  logger.debug('Generating content outline', { postId: context.discoveredPost.id });

  const prompt = buildOutlinePrompt(context, voiceAnalysis, research);

  const response = await generateJSON<ContentOutline>(prompt, {
    model: 'gemini-flash',
    temperature: 0.6,
    systemPrompt: `You are an expert technical content strategist specializing in GEO/AEO optimization.
Create content outlines optimized for AI-powered search engines (Google AI Overviews, ChatGPT, Perplexity).
Key principles:
- Use question-based section headings ("What is X?", "How do you Y?")
- Always include a "Key Takeaways" section at the start
- Always include a "Frequently Asked Questions" section at the end
- Structure content so each section directly answers a searchable question
- Prioritize clear, direct answers over elaborate explanations`,
  });

  const outline = response.content;

  // Ensure slug is valid
  if (!outline.slug || outline.slug.length < 3) {
    outline.slug = slugify(outline.title);
  }

  logger.debug('Outline generated', {
    title: outline.title,
    sectionCount: outline.sections.length,
    componentCount: outline.interactiveComponents.length,
  });

  return outline;
}

function buildOutlinePrompt(
  context: GenerationContext,
  voice: VoiceAnalysis,
  research: ResearchResult
): string {
  const { discoveredPost, niche } = context;

  return `Create a detailed content outline for an educational article addressing this developer's question.

ORIGINAL QUESTION:
Title: ${discoveredPost.title}
Content: ${discoveredPost.content.substring(0, 2000)}
Source: ${discoveredPost.sourceUrl}

VOICE ANALYSIS:
- Experience Level: ${voice.experienceLevel}
- Communication Style: ${voice.communicationStyle}
- Preferred Format: ${voice.preferredFormat}
- Terminology Level: ${voice.terminologyLevel}
- Learning Goals: ${voice.learningGoals.join(', ')}
- Frustration Points: ${voice.frustrationPoints.join(', ')}

RESEARCH SUMMARY:
${research.summary}

Key Points:
${research.keyPoints.map(p => `- ${p}`).join('\n')}

Best Practices:
${research.bestPractices.map(p => `- ${p}`).join('\n')}

NICHE CONTEXT:
- Niche: ${niche.name}
${niche.voiceGuidelines ? `- Voice Guidelines: ${niche.voiceGuidelines}` : ''}
${niche.targetAudience ? `- Target Audience: ${niche.targetAudience}` : ''}

Create a JSON outline:
{
  "title": "<compelling, SEO-friendly title>",
  "slug": "<url-slug-format>",
  "description": "<meta description, 150-160 chars>",
  "targetAudience": "<who this article is for>",
  "sections": [
    {
      "heading": "<section heading>",
      "type": "<'intro' | 'concept' | 'example' | 'code' | 'comparison' | 'summary' | 'interactive'>",
      "keyPoints": ["<point 1>", "<point 2>", ...],
      "estimatedLength": <word count>,
      "componentSuggestion": "<optional: type of interactive component that would help>"
    },
    ...
  ],
  "interactiveComponents": [
    {
      "type": "<'quiz' | 'playground' | 'diagram' | 'calculator' | 'comparison-table'>",
      "purpose": "<what it teaches/demonstrates>",
      "placement": "<which section it goes in>",
      "requirements": ["<requirement 1>", ...]
    },
    ...
  ],
  "seoKeywords": ["<keyword 1>", "<keyword 2>", ...],
  "estimatedReadTime": <minutes>
}

REQUIREMENTS:
1. Title should be compelling and include main keyword (can be a question like "How to..." or "What is...")
2. Include 5-8 sections with varied types
3. Suggest 1-3 interactive components that would genuinely help learning
4. Match the voice analysis - ${voice.experienceLevel} level, ${voice.preferredFormat} format
5. Address the frustration points directly
6. Target 1500-2500 words total

GEO/AEO OPTIMIZATION (CRITICAL):
- FIRST section MUST be "Key Takeaways" (type: "summary") with 3-5 key points
- Section headings should be QUESTIONS: "What is X?", "How do you Y?", "Why does Z matter?"
- LAST section MUST be "Frequently Asked Questions" (type: "summary") with 3-5 Q&A pairs
- Each section's keyPoints should start with a direct answer to the heading question
- This structure optimizes for AI search engines (Google AI Overviews, ChatGPT, Perplexity)

IMPORTANT - NO PROMOTIONAL CONTENT:
- NEVER include vendor/product names in the title (no "Site24x7", "Datadog", "New Relic", etc.)
- Focus on generic solutions and open-source tools (like OpenTelemetry)
- If the source mentions a specific product, extract the general concept instead
- Title should be about the PROBLEM or SOLUTION, not about a vendor
- Example BAD: "How Site24x7 Solves Observability"
- Example GOOD: "Solving Common Observability Challenges"`;
}
