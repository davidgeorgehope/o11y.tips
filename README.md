# Pain Point Content Engine

A configurable, multi-niche automated content engine that discovers practitioner pain points from various sources, generates high-quality interactive educational content, and provides an admin UI for review and publishing.

## Features

- **Multi-Source Discovery**: Find developer pain points from Reddit, Stack Overflow, Hacker News, GitHub Issues, and Google Search
- **AI-Powered Content Generation**: Use Claude for code/components and Gemini for content
- **Quality Pipeline**: SEO optimization, slop detection, and automated validation
- **Interactive Components**: Generate React components for quizzes, playgrounds, and diagrams
- **Admin UI**: Full-featured React admin panel for content management
- **Static Publishing**: Generate optimized static HTML with bundled components

## Quick Start

### Prerequisites

- Node.js 20+
- API keys for Anthropic (Claude) and Google AI (Gemini)

### Installation

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Edit .env with your API keys
vim .env

# Initialize database
npm run db:push

# Start development server
npm run dev
```

### Admin UI

1. Access admin panel at `http://localhost:3001/admin`
2. Login with credentials from `.env` (default: admin/admin)
3. Create a niche and configure discovery sources
4. Run discovery to find pain points
5. Queue posts for content generation
6. Review and publish generated content

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Discovery     │────▶│   Generation    │────▶│   Publishing    │
│   Pipeline      │     │   Pipeline      │     │   Pipeline      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  - Reddit       │     │  - Voice        │     │  - HTML Build   │
│  - Stack OF     │     │  - Research     │     │  - Component    │
│  - HN           │     │  - Outline      │     │    Bundle       │
│  - GitHub       │     │  - Content      │     │  - Sitemap      │
│  - Grounded     │     │  - Components   │     │  - Index Pages  │
│    Search       │     │  - Images       │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Configuration

### Environment Variables

```env
# API Keys
ANTHROPIC_API_KEY=     # Required for component generation
GOOGLE_AI_API_KEY=     # Required for content generation

# Optional
GITHUB_TOKEN=          # For GitHub Issues discovery
```

### Quality Thresholds

- `MAX_SLOP_SCORE=5`: Maximum AI writing pattern score (0-10)
- `MIN_SEO_SCORE=70`: Minimum SEO score (0-100)
- `MIN_PAIN_SCORE=60`: Minimum pain score for discovery (0-100)

## API Routes

### Public API

- `GET /api/niches` - List active niches
- `GET /api/niches/:slug/articles` - List published articles
- `GET /api/articles/:nicheSlug/:articleSlug` - Get single article

### Admin API (requires auth)

- `GET/POST/PUT/DELETE /api/admin/niches` - Niche management
- `GET/POST/PUT/DELETE /api/admin/schedules` - Discovery schedules
- `GET/POST /api/admin/discovery` - Discovery queue
- `GET/POST /api/admin/jobs` - Generation jobs
- `GET/PUT/POST /api/admin/content` - Content management
- `GET/PUT /api/admin/settings` - Settings

## Skills

### /stop-slop

Remove AI writing patterns from content. See `skills/stop-slop/SKILL.md`.

### /seo

Analyze content for SEO and GEO optimization. See `skills/seo-geo/SKILL.md`.

## Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck

# Database management
npm run db:generate  # Generate migrations
npm run db:migrate   # Run migrations
npm run db:studio    # Open Drizzle Studio
```

## Production Deployment

```bash
# Build everything
npm run build

# Start with PM2
pm2 start ecosystem.config.js --env production

# Or run directly
NODE_ENV=production npm start
```

## License

MIT
