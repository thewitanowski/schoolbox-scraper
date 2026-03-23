import { validateConfig } from './config.js'
import { startServer } from './api/server.js'
import { runMigrations } from './db/migrate.js'
import { getPool, closePool } from './db/pool.js'
import { ScrapeOrchestrator } from './scraper/orchestrator.js'
import { startCronSchedule } from './scraper/cron.js'

async function main(): Promise<void> {
  validateConfig()

  // Run database migrations
  const pool = getPool()
  await runMigrations(pool)

  // Create scrape orchestrator
  const orchestrator = new ScrapeOrchestrator(pool)

  // Start HTTP server with pool + orchestrator
  const app = await startServer(pool, orchestrator)

  // Start cron schedule
  const cronTask = startCronSchedule(orchestrator)

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('Shutting down...')
    cronTask.stop()
    await app.close()
    await closePool()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
