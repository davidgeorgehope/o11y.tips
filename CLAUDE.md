# o11y.tips Content Engine

A multi-niche automated content engine for discovering pain points and generating educational observability content.

## Quick Reference

### Server Management

```bash
# Restart server (after code changes)
npm run build && pm2 restart o11ytips --update-env

# View logs
pm2 logs o11ytips --lines 50

# Check status
pm2 status
```

### Regenerate Index Pages

```bash
# Regenerate main index
node --import tsx -e "
import 'dotenv/config';
import { generateIndexPage } from './src/services/publisher/index-generator.js';
generateIndexPage().then(() => console.log('Done'));
"

# Regenerate niche index (replace NICHE_ID)
node --import tsx -e "
import 'dotenv/config';
import { generateNicheIndexPage } from './src/services/publisher/index-generator.js';
generateNicheIndexPage('NICHE_ID').then(() => console.log('Done'));
"
```

## Architecture

### Routes

| Route | Description |
|-------|-------------|
| `/` | Public landing page (from `output/index.html`) |
| `/:niche` | Niche index page (e.g., `/observability`) |
| `/:niche/:slug` | Article page (e.g., `/observability/kubernetes-observability-simplified`) |
| `/admin` | Admin UI for content management |
| `/api/*` | REST API endpoints |
| `/output/*` | Static files (images, raw HTML files) |

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main server entry point, route definitions |
| `src/services/publisher/index-generator.ts` | Generates landing page HTML |
| `src/services/publisher/article-publisher.ts` | Publishes individual articles |
| `src/config.ts` | Configuration from environment variables |

### Landing Page Design

The public landing page (`/`) features:
- **Header**: o11y.tips branding with tagline
- **Hero Section**: Latest published article with large card, hero image, topic tag
- **Article Grid**: Remaining articles in responsive 3-column card grid
- **Footer**: Copyright and topic navigation links

Color scheme uses sky/teal blues:
- Primary: `#0ea5e9` (sky-500)
- Accent: `#14b8a6` (teal-500)

### Database

SQLite database at `./data/content-engine.db` with tables:
- `niches` - Content verticals (e.g., Observability)
- `content` - Generated articles
- `images` - Hero and inline images
- `discovered_posts` - Pain points from discovery
- `generation_jobs` - Content generation pipeline

### Environment Variables

Key settings in `.env`:
- `PUBLIC_URL` - Canonical URL for SEO (https://o11y.tips)
- `PORT` - Server port (3005)
- `ANTHROPIC_API_KEY` - Claude API key
- `GOOGLE_AI_API_KEY` - Gemini API key for images

## Common Tasks

### After Code Changes
```bash
npm run build && pm2 restart o11ytips --update-env
```

### Build/Publish an Article
```bash
# Build article HTML (replace CONTENT_ID with actual ID)
node --import tsx -e "
import 'dotenv/config';
import { buildArticle } from './src/services/publisher/builder.js';
buildArticle('CONTENT_ID').then(console.log);
"
```

### View Published Articles
```bash
ls -la output/
```

### Check Database
```bash
sqlite3 data/content-engine.db ".tables"
sqlite3 data/content-engine.db "SELECT id, title, status FROM content;"
```

### Test Locally
```bash
curl http://127.0.0.1:3005/
curl https://o11y.tips/
```
