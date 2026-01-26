import { generateJSON } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('quality:seo');

export interface SEOAnalysis {
  score: number;
  title: {
    score: number;
    length: number;
    hasKeyword: boolean;
    suggestions: string[];
  };
  description: {
    score: number;
    length: number;
    hasKeyword: boolean;
    suggestions: string[];
  };
  content: {
    wordCount: number;
    headingStructure: boolean;
    keywordDensity: number;
    readabilityScore: number;
    internalLinks: number;
    externalLinks: number;
  };
  keywords: {
    primary: string;
    secondary: string[];
    missing: string[];
  };
  issues: Array<{
    severity: 'high' | 'medium' | 'low';
    issue: string;
    recommendation: string;
  }>;
  geoFactors: {
    entityRecognition: boolean;
    structuredData: boolean;
    citationQuality: number;
  };
}

export async function analyzeSEO(
  title: string,
  description: string,
  content: string,
  targetKeywords: string[]
): Promise<SEOAnalysis> {
  logger.debug('Analyzing SEO', { title, keywords: targetKeywords });

  // Basic metrics
  const wordCount = content.split(/\s+/).length;
  const headings = content.match(/^#{1,6}\s.+$/gm) || [];
  const links = content.match(/\[.+?\]\(.+?\)/g) || [];

  // AI-powered analysis
  const prompt = buildSEOPrompt(title, description, content, targetKeywords);

  const response = await generateJSON<SEOAnalysis>(prompt, {
    model: 'gemini-flash',
    temperature: 0.2,
    systemPrompt: `You are an SEO expert analyzing content for search optimization.
Provide detailed, actionable analysis focused on both traditional SEO and GEO (Generative Engine Optimization).
Score on a 0-100 scale where higher is better.`,
  });

  const analysis = response.content;

  // Merge computed metrics
  analysis.content.wordCount = wordCount;
  analysis.content.headingStructure = headings.length >= 3;
  analysis.content.internalLinks = links.filter(l => !l.includes('http')).length;
  analysis.content.externalLinks = links.filter(l => l.includes('http')).length;

  // Calculate overall score
  analysis.score = calculateOverallScore(analysis);

  logger.debug('SEO analysis complete', { score: analysis.score });
  return analysis;
}

function buildSEOPrompt(
  title: string,
  description: string,
  content: string,
  targetKeywords: string[]
): string {
  return `Analyze this content for SEO and GEO (Generative Engine Optimization).

TITLE: ${title}
DESCRIPTION: ${description}

TARGET KEYWORDS: ${targetKeywords.join(', ')}

CONTENT (first 3000 chars):
${content.substring(0, 3000)}

Provide JSON analysis:
{
  "score": <overall score 0-100>,
  "title": {
    "score": <0-100>,
    "length": ${title.length},
    "hasKeyword": <boolean>,
    "suggestions": ["<suggestion>", ...]
  },
  "description": {
    "score": <0-100>,
    "length": ${description.length},
    "hasKeyword": <boolean>,
    "suggestions": ["<suggestion>", ...]
  },
  "content": {
    "wordCount": 0,
    "headingStructure": true,
    "keywordDensity": <percentage>,
    "readabilityScore": <0-100>,
    "internalLinks": 0,
    "externalLinks": 0
  },
  "keywords": {
    "primary": "<identified primary keyword>",
    "secondary": ["<secondary keyword>", ...],
    "missing": ["<important keywords not used>", ...]
  },
  "issues": [
    {
      "severity": "<'high' | 'medium' | 'low'>",
      "issue": "<what's wrong>",
      "recommendation": "<how to fix>"
    }
  ],
  "geoFactors": {
    "entityRecognition": <boolean - does content clearly define entities>,
    "structuredData": <boolean - suitable for structured data markup>,
    "citationQuality": <0-100 - how well sources are cited>
  }
}

ANALYSIS CRITERIA:
1. Title: 50-60 chars ideal, keyword near front
2. Description: 150-160 chars, compelling, includes keyword
3. Content: 1500+ words, proper H2/H3 structure, 1-2% keyword density
4. GEO: Clear entity definitions, factual claims with sources, structured format`;
}

function calculateOverallScore(analysis: SEOAnalysis): number {
  const weights = {
    title: 0.15,
    description: 0.10,
    content: 0.40,
    keywords: 0.15,
    geo: 0.20,
  };

  const contentScore =
    (analysis.content.readabilityScore * 0.3) +
    (analysis.content.headingStructure ? 30 : 0) +
    (analysis.content.keywordDensity > 0.5 && analysis.content.keywordDensity < 3 ? 20 : 0) +
    (analysis.content.wordCount > 1500 ? 20 : analysis.content.wordCount / 75);

  const keywordScore = analysis.keywords.missing.length === 0 ? 100 :
    Math.max(0, 100 - (analysis.keywords.missing.length * 20));

  const geoScore =
    (analysis.geoFactors.entityRecognition ? 40 : 0) +
    (analysis.geoFactors.structuredData ? 30 : 0) +
    (analysis.geoFactors.citationQuality * 0.3);

  return Math.round(
    (analysis.title.score * weights.title) +
    (analysis.description.score * weights.description) +
    (contentScore * weights.content) +
    (keywordScore * weights.keywords) +
    (geoScore * weights.geo)
  );
}

export function generateSEOSuggestions(analysis: SEOAnalysis): string[] {
  const suggestions: string[] = [];

  if (analysis.title.score < 80) {
    suggestions.push(...analysis.title.suggestions);
  }

  if (analysis.description.score < 80) {
    suggestions.push(...analysis.description.suggestions);
  }

  for (const issue of analysis.issues) {
    if (issue.severity === 'high') {
      suggestions.push(`${issue.issue}: ${issue.recommendation}`);
    }
  }

  if (analysis.keywords.missing.length > 0) {
    suggestions.push(`Consider including these keywords: ${analysis.keywords.missing.join(', ')}`);
  }

  return suggestions;
}
