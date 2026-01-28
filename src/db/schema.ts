import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Niches table - defines content verticals
export const niches = sqliteTable('niches', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  voiceGuidelines: text('voice_guidelines'),
  targetAudience: text('target_audience'),
  keywords: text('keywords'), // JSON array
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Discovery schedules - configured sources for finding pain points
export const discoverySchedules = sqliteTable('discovery_schedules', {
  id: text('id').primaryKey(),
  nicheId: text('niche_id').notNull().references(() => niches.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(), // 'grounded_search' | 'reddit' | 'stackoverflow' | 'hackernews' | 'github'
  config: text('config').notNull(), // JSON configuration for the source
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Discovered posts - raw pain point discoveries
export const discoveredPosts = sqliteTable('discovered_posts', {
  id: text('id').primaryKey(),
  nicheId: text('niche_id').notNull().references(() => niches.id, { onDelete: 'cascade' }),
  scheduleId: text('schedule_id').references(() => discoverySchedules.id, { onDelete: 'set null' }),
  sourceType: text('source_type').notNull(),
  sourceUrl: text('source_url').notNull(),
  sourceId: text('source_id'), // Original ID from source platform
  title: text('title').notNull(),
  content: text('content').notNull(),
  author: text('author'),
  authorLevel: text('author_level'), // 'beginner' | 'intermediate' | 'advanced'
  metadata: text('metadata'), // JSON additional data from source
  painScore: real('pain_score'), // 0-100 scoring of pain point quality
  painAnalysis: text('pain_analysis'), // JSON analysis details
  status: text('status').notNull().default('pending'), // 'pending' | 'queued' | 'processing' | 'completed' | 'rejected'
  rejectionReason: text('rejection_reason'),
  contentHash: text('content_hash').notNull(), // For deduplication
  discoveredAt: text('discovered_at').notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Generation jobs - track content generation pipeline
export const generationJobs = sqliteTable('generation_jobs', {
  id: text('id').primaryKey(),
  discoveredPostId: text('discovered_post_id').notNull().references(() => discoveredPosts.id, { onDelete: 'cascade' }),
  nicheId: text('niche_id').notNull().references(() => niches.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // 'pending' | 'voice' | 'research' | 'outline' | 'content' | 'components' | 'images' | 'quality' | 'completed' | 'failed'
  currentStep: text('current_step'),
  progress: integer('progress').default(0), // 0-100
  voiceAnalysis: text('voice_analysis'), // JSON
  research: text('research'), // JSON
  outline: text('outline'), // JSON
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  retryCount: integer('retry_count').default(0),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Content - generated articles
export const content = sqliteTable('content', {
  id: text('id').primaryKey(),
  nicheId: text('niche_id').notNull().references(() => niches.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => generationJobs.id, { onDelete: 'set null' }),
  discoveredPostId: text('discovered_post_id').references(() => discoveredPosts.id, { onDelete: 'set null' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  content: text('content').notNull(), // Markdown content
  components: text('components'), // JSON array of component definitions
  componentBundle: text('component_bundle'), // Bundled JS for interactive components
  componentStatus: text('component_status'), // JSON array of component generation results
  seoScore: real('seo_score'),
  seoAnalysis: text('seo_analysis'), // JSON
  slopScore: real('slop_score'),
  slopAnalysis: text('slop_analysis'), // JSON
  status: text('status').notNull().default('draft'), // 'draft' | 'review' | 'approved' | 'published' | 'archived'
  reviewNotes: text('review_notes'),
  publishedAt: text('published_at'),
  publishedUrl: text('published_url'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Images - generated images for content
export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  contentId: text('content_id').notNull().references(() => content.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'hero' | 'inline' | 'diagram'
  prompt: text('prompt').notNull(),
  altText: text('alt_text'),
  filename: text('filename'),
  filePath: text('file_path'),
  width: integer('width'),
  height: integer('height'),
  mimeType: text('mime_type'),
  status: text('status').notNull().default('pending'), // 'pending' | 'generating' | 'completed' | 'failed'
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Settings - global and niche-specific settings
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  nicheId: text('niche_id').references(() => niches.id, { onDelete: 'cascade' }), // null for global settings
  key: text('key').notNull(),
  value: text('value').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Type exports
export type Niche = typeof niches.$inferSelect;
export type NewNiche = typeof niches.$inferInsert;

export type DiscoverySchedule = typeof discoverySchedules.$inferSelect;
export type NewDiscoverySchedule = typeof discoverySchedules.$inferInsert;

export type DiscoveredPost = typeof discoveredPosts.$inferSelect;
export type NewDiscoveredPost = typeof discoveredPosts.$inferInsert;

export type GenerationJob = typeof generationJobs.$inferSelect;
export type NewGenerationJob = typeof generationJobs.$inferInsert;

export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
