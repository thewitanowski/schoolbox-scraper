import { Page } from 'playwright'
import { config } from '../config.js'
import { TimetablePeriod } from './types.js'

const TIMETABLE_REGEX = /^([\d:]+(?:am|pm))\s*-\s*([\d:]+(?:am|pm))\s+(\w+)\s+([AB]),\s*(.+?),\s*(.+?),\s*(\w+)$/

export function parseTimetableEvent(text: string): TimetablePeriod | null {
  const cleaned = text.trim().replace(/\s+/g, ' ')
  const match = cleaned.match(TIMETABLE_REGEX)
  if (!match) return null

  return {
    startTime: match[1],
    endTime: match[2],
    dayName: match[3],
    week: match[4],
    periodLabel: match[5].trim(),
    subjectCode: match[6].trim(),
    room: match[7].trim()
  }
}

export async function scrapeTimetable(page: Page): Promise<TimetablePeriod[]> {
  const url = `${config.schoolbox.url}timetable/${config.schoolbox.studentId}`
  await page.goto(url, { waitUntil: 'networkidle' })

  const events = await page.locator('a.fc-event').all()
  const periods: TimetablePeriod[] = []

  for (const event of events) {
    const text = (await event.textContent())?.trim().replace(/\s+/g, ' ') || ''
    const period = parseTimetableEvent(text)
    if (period) {
      periods.push(period)
    }
  }

  console.log(`Timetable: ${periods.length} periods scraped`)
  return periods
}

/**
 * Extract unique subject codes from timetable data
 */
export function extractSubjects(periods: TimetablePeriod[]): Map<string, string> {
  const subjects = new Map<string, string>()
  for (const p of periods) {
    if (!subjects.has(p.subjectCode)) {
      // Derive a human-readable name from the code
      // "7SCI C" -> "Science", "7MATS4 C" -> "Mathematics"
      subjects.set(p.subjectCode, p.subjectCode)
    }
  }
  return subjects
}
