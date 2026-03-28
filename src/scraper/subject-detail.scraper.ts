import { Page } from 'playwright'
import { config } from '../config.js'

export interface SubjectDetail {
  subjectName: string
  learningObjectives: string[]
  assessmentOutline: string
  curriculumOutcomes: string[]
}

/**
 * Scrape subject homepage pages for learning objectives,
 * assessment outlines, and curriculum outcomes.
 */
export async function scrapeSubjectDetails(page: Page): Promise<SubjectDetail[]> {
  const baseUrl = config.schoolbox.url.replace(/\/$/, '')
  const subjectHubUrl = `${config.schoolbox.url}homepage/4461`

  await page.goto(subjectHubUrl, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(2000)

  // Find subject page links
  const links = await page.locator('a[href*="/homepage/"]').all()
  const subjectPages: { text: string; href: string }[] = []

  for (const link of links) {
    const href = await link.getAttribute('href') || ''
    const text = (await link.textContent())?.trim().replace(/\s+/g, ' ') || ''
    if (text.length > 2 && text.length < 60 && !href.includes('4461')) {
      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`
      if (!subjectPages.some(s => s.href === fullHref)) {
        subjectPages.push({ text, href: fullHref })
      }
    }
  }

  const details: SubjectDetail[] = []

  for (const sp of subjectPages) {
    try {
      await page.goto(sp.href, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(1500)

      const bodyText = await page.locator('body').textContent() || ''

      // Extract learning objectives/intentions
      const objectivesMatch = bodyText.match(/(?:Learning (?:Intentions?|Objectives?)|Success Criteria|Outcomes?)\s*:?\s*([\s\S]*?)(?=(?:Assessment|Activities|Resources|Lesson Content|$))/i)
      const objectives = objectivesMatch
        ? objectivesMatch[1]
            .split(/[•\n]/)
            .map(s => s.trim())
            .filter(s => s.length > 5 && s.length < 200)
        : []

      // Extract assessment outline text
      const assessmentMatch = bodyText.match(/(?:Assessment (?:Schedule|Outline|Tasks?|Overview))\s*:?\s*([\s\S]*?)(?=(?:Resources|Lesson Content|Activities|$))/i)
      const assessmentOutline = assessmentMatch
        ? assessmentMatch[1].trim().replace(/\s+/g, ' ').slice(0, 3000)
        : ''

      // Extract NSW curriculum outcome codes (e.g., MA5-1WM, EN4-1A, SC4-5WS)
      const outcomePattern = /[A-Z]{2,4}\d-\d+[A-Z]{1,3}/g
      const curriculumOutcomes = [...new Set(bodyText.match(outcomePattern) || [])]

      if (objectives.length > 0 || assessmentOutline || curriculumOutcomes.length > 0) {
        details.push({
          subjectName: sp.text,
          learningObjectives: objectives.slice(0, 20),
          assessmentOutline,
          curriculumOutcomes
        })
        console.log(`  Subject detail: ${sp.text} — ${objectives.length} objectives, ${curriculumOutcomes.length} outcomes`)
      }
    } catch (err) {
      console.warn(`  Subject detail: failed for ${sp.text}:`, err)
    }
  }

  console.log(`Subject details: ${details.length} subjects with content`)
  return details
}
