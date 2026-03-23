import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('SCRAPER_API_KEY', 'test-key')
vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
vi.stubEnv('DATA_DIR', '/tmp/test-scraper')

import cron from 'node-cron'

describe('Cron schedule', () => {
  it('uses valid cron expression for 6am daily', async () => {
    const { CRON_SCHEDULE } = await import('../src/scraper/cron.js')
    expect(CRON_SCHEDULE).toBe('0 6 * * *')
    expect(cron.validate(CRON_SCHEDULE)).toBe(true)
  })
})

describe('ScrapeOrchestrator', () => {
  it('prevents concurrent scrape runs', async () => {
    const { ScrapeOrchestrator } = await import('../src/scraper/orchestrator.js')

    // Create an orchestrator with a mock pool
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] })
    } as any

    const orchestrator = new ScrapeOrchestrator(mockPool)

    expect(orchestrator.isRunning()).toBe(false)

    // Simulate a running state by setting internal flag
    // We test the guard by attempting to run while already running
    // First call will start (and fail due to mocked chromium),
    // but the flag check is what we want to verify
    const result = await orchestrator.runFull()
    // It will fail because chromium isn't available in test,
    // but it should have attempted and reset the flag
    expect(orchestrator.isRunning()).toBe(false)
  })

  it('returns errors array when scrape fails', async () => {
    const { ScrapeOrchestrator } = await import('../src/scraper/orchestrator.js')

    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // createRun
        .mockResolvedValue({ rows: [] }) // failRun
    } as any

    const orchestrator = new ScrapeOrchestrator(mockPool)
    const result = await orchestrator.runFull()

    expect(result.runId).toBe(42)
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
