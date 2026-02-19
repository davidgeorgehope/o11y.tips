import { generateWithGemini } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import type { GeneratedContent, ContentOutline, GenerationContext, VoiceAnalysis, ResearchResult } from './types.js';

const logger = createLogger('generation:content');

export async function generateContent(
  context: GenerationContext,
  voiceAnalysis: VoiceAnalysis,
  research: ResearchResult,
  outline: ContentOutline
): Promise<GeneratedContent> {
  logger.debug('Generating content', { title: outline.title });

  const prompt = buildContentPrompt(context, voiceAnalysis, research, outline);

  const response = await generateWithGemini(prompt, {
    model: 'pro',
    temperature: 0.7,
    maxTokens: 8192,
    systemPrompt: buildSystemPrompt(voiceAnalysis, context.niche),
  });

  // Parse the generated content
  const content = parseGeneratedContent(response.content, outline);

  logger.debug('Content generated', {
    title: content.title,
    contentLength: content.content.length,
  });

  return content;
}

function buildSystemPrompt(voice: VoiceAnalysis, niche: { name: string; voiceGuidelines?: string }): string {
  return `You are an expert technical writer creating educational content optimized for AI search engines and answer engines.

VOICE REQUIREMENTS:
- Write for ${voice.experienceLevel} level developers
- Use ${voice.communicationStyle} tone
- Use ${voice.terminologyLevel} level terminology
- Focus on ${voice.preferredFormat} explanations

${niche.voiceGuidelines ? `BRAND VOICE GUIDELINES:\n${niche.voiceGuidelines}` : ''}

GEO/AEO OPTIMIZATION (CRITICAL):
Your content must be optimized for Generative Engine Optimization (GEO) and Answer Engine Optimization (AEO) to perform well in AI-powered search (Google AI Overviews, ChatGPT, Perplexity, etc.).

1. DIRECT ANSWERS FIRST:
   - Start each section with a clear, concise 1-2 sentence answer
   - Put the key information in the first paragraph
   - Follow with elaboration and details

2. QUESTION-BASED HEADINGS:
   - Use "What is X?", "How do you Y?", "Why does Z?" format for headings
   - These match how users query AI assistants
   - Each heading should be a complete, searchable question

3. DEFINITION CALLOUTS:
   - Include clear definitions in blockquotes (> **Definition:** ...)
   - Make key terms easily extractable
   - Use bold for terms being defined

4. STRUCTURED DATA:
   - Use numbered lists for sequential steps
   - Use bullet points for non-sequential items
   - Use tables for comparisons
   - Each list item should be self-contained and meaningful

5. KEY TAKEAWAYS:
   - Include a "Key Takeaways" or "Summary" section
   - Use bullet points with complete, standalone statements
   - These should answer the main question independently

6. SPECIFIC CLAIMS:
   - Include concrete numbers, metrics, and specifics
   - Avoid vague qualifiers ("usually", "often", "sometimes")
   - Be precise and definitive where possible

7. FAQ SECTION:
   - End with 3-5 frequently asked questions
   - Each answer should be 2-3 sentences max
   - Answers should be direct and complete

CONTENT QUALITY STANDARDS:
- Be specific and practical
- Include real-world examples
- Avoid generic filler content
- Every sentence should add value
- Use active voice
- Break up long paragraphs
- Use code examples where appropriate

AVOID:
- Vague statements like "it depends"
- Starting paragraphs with "Let's" or "Now let's"
- Overusing transition words
- Unnecessary hedging
- Marketing language
- Clichés and buzzwords
- Starting with "In today's..." or "In the world of..."

CRITICAL - NO VENDOR PROMOTION:
- NEVER promote specific vendor products (Site24x7, Datadog, New Relic, Splunk, etc.)
- NEVER include "sign up", "try now", "get started with [vendor]" language
- If source material mentions a vendor solution, describe the GENERAL approach instead
- Focus on open standards (OpenTelemetry) and generic solutions
- It's OK to mention vendor names when comparing options objectively, but never promote them`;
}

