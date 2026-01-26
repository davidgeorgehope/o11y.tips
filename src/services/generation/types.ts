export interface VoiceAnalysis {
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
  communicationStyle: 'formal' | 'casual' | 'technical';
  preferredFormat: 'step-by-step' | 'conceptual' | 'example-heavy';
  terminologyLevel: 'basic' | 'intermediate' | 'expert';
  learningGoals: string[];
  frustrationPoints: string[];
  backgroundAssumptions: string[];
}

export interface ResearchResult {
  topic: string;
  summary: string;
  keyPoints: string[];
  sources: Array<{
    title: string;
    url: string;
    relevance: string;
  }>;
  relatedTopics: string[];
  bestPractices: string[];
  commonMistakes: string[];
}

export interface ContentOutline {
  title: string;
  slug: string;
  description: string;
  targetAudience: string;
  sections: Array<{
    heading: string;
    type: 'intro' | 'concept' | 'example' | 'code' | 'comparison' | 'summary' | 'interactive';
    keyPoints: string[];
    estimatedLength: number;
    componentSuggestion?: string;
  }>;
  interactiveComponents: Array<{
    type: 'quiz' | 'playground' | 'diagram' | 'calculator' | 'comparison-table';
    purpose: string;
    placement: string;
    requirements: string[];
  }>;
  seoKeywords: string[];
  estimatedReadTime: number;
}

export interface GeneratedContent {
  title: string;
  slug: string;
  description: string;
  content: string; // Markdown
  sections: Array<{
    heading: string;
    content: string;
    componentPlaceholder?: string;
  }>;
}

export interface GeneratedComponent {
  id: string;
  type: string;
  name: string;
  code: string;
  props: Record<string, unknown>;
  exports: string[];
}

export interface ImageSpec {
  type: 'hero' | 'inline' | 'diagram';
  prompt: string;
  altText: string;
  placement: string;
  aspectRatio: '1:1' | '16:9' | '4:3';
}

export interface GenerationContext {
  jobId: string;
  nicheId: string;
  discoveredPost: {
    id: string;
    title: string;
    content: string;
    sourceUrl: string;
    author?: string;
    authorLevel?: string;
    painAnalysis?: string;
  };
  niche: {
    name: string;
    voiceGuidelines?: string;
    targetAudience?: string;
    keywords?: string[];
  };
}

export interface GenerationStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: unknown;
}

export interface GenerationProgress {
  jobId: string;
  currentStep: string;
  progress: number;
  steps: GenerationStep[];
}
