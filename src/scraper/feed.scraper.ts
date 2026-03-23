import { Page } from 'playwright'
import { config } from '../config.js'
import { FeedItem } from './types.js'

const FEED_REGEX = /(\d+\s+DAYS?\s+AGO|TODAY|YESTERDAY|\w+\s+\d+,\s+\d{4})\s+(.+?)\s+Reviewed by\s+(.+?)\s+in\s+(.+?)\s*\|\s*([\d:]+(?:am|pm))\s*(?:(.+?)(?=View assessment details|\d+\s+DAYS?\s+AGO|$))?/gi

export function parseFeedItems(bodyText: string): FeedItem[] {
  const items: FeedItem[] = []
  let match: RegExpExecArray | null

  // Reset regex state
  FEED_REGEX.lastIndex = 0

  while ((match = FEED_REGEX.exec(bodyText)) !== null) {
    const gradeMatch = bodyText.slice(match.index, match.index + match[0].length + 50)
      .match(/(\d+\s*\/\s*\d+|[A-F][+-]?)(?:\s|$)/i)

    items.push({
      feedDate: match[1].trim(),
      title: match[2].trim(),
      teacher: match[3].trim(),
      subject: match[4].trim(),
      time: match[5].trim(),
      grade: gradeMatch?.[1] || '',
      feedback: match[6]?.trim().replace(/\s+/g, ' ') || '',
      detailUrl: ''
    })
  }

  return items
}

export async function scrapeFeed(page: Page): Promise<FeedItem[]> {
  const url = `${config.schoolbox.url}search/user/${config.schoolbox.studentId}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Scroll to load more content
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1000)
  }

  const bodyText = await page.locator('body').textContent() || ''
  const items = parseFeedItems(bodyText)

  // Capture "View assessment details" links
  const detailLinks = await page.locator('a[href*="/learning/assessments/"]').all()
  const hrefs: string[] = []
  for (const link of detailLinks) {
    const href = await link.getAttribute('href')
    if (href) hrefs.push(href)
  }

  // Try to associate detail URLs with feed items (by order)
  for (let i = 0; i < Math.min(items.length, hrefs.length); i++) {
    const baseUrl = config.schoolbox.url.replace(/\/$/, '')
    items[i].detailUrl = hrefs[i].startsWith('http') ? hrefs[i] : `${baseUrl}${hrefs[i]}`
  }

  console.log(`Feed: ${items.length} items scraped`)
  return items
}
