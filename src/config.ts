import { join } from 'path';

// Load environment variables
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for environment variable: ${key}`);
  }
  return parsed;
}

export const config = {
  // Author (single-author site)
  author: {
    name: 'David George Hope',
    email: 'me@davidgeorgehope.com',
    linkedin: 'https://linkedin.com/in/davidgeorgehope',
    twitter: 'hopedj',
    bio: 'Director of Product Marketing for Observability at Elastic',
    website: 'https://davidgeorgehope.com',
  },

  // Database
  database: {
    url: getEnv('DATABASE_URL', './data/content-engine.db'),
  },

  // API Keys
  apiKeys: {
    anthropic: getEnv('ANTHROPIC_API_KEY', ''),
    googleAi: getEnv('GOOGLE_AI_API_KEY', ''),
    github: getEnv('GITHUB_TOKEN', ''),
  },

  // Server
  server: {
    port: getEnvNumber('PORT', 3001),
    host: getEnv('HOST', '0.0.0.0'),
    nodeEnv: getEnv('NODE_ENV', 'development'),
  },

  // Admin Authentication
  admin: {
    username: getEnv('ADMIN_USERNAME', 'admin'),
    password: getEnv('ADMIN_PASSWORD', 'admin'),
    jwtSecret: getEnv('JWT_SECRET', 'change-this-secret-in-production'),
    jwtExpiresIn: '7d',
  },

  // Content Output
  output: {
    dir: getEnv('OUTPUT_DIR', './output'),
    publicUrl: getEnv('PUBLIC_URL', 'http://localhost:3001'),
  },

  // Job Settings
  jobs: {
    discoveryCron: getEnv('DISCOVERY_CRON', '0 */4 * * *'),
    generationCron: getEnv('GENERATION_CRON', '*/15 * * * *'),
    cleanupCron: getEnv('CLEANUP_CRON', '0 3 * * *'),
  },

  // Quality Thresholds
  quality: {
    maxSlopScore: getEnvNumber('MAX_SLOP_SCORE', 5),
    minSeoScore: getEnvNumber('MIN_SEO_SCORE', 70),
  },

  // AI Model Configuration
  ai: {
    claude: {
      model: 'claude-opus-4-5-20251101',
      maxTokens: 21000, // SDK limits non-streaming to ~21K (10 min timeout)
    },
    gemini: {
      flashModel: 'gemini-3-flash-preview',
      proModel: 'gemini-3-pro-preview',
      imageModel: 'gemini-3-pro-image-preview',
    },
  },

  // Discovery Settings
  discovery: {
    maxPostsPerRun: getEnvNumber('MAX_POSTS_PER_RUN', 50),
    minPainScore: getEnvNumber('MIN_PAIN_SCORE', 60),
    deduplicationWindowDays: getEnvNumber('DEDUPLICATION_WINDOW_DAYS', 30),
  },

  // Generation Settings
  generation: {
    maxConcurrentJobs: getEnvNumber('MAX_CONCURRENT_JOBS', 3),
    maxRetries: getEnvNumber('MAX_GENERATION_RETRIES', 3),
  },

  // Paths
  paths: {
    templates: join(process.cwd(), 'templates'),
    output: join(process.cwd(), getEnv('OUTPUT_DIR', './output')),
    data: join(process.cwd(), 'data'),
  },
};

// Validate configuration
export function validateConfig(): void {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!config.apiKeys.anthropic) {
    warnings.push('ANTHROPIC_API_KEY not set - Claude features will be disabled');
  }

  if (!config.apiKeys.googleAi) {
    warnings.push('GOOGLE_AI_API_KEY not set - Gemini features will be disabled');
  }

  if (config.admin.password === 'admin') {
    warnings.push('Using default admin password - please change ADMIN_PASSWORD in production');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  if (warnings.length > 0 && config.server.nodeEnv !== 'test') {
    console.warn('Configuration warnings:');
    warnings.forEach(w => console.warn(`  - ${w}`));
  }
}

export default config;
