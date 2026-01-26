import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config, validateConfig } from './config.js';
import { initializeDatabase } from './db/index.js';
import { createApi } from './api/index.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('server');

async function main() {
  logger.info('Starting Content Engine...');

  // Validate configuration
  validateConfig();

  // Initialize database
  logger.info('Initializing database...');
  initializeDatabase();

  // Create API
  const app = createApi();

  // Serve static files from output directory
  app.use('/output/*', serveStatic({ root: './' }));

  // Serve admin UI (if built)
  app.use('/admin/*', serveStatic({ root: './admin/dist', rewriteRequestPath: (path) => path.replace('/admin', '') }));
  app.get('/admin', (c) => c.redirect('/admin/'));

  // Serve main index page at root
  app.get('/', (c) => {
    const indexPath = join(config.paths.output, 'index.html');
    if (existsSync(indexPath)) {
      return c.html(readFileSync(indexPath, 'utf-8'));
    }
    // Redirect to admin if no articles published yet
    return c.redirect('/admin');
  });

  // Serve niche index pages (e.g., /observability)
  app.get('/:niche', (c) => {
    const niche = c.req.param('niche');
    // Skip API and admin routes
    if (niche === 'api' || niche === 'admin' || niche === 'output') {
      return c.notFound();
    }
    const indexPath = join(config.paths.output, niche, 'index.html');
    if (existsSync(indexPath)) {
      return c.html(readFileSync(indexPath, 'utf-8'));
    }
    return c.notFound();
  });

  // Serve article pages (e.g., /observability/my-article)
  app.get('/:niche/:slug', (c) => {
    const niche = c.req.param('niche');
    const slug = c.req.param('slug');
    // Skip API routes
    if (niche === 'api' || niche === 'admin' || niche === 'output') {
      return c.notFound();
    }
    const articlePath = join(config.paths.output, niche, `${slug}.html`);
    if (existsSync(articlePath)) {
      return c.html(readFileSync(articlePath, 'utf-8'));
    }
    return c.notFound();
  });

  // Start scheduler
  logger.info('Starting job scheduler...');
  await startScheduler();

  // Start server
  const server = serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: config.server.host,
  }, (info) => {
    logger.info(`Server running at http://${info.address}:${info.port}`);
    logger.info(`Admin UI: http://${info.address}:${info.port}/admin`);
    logger.info(`API: http://${info.address}:${info.port}/api`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    stopScheduler();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
