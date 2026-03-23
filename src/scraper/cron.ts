import cron from 'node-cron'
import { ScrapeOrchestrator } from './orchestrator.js'

// Daily at 6am AEST (Australia/Sydney)
const CRON_SCHEDULE = '0 6 * * *'

export function startCronSchedule(orchestrator: ScrapeOrchestrator): cron.ScheduledTask {
  console.log(`Scheduling daily scrape at 6:00 AM AEST`)

  const task = cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[CRON] Starting scheduled scrape at ${new Date().toISOString()}`)

    if (orchestrator.isRunning()) {
      console.log('[CRON] Skipping — scrape already in progress')
      return
    }

    try {
      const result = await orchestrator.runFull()
      if (result.success) {
        console.log(`[CRON] Scrape run ${result.runId} completed successfully`)
      } else {
        console.warn(`[CRON] Scrape run ${result.runId} completed with errors:`, result.errors)
      }
    } catch (err) {
      console.error('[CRON] Scrape failed:', err)
    }
  }, {
    timezone: 'Australia/Sydney'
  })

  return task
}

export { CRON_SCHEDULE }
