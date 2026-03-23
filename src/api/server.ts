import Fastify from 'fastify'
import cors from '@fastify/cors'
import pg from 'pg'
import { apiKeyAuth } from './auth.js'
import { registerSyncRoutes } from './sync-routes.js'
import { ScrapeOrchestrator } from '../scraper/orchestrator.js'
import { config } from '../config.js'

export function buildServer(pool?: pg.Pool, orchestrator?: ScrapeOrchestrator) {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
  })

  // CORS for Electron app
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST']
  })

  // Health check (no auth required)
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // API key auth for all /api/* routes
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      await apiKeyAuth(request, reply)
    }
  })

  // Register sync routes if pool is provided
  if (pool) {
    registerSyncRoutes(app, pool)
  } else {
    // Placeholder for tests without DB
    app.get('/api/sync/last-updated', async () => {
      return { lastScrape: null, status: 'no_data' }
    })
  }

  // Manual scrape trigger
  if (orchestrator) {
    app.post('/api/scrape/trigger', async (request, reply) => {
      if (orchestrator.isRunning()) {
        reply.code(409).send({ error: 'Scrape already in progress' })
        return
      }

      // Run async — don't block the response
      const resultPromise = orchestrator.runFull()

      return {
        message: 'Scrape started',
        note: 'Check /api/sync/last-updated for progress'
      }
    })
  }

  return app
}

export async function startServer(pool?: pg.Pool, orchestrator?: ScrapeOrchestrator) {
  const app = buildServer(pool, orchestrator)

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' })
    console.log(`Server listening on port ${config.port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  return app
}
