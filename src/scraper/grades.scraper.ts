import { Page } from 'playwright'
import { config } from '../config.js'
import { GradeEntry } from './types.js'

const ENTRY_REGEX = /(.+?)\s+(Submitted on time|Submitted late|Not submitted|Reviewed|Teacher-Assessed|Incomplete|Submitted in person on time|Submitted in person)\s+(Assessment Task \d+|Homework|Quiz|Class Work|Continuous Assessment|Project)\s+Due\s+(.+?)(?:\n|$)/gi
const GRADED_REGEX = /(.+?)\s+(Reviewed)\s+(Continuous Assessment|Homework|Class Work)\s+Due\s+(.+?)\s+(\d+\s*\/\s*\d+)\s+(.+?)(?:\n|$)/gi

export function parseGradeEntries(
  section: string,
  subject: string,
  subjectCode: string,
  teacher: string
): GradeEntry[] {
  const entries: GradeEntry[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null

  // Run graded regex first (more specific — captures score + feedback)
  GRADED_REGEX.lastIndex = 0
  while ((match = GRADED_REGEX.exec(section)) !== null) {
    const name = match[1].trim().replace(/\s+/g, ' ')
    if (seen.has(name)) continue
    seen.add(name)

    entries.push({
      subject,
      subjectCode,
      teacher,
      assessmentName: name.slice(0, 200),
      status: match[2],
      type: match[3],
      dueDate: match[4].trim().slice(0, 60),
      grade: match[5].trim(),
      feedback: match[6]?.trim().slice(0, 500) || ''
    })
  }

  // Then run general entry regex (less specific — no grade capture)
  ENTRY_REGEX.lastIndex = 0
  while ((match = ENTRY_REGEX.exec(section)) !== null) {
    const name = match[1].trim().replace(/\s+/g, ' ')
    if (seen.has(name)) continue
    seen.add(name)

    const afterDue = section.slice(match.index + match[0].length, match.index + match[0].length + 200)
    const gradeMatch = afterDue.match(/^[\s]*([A-F][+-]?|\d+\s*\/\s*\d+|\d+%)/i)

    entries.push({
      subject,
      subjectCode,
      teacher,
      assessmentName: name.slice(0, 200),
      status: match[2].trim(),
      type: match[3].trim(),
      dueDate: match[4].trim().replace(/\s+/g, ' ').slice(0, 60),
      grade: gradeMatch?.[1] || '',
      feedback: ''
    })
  }

  return entries
}

export async function scrapeGrades(page: Page): Promise<GradeEntry[]> {
  const baseUrl = config.schoolbox.url.replace(/\/$/, '')
  const gradesUrl = `${config.schoolbox.url}learning/grades/${config.schoolbox.studentId}`
  await page.goto(gradesUrl, { waitUntil: 'networkidle' })

  // Get subject links
  const links = await page.locator(`a[href*="/learning/grades/${config.schoolbox.studentId}/"]`).all()
  const subjects: { name: string; code: string; href: string }[] = []

  for (const link of links) {
    const href = await link.getAttribute('href')
    const text = (await link.textContent())?.trim().replace(/\s+/g, ' ') || ''
    if (!href || !text || text.length < 3 || text.includes('Summary')) continue

    const codeMatch = text.match(/\((\w+\s*\w*)\)/)
    subjects.push({
      name: text.replace(/\s*\(.*\)/, '').trim(),
      code: codeMatch?.[1] || '',
      href: href.startsWith('http') ? href : `${baseUrl}${href}`
    })
  }

  const allEntries: GradeEntry[] = []

  for (const subject of subjects) {
    // Navigate to subject grade page
    await page.goto(gradesUrl, { waitUntil: 'networkidle' })
    const subjectLink = page.locator(`a:has-text("${subject.name}")`)
    await subjectLink.first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const pageText = await page.locator('body').textContent() || ''

    // Extract teacher
    const teacherMatch = pageText.match(/Teacher\(s\):\s*(.+?)(?:\n|Project|Quiz)/i)
    const teacher = teacherMatch?.[1]?.trim() || ''

    // Extract grade section
    const gradeSection = pageText.match(/Reset to defaults\s*([\s\S]*?)(?:2026 © Copyright|$)/i)
    if (gradeSection) {
      const entries = parseGradeEntries(gradeSection[1], subject.name, subject.code, teacher)
      allEntries.push(...entries)
      console.log(`  Grades: ${subject.name} — ${entries.length} entries`)
    }
  }

  console.log(`Grades: ${allEntries.length} total entries across ${subjects.length} subjects`)
  return allEntries
}
