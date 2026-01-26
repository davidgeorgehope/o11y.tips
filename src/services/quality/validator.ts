import * as esbuild from 'esbuild';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { analyzeSEO, type SEOAnalysis } from './seo.js';
import { analyzeSlop, deslopIfNeeded, type SlopAnalysis } from './deslop.js';

const logger = createLogger('quality:validator');

export interface ValidationResult {
  isValid: boolean;
  seo: {
    passed: boolean;
    score: number;
    analysis: SEOAnalysis;
  };
  slop: {
    passed: boolean;
    score: number;
    analysis: SlopAnalysis;
  };
  components: {
    passed: boolean;
    errors: string[];
  };
  content: {
    passed: boolean;
    issues: string[];
  };
  suggestions: string[];
}

export interface ContentToValidate {
  title: string;
  description: string;
  content: string;
  keywords: string[];
  components?: Array<{ code: string; name: string }>;
}

export async function validateContent(input: ContentToValidate): Promise<ValidationResult> {
  logger.debug('Validating content', { title: input.title });

  // Run all validations in parallel
  const [seoResult, slopResult, componentResult, contentResult] = await Promise.all([
    validateSEO(input),
    validateSlop(input.content),
    validateComponents(input.components || []),
    validateContentStructure(input.content),
  ]);

  const isValid =
    seoResult.passed &&
    slopResult.passed &&
    componentResult.passed &&
    contentResult.passed;

  const suggestions: string[] = [];

  if (!seoResult.passed) {
    suggestions.push(`SEO score (${seoResult.score}) below threshold (${config.quality.minSeoScore})`);
  }

  if (!slopResult.passed) {
    suggestions.push(`Slop score (${slopResult.score}) above threshold (${config.quality.maxSlopScore})`);
  }

  if (componentResult.errors.length > 0) {
    suggestions.push('Fix component validation errors');
  }

  suggestions.push(...contentResult.issues);

  const result: ValidationResult = {
    isValid,
    seo: seoResult,
    slop: slopResult,
    components: componentResult,
    content: contentResult,
    suggestions,
  };

  logger.debug('Validation complete', { isValid, seoScore: seoResult.score, slopScore: slopResult.score });
  return result;
}

async function validateSEO(input: ContentToValidate): Promise<ValidationResult['seo']> {
  const analysis = await analyzeSEO(
    input.title,
    input.description,
    input.content,
    input.keywords
  );

  return {
    passed: analysis.score >= config.quality.minSeoScore,
    score: analysis.score,
    analysis,
  };
}

async function validateSlop(content: string): Promise<ValidationResult['slop']> {
  const analysis = await analyzeSlop(content);

  return {
    passed: analysis.score <= config.quality.maxSlopScore,
    score: analysis.score,
    analysis,
  };
}

async function validateComponents(
  components: Array<{ code: string; name: string }>
): Promise<ValidationResult['components']> {
  const errors: string[] = [];

  for (const component of components) {
    try {
      await esbuild.transform(component.code, {
        loader: 'tsx',
        target: 'es2020',
        jsx: 'automatic',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${component.name}: ${message}`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

async function validateContentStructure(content: string): Promise<ValidationResult['content']> {
  const issues: string[] = [];

  // Check word count
  const wordCount = content.split(/\s+/).length;
  if (wordCount < 500) {
    issues.push(`Content too short: ${wordCount} words (minimum 500)`);
  }

  // Check heading structure
  const h1Count = (content.match(/^#\s/gm) || []).length;
  const h2Count = (content.match(/^##\s/gm) || []).length;

  if (h1Count > 1) {
    issues.push('Multiple H1 headings detected');
  }

  if (h2Count < 2) {
    issues.push('Content needs more section headings (H2)');
  }

  // Check for code blocks in technical content
  const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
  if (codeBlocks.length === 0 && content.toLowerCase().includes('code')) {
    issues.push('Technical content mentions code but has no code examples');
  }

  // Check for broken markdown
  const unclosedCodeBlocks = (content.match(/```/g) || []).length;
  if (unclosedCodeBlocks % 2 !== 0) {
    issues.push('Unclosed code block detected');
  }

  // Check for empty sections
  const emptySections = content.match(/^##\s+.+\n\n##/gm);
  if (emptySections) {
    issues.push('Empty sections detected');
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

export async function autoFixContent(
  input: ContentToValidate
): Promise<{ content: string; fixes: string[] }> {
  const fixes: string[] = [];
  let content = input.content;

  // Fix slop if needed
  const { content: deslopped, wasDeslopped, analysis } = await deslopIfNeeded(
    content,
    config.quality.maxSlopScore
  );

  if (wasDeslopped) {
    content = deslopped;
    fixes.push(`Reduced slop score from ${analysis.score} to acceptable level`);
  }

  return { content, fixes };
}