function buildContentPrompt(
  context: GenerationContext,
  _voice: VoiceAnalysis,
  research: ResearchResult,
  outline: ContentOutline
): string {
  const { discoveredPost } = context;

  return `Write a comprehensive article following this outline exactly.

ORIGINAL QUESTION BEING ANSWERED:
${discoveredPost.title}
${discoveredPost.content.substring(0, 1500)}

RESEARCH:
${research.summary}

Key Points to Cover:
${research.keyPoints.map(p => `- ${p}`).join('\n')}

Best Practices to Include:
${research.bestPractices.map(p => `- ${p}`).join('\n')}

Common Mistakes to Address:
${research.commonMistakes.map(p => `- ${p}`).join('\n')}

OUTLINE TO FOLLOW:
Title: ${outline.title}

Sections:
${outline.sections.map((s, i) => {
    // Match section to interactiveComponent by placement to get the authoritative type
    const matchedComponent = outline.interactiveComponents.find(
      c => c.placement === s.heading
    );
    const componentHint = matchedComponent
      ? `[INSERT HERE: {{COMPONENT:${matchedComponent.type}:${matchedComponent.purpose}}}]`
      : '';
    return `
${i + 1}. ${s.heading} (${s.type})
   Key points: ${s.keyPoints.join(', ')}
   Length: ~${s.estimatedLength} words
   ${componentHint}`;
  }).join('\n')}

FORMATTING REQUIREMENTS:
- Use Markdown formatting
- Use ## for main section headings (prefer question format: "What is X?", "How do you Y?")
- Use ### for subsections
- Use \`code\` for inline code
- Use \`\`\` for code blocks with language specified
- Use bullet points for lists
- Use > for important callouts and definitions (> **Definition:** ...)
- Use tables for comparisons

GEO/AEO STRUCTURE REQUIREMENTS:
1. Start with a "Key Takeaways" section (3-5 bullet points summarizing the main answers)
2. Each main section should start with a direct 1-2 sentence answer
3. Include a definition blockquote for key terms: > **Definition:** Term is...
4. End with "## Frequently Asked Questions" section containing 3-5 Q&A pairs
5. FAQ format:
   ### Question here?
   Direct answer in 2-3 sentences.

COMPONENT PLACEHOLDERS:
Where interactive components are suggested, insert a placeholder like:
{{COMPONENT:component-type:description}}

You MUST use the EXACT component types listed below. Do NOT invent your own types.
${outline.interactiveComponents.length > 0 ? `
COMPONENTS TO PLACE (use these exact types and placements):
${outline.interactiveComponents.map(c => `- Type: "${c.type}" | Placement: "${c.placement}" | Purpose: ${c.purpose}
  Insert as: {{COMPONENT:${c.type}:${c.purpose}}}`).join('\n')}
` : `
Example:
{{COMPONENT:quiz:Test your understanding of the key concepts}}
{{COMPONENT:playground:Try modifying the code example}}`}

OUTPUT:
Write the complete article in Markdown. Start with the title as # heading.
Do not include meta description or keywords - just the article content.
Remember: Direct answers first, question-based headings, end with FAQ.`;
}

function parseGeneratedContent(rawContent: string, outline: ContentOutline): GeneratedContent {
  // Clean up the content
  let content = rawContent.trim();

  // Extract title from content if present
  const titleMatch = content.match(/^#\s+(.+?)$/m);
  const title = titleMatch ? titleMatch[1].trim() : outline.title;

  // Remove the title line from content (we'll add it back in template)
  content = content.replace(/^#\s+.+?\n+/, '');

  // Parse sections
  const sections: Array<{ heading: string; content: string; componentPlaceholder?: string }> = [];

  const sectionRegex = /^##\s+(.+?)$([\s\S]*?)(?=^##\s|\Z)/gm;
  let match;

  while ((match = sectionRegex.exec(content)) !== null) {
    const heading = match[1].trim();
    let sectionContent = match[2].trim();

    // Extract component placeholder if present
    const componentMatch = sectionContent.match(/\{\{COMPONENT:([^:]+):([^}]+)\}\}/);
    let componentPlaceholder: string | undefined;

    if (componentMatch) {
      componentPlaceholder = `${componentMatch[1]}:${componentMatch[2]}`;
      sectionContent = sectionContent.replace(componentMatch[0], '').trim();
    }

    sections.push({
      heading,
      content: sectionContent,
      componentPlaceholder,
    });
  }

  // If no sections parsed, treat whole content as one section
  if (sections.length === 0) {
    sections.push({
      heading: 'Content',
      content,
    });
  }

  return {
    title,
    slug: outline.slug,
    description: outline.description,
    content,
    sections,
  };
}
