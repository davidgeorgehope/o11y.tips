import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { adminAuth, generateToken } from './middleware/auth.js';
import { config } from '../config.js';

import nichesRoutes from './admin/niches.js';
import schedulesRoutes from './admin/schedules.js';
import discoveryRoutes from './admin/discovery.js';
import jobsRoutes from './admin/jobs.js';
import contentRoutes from './admin/content.js';
import settingsRoutes from './admin/settings.js';
import publicRoutes from './public.js';

export function createApi() {
  const app = new Hono();

  // Global middleware
  app.use('*', cors());
  app.use('*', honoLogger());

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Login endpoint (no auth required)
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json();
    const { username, password } = body;

    if (username === config.admin.username && password === config.admin.password) {
      const token = await generateToken(username);
      return c.json({ token, expiresIn: config.admin.jwtExpiresIn });
    }

    return c.json({ error: 'Invalid credentials' }, 401);
  });

  // Public API routes
  app.route('/api', publicRoutes);

  // Admin API routes (protected)
  const admin = new Hono();
  admin.use('*', adminAuth);
  admin.route('/niches', nichesRoutes);
  admin.route('/schedules', schedulesRoutes);
  admin.route('/discovery', discoveryRoutes);
  admin.route('/jobs', jobsRoutes);
  admin.route('/content', contentRoutes);
  admin.route('/settings', settingsRoutes);

  // Dashboard stats
  admin.get('/stats', async (c) => {
    const { db, niches, discoveredPosts, content } = await import('../db/index.js');
    const { eq } = await import('drizzle-orm');

    const [
      totalNiches,
      activeNiches,
      totalDiscovered,
      pendingDiscovered,
      totalJobs,
      runningJobs,
      totalContent,
      publishedContent,
    ] = await Promise.all([
      db.query.niches.findMany({ columns: { id: true } }),
      db.query.niches.findMany({ where: eq(niches.isActive, true), columns: { id: true } }),
      db.query.discoveredPosts.findMany({ columns: { id: true } }),
      db.query.discoveredPosts.findMany({ where: eq(discoveredPosts.status, 'pending'), columns: { id: true } }),
      db.query.generationJobs.findMany({ columns: { id: true } }),
      db.query.generationJobs.findMany({
        where: (jobs, { notInArray }) =>
          notInArray(jobs.status, ['pending', 'completed', 'failed']),
        columns: { id: true },
      }),
      db.query.content.findMany({ columns: { id: true } }),
      db.query.content.findMany({ where: eq(content.status, 'published'), columns: { id: true } }),
    ]);

    return c.json({
      niches: {
        total: totalNiches.length,
        active: activeNiches.length,
      },
      discovery: {
        total: totalDiscovered.length,
        pending: pendingDiscovered.length,
      },
      jobs: {
        total: totalJobs.length,
        running: runningJobs.length,
      },
      content: {
        total: totalContent.length,
        published: publishedContent.length,
      },
    });
  });

  app.route('/api/admin', admin);

  return app;
}
