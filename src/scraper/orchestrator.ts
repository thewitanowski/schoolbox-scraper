import { chromium, Browser } from 'playwright'
import pg from 'pg'
import { LoginService } from './login.js'
import { scrapeTimetable, extractSubjects } from './timetable.scraper.js'
import { scrapeDueWork } from './due-work.scraper.js'
import { scrapeFeed } from './feed.scraper.js'
import { scrapeGrades } from './grades.scraper.js'
import { scrapeSchedules } from './schedules.scraper.js'
import { scrapeSubjectDetails } from './subject-detail.scraper.js'
import { ScrapeRepository } from './repositories.js'
import { ScrapeModuleError } from './errors.js'

export class ScrapeOrchestrator {
  private repo: ScrapeRepository
  private loginService: LoginService
  private running = false

  constructor(pool: pg.Pool) {
    this.repo = new ScrapeRepository(pool)
    this.loginService = new LoginService()
  }

  isRunning(): boolean {
    return this.running
  }

  async runFull(): Promise<{ runId: number; success: boolean; errors: string[] }> {
    if (this.running) {
      return { runId: 0, success: false, errors: ['Scrape already in progress'] }
    }

    this.running = true
    const runId = await this.repo.createRun()
    const errors: string[] = []
    const counts = { timetable: 0, dueWork: 0, grades: 0, feed: 0, schedules: 0 }

    let browser: Browser | null = null

    try {
      browser = await chromium.launch({ headless: true })
      const context = await browser.newContext()
      const page = await context.newPage()

      // Login
      await this.loginService.loginWithSessionRestore(context, page)

      // Timetable
      try {
        const periods = await scrapeTimetable(page)
        const subjects = extractSubjects(periods)
        await this.repo.saveTimetable(runId, periods)
        await this.repo.saveSubjects(subjects)
        counts.timetable = periods.length
      } catch (err) {
        const msg = `Timetable: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        console.error(msg)
      }

      // Due Work
      try {
        const items = await scrapeDueWork(page)
        await this.repo.saveDueWork(runId, items)
        counts.dueWork = items.length
      } catch (err) {
        const msg = `Due work: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        console.error(msg)
      }

      // Feed
      try {
        const items = await scrapeFeed(page)
        await this.repo.saveFeed(runId, items)
        counts.feed = items.length
      } catch (err) {
        const msg = `Feed: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        console.error(msg)
      }

      // Grades
      try {
        const entries = await scrapeGrades(page)
        await this.repo.saveGrades(runId, entries)
        counts.grades = entries.length
      } catch (err) {
        const msg = `Grades: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        console.error(msg)
      }

      // Schedules
      try {
        const schedules = await scrapeSchedules(page)
        await this.repo.saveSchedules(schedules)
        counts.schedules = schedules.length
      } catch (err) {
        const msg = `Schedules: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        console.error(msg)
      }

      // Subject Details (learning objectives, curriculum outcomes)
      try {
        const details = await scrapeSubjectDetails(page)
        // Store subject details as metadata on existing subjects
        for (const detail of details) {
          await this.repo.saveSubjectDetail(detail)
        }
      } catch (err) {
        const msg = `Subject details: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        console.error(msg)
      }

      await this.repo.completeRun(runId, counts)
      console.log(`Scrape run ${runId} complete:`, counts)

      return { runId, success: errors.length === 0, errors }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.repo.failRun(runId, msg)
      errors.push(msg)
      return { runId, success: false, errors }
    } finally {
      if (browser) await browser.close()
      this.running = false
    }
  }
}
