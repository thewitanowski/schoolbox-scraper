import { Page } from 'playwright'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'
import { ScheduleInfo } from './types.js'

export async function scrapeSchedules(page: Page): Promise<ScheduleInfo[]> {
  const baseUrl = config.schoolbox.url.replace(/\/$/, '')
  const schedulesDir = join(config.dataDir, 'schedules')
  if (!existsSync(schedulesDir)) mkdirSync(schedulesDir, { recursive: true })

  // Navigate to Year 7 subject hub
  await page.goto(`${config.schoolbox.url}homepage/4582`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Get subject page links
  const links = await page.locator('a[href*="/homepage/"]').all()
  const subjectPages: { text: string; href: string }[] = []

  for (const link of links) {
    const href = await link.getAttribute('href') || ''
    const text = (await link.textContent())?.trim().replace(/\s+/g, ' ') || ''
    if (text.length > 2 && text.length < 60 && !href.includes('4582')) {
      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`
      if (!subjectPages.some(s => s.href === fullHref)) {
        subjectPages.push({ text, href: fullHref })
      }
    }
  }

  const schedules: ScheduleInfo[] = []

  for (const sp of subjectPages) {
    try {
      await page.goto(sp.href, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(1500)

      // Find PDF links
      const pdfLinks = await page.locator('a[href*=".pdf"], a[href*="/storage/fetch.php"]').all()
      for (const pdfLink of pdfLinks) {
        const pdfHref = await pdfLink.getAttribute('href') || ''
        if (!pdfHref) continue

        const pdfUrl = pdfHref.startsWith('http') ? pdfHref : `${baseUrl}${pdfHref}`
        const safeName = sp.text.replace(/[^a-zA-Z0-9_-]/g, '_')
        const filePath = join(schedulesDir, `${safeName}.pdf`)

        // Download the PDF
        try {
          const response = await page.context().request.get(pdfUrl)
          if (response.ok()) {
            const buffer = await response.body()
            const ws = createWriteStream(filePath)
            ws.write(buffer)
            ws.end()

            schedules.push({
              subjectName: sp.text,
              pdfUrl,
              filePath
            })
            console.log(`  Schedule: downloaded ${sp.text} PDF`)
          }
        } catch (err) {
          console.warn(`  Schedule: failed to download ${sp.text} PDF:`, err)
          schedules.push({
            subjectName: sp.text,
            pdfUrl,
            filePath: null
          })
        }
      }
    } catch (err) {
      console.warn(`  Schedule: failed to scrape ${sp.text}:`, err)
    }
  }

  console.log(`Schedules: ${schedules.length} PDFs found`)
  return schedules
}
