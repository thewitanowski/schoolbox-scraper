import { Page } from 'playwright'
import { config } from '../config.js'
import { DueWorkItem, AttachmentInfo } from './types.js'

export function parseDueWorkFields(bodyText: string): Omit<DueWorkItem, 'schoolboxUrl' | 'title' | 'attachments'> {
  const subjectMatch = bodyText.match(/([\w\s&-]+)\s*-\s*\d+\/\w+\s*\((\w+\s*\w*)\)\s*(?:Assessment|Homework|Quiz|Class Work)/i)
    || bodyText.match(/YEAR \d+\s+(.+?)\s+\d{4}\s/i)

  const teacherMatch = bodyText.match(/TEACHER:\s*(.+?)(?:\n|DUE|WEIGHTING)/i)
  const dueDateMatch = bodyText.match(/DUE DATE\s*[\s]*([\w\s,]+\d{4})/i)
  const weightMatch = bodyText.match(/WEIGHTING\s*[\s]*(\d+%)/i)
  const statusMatch = bodyText.match(/(Not submitted|Submitted on time|Submitted late|Reviewed|Teacher-Assessed|Incomplete|Submitted in person)/i)
  const typeMatch = bodyText.match(/(Assessment Task \d+|Homework|Quiz|Class Work|Continuous Assessment|Project)/i)

  const descMatch = bodyText.match(/TASK DESCRIPTION\s*([\s\S]*?)(?=USE OF ARTIFICIAL|WHAT I AM LOOKING|WHAT I NEED|KEY TERMINOLOGY|UPCOMING LEARNING|$)/i)
  const criteriaMatch = bodyText.match(/WHAT I AM LOOKING FOR\s*([\s\S]*?)(?=WHAT I NEED|KEY TERMINOLOGY|USE OF ARTIFICIAL|UPCOMING LEARNING|$)/i)
  const materialsMatch = bodyText.match(/WHAT I NEED\s*([\s\S]*?)(?=KEY TERMINOLOGY|USE OF ARTIFICIAL|WHAT I AM LOOKING|UPCOMING LEARNING|$)/i)
  const termMatch = bodyText.match(/KEY TERMINOLOGY\s*([\s\S]*?)(?=WHAT I NEED|USE OF ARTIFICIAL|WHAT I AM LOOKING|UPCOMING LEARNING|$)/i)
  const aiMatch = bodyText.match(/USE OF ARTIFICIAL INTELLIGENCE.*?\s*([\s\S]*?)(?=WHAT I AM LOOKING|WHAT I NEED|KEY TERMINOLOGY|UPCOMING LEARNING|$)/i)

  return {
    subject: subjectMatch?.[1]?.trim() || '',
    subjectCode: subjectMatch?.[2]?.trim() || '',
    type: typeMatch?.[1] || '',
    dueDate: dueDateMatch?.[1]?.trim() || '',
    status: statusMatch?.[1] || '',
    weighting: weightMatch?.[1] || '',
    teacher: teacherMatch?.[1]?.trim() || '',
    description: descMatch ? descMatch[1].trim().replace(/\s+/g, ' ').slice(0, 2000) : '',
    criteria: criteriaMatch ? criteriaMatch[1].trim().replace(/\s+/g, ' ').slice(0, 2000) : '',
    materials: materialsMatch ? materialsMatch[1].trim().replace(/\s+/g, ' ').slice(0, 1000) : '',
    terminology: termMatch ? termMatch[1].trim().replace(/\s+/g, ' ').slice(0, 2000) : '',
    aiPolicy: aiMatch ? aiMatch[1].trim().replace(/\s+/g, ' ').slice(0, 500) : ''
  }
}

export async function scrapeDueWork(page: Page): Promise<DueWorkItem[]> {
  const baseUrl = config.schoolbox.url.replace(/\/$/, '')
  const dueUrl = `${config.schoolbox.url}learning/due/${config.schoolbox.studentId}`
  await page.goto(dueUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const assessmentLinks = await page.locator('a[href*="/learning/assessments/"]').all()
  const totalCount = assessmentLinks.length
  const items: DueWorkItem[] = []

  console.log(`Due work: found ${totalCount} items. Extracting details...`)

  for (let i = 0; i < totalCount; i++) {
    // Re-navigate each time (modal state resets)
    if (i > 0) {
      await page.goto(dueUrl, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
    }

    const links = await page.locator('a[href*="/learning/assessments/"]').all()
    if (i >= links.length) break

    const link = links[i]
    const title = (await link.textContent())?.trim().replace(/\s+/g, ' ') || ''
    const href = await link.getAttribute('href') || ''
    const schoolboxUrl = href.startsWith('http') ? href : `${baseUrl}${href}`

    if (!title || title.length < 3) continue

    // Click to open modal
    await link.click()
    await page.waitForTimeout(2000)

    const bodyText = await page.locator('body').textContent() || ''
    const fields = parseDueWorkFields(bodyText)

    // Extract attachments from the modal
    const attachments: AttachmentInfo[] = []
    const downloadLinks = await page.locator('a[href*="download"], a[href*="/file/"]').all()
    for (const dl of downloadLinks) {
      const dlHref = await dl.getAttribute('href') || ''
      const dlText = (await dl.textContent())?.trim() || ''
      if (dlText.length > 2 && dlHref) {
        attachments.push({
          name: dlText.replace(/\s+/g, ' '),
          size: '',
          url: dlHref.startsWith('http') ? dlHref : `${baseUrl}${dlHref}`
        })
      }
    }

    items.push({ schoolboxUrl, title, ...fields, attachments })

    console.log(`  [${i + 1}/${totalCount}] ${title}`)

    // Close modal
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }

  console.log(`Due work: ${items.length} items extracted (${items.filter(i => i.description).length} with details)`)
  return items
}
