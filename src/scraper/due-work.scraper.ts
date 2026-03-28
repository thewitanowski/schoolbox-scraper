import { Page } from 'playwright'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'
import { DueWorkItem, AttachmentInfo } from './types.js'

/** Clean extracted text — remove JavaScript, HTML artifacts, and page noise */
function cleanExtracted(text: string, maxLen: number): string {
  return text
    .replace(/\$\(function\(\)[\s\S]*/gi, '') // jQuery
    .replace(/\$\(document[\s\S]*/gi, '')
    .replace(/\$\(['"][^'"]*['"]\)[\s\S]*/g, '') // jQuery selectors
    .replace(/function\s*\([\s\S]*/g, '') // JS functions
    .replace(/Activate export[\s\S]*/gi, '')
    .replace(/SUBMISSION DETAILS[\s\S]*/gi, '')
    .replace(/SUBMISSION HISTORY[\s\S]*/gi, '')
    .replace(/RANGE OF MARKS[\s\S]*/gi, '')
    .replace(/MARKING CRITERIA[\s\S]*/gi, '')
    .replace(/OUTCOME\w+[-]\w+/g, '') // Loose outcome codes mixed into text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

export function parseDueWorkFields(bodyText: string): Omit<DueWorkItem, 'schoolboxUrl' | 'title' | 'attachments'> {
  // Try multiple patterns for subject extraction
  const subjectMatch = bodyText.match(/([\w\s&-]+)\s*-\s*\d+\/\w+\s*\((\w+\s*\w*)\)\s*(?:Assessment|Homework|Quiz|Class Work)/i)
    || bodyText.match(/([\w\s&-]+)\s*-\s*\d+\/\w+\s*\((\w+\s*\w*)\)/i)
    || bodyText.match(/(?:Subject|Class):\s*([\w\s&-]+)\s*(?:\((\w+\s*\w*)\))?/i)
    || bodyText.match(/YEAR \d+\s+(.+?)\s+\d{4}\s/i)
    // Match breadcrumb-style: "Mathematics - 7/C" or "Science - 7/C"
    || bodyText.match(/((?:Mathematics|English|Science|PDHPE|Geography|History|Music|Technology|Visual Arts|FUSION|Biblical Studies|LOTE[- ]Japanese|Pastoral Care))\s*(?:-\s*\d+\/\w+)?(?:\s*\((\w+\s*\w*)\))?/i)

  const teacherMatch = bodyText.match(/TEACHER:\s*(.+?)(?:\n|DUE|WEIGHTING)/i)
  const dueDateMatch = bodyText.match(/DUE DATE\s*[\s]*([\w\s,]+\d{4})/i)
  const weightMatch = bodyText.match(/WEIGHTING\s*[\s]*(\d+%)/i)
  const statusMatch = bodyText.match(/(Not submitted|Submitted on time|Submitted late|Reviewed|Teacher-Assessed|Incomplete|Submitted in person)/i)
  const typeMatch = bodyText.match(/(Assessment Task \d+|Homework|Quiz|Class Work|Continuous Assessment|Project)/i)

  // Content extraction — stop at section boundaries AND page chrome
  const sectionEnd = '(?=USE OF ARTIFICIAL|WHAT I AM LOOKING|WHAT I NEED|KEY TERMINOLOGY|UPCOMING LEARNING|SUBMISSION DETAILS|SUBMISSION HISTORY|MARKING CRITERIA|RANGE OF MARKS|GRADING|Return|\\$\\(function|\\$\\(document|Activate export|<script)'

  const descMatch = bodyText.match(new RegExp(`TASK DESCRIPTION\\s*([\\s\\S]*?)${sectionEnd}`, 'i'))
  const criteriaMatch = bodyText.match(new RegExp(`WHAT I AM LOOKING FOR\\s*([\\s\\S]*?)${sectionEnd}`, 'i'))
  const materialsMatch = bodyText.match(new RegExp(`WHAT I NEED\\s*([\\s\\S]*?)${sectionEnd}`, 'i'))
  const termMatch = bodyText.match(new RegExp(`KEY TERMINOLOGY\\s*([\\s\\S]*?)${sectionEnd}`, 'i'))
  const aiMatch = bodyText.match(new RegExp(`USE OF ARTIFICIAL INTELLIGENCE.*?\\s*([\\s\\S]*?)${sectionEnd}`, 'i'))

  let description = descMatch ? descMatch[1].trim().replace(/\s+/g, ' ').slice(0, 2000) : ''

  // Fallback: if no structured sections found, try to extract any meaningful content
  // from the body text (excluding metadata like dates, names, navigation)
  if (!description && !criteriaMatch && !materialsMatch && !termMatch) {
    // Look for content after the status/type/date metadata block
    const contentMatch = bodyText.match(
      /(?:Not submitted|Submitted|Reviewed|Teacher-Assessed|Incomplete)\s*([\s\S]*?)(?=Return|RETURN|Submission History|$)/i
    )
    if (contentMatch) {
      const rawContent = contentMatch[1].trim().replace(/\s+/g, ' ')
      // Filter out short/noisy content
      if (rawContent.length > 20) {
        description = rawContent.slice(0, 3000)
      }
    }

    // Alternative: grab content between the title and any footer/nav
    if (!description) {
      const altMatch = bodyText.match(
        /(?:Homework|Assessment Task|Quiz|Class Work|Project|Continuous Assessment)\s*([\s\S]*?)(?=Return|RETURN|Submission History|Upload|Submit|$)/i
      )
      if (altMatch) {
        const rawContent = altMatch[1].trim().replace(/\s+/g, ' ')
        if (rawContent.length > 20) {
          description = rawContent.slice(0, 3000)
        }
      }
    }
  }

  return {
    subject: subjectMatch?.[1]?.trim() || '',
    subjectCode: subjectMatch?.[2]?.trim() || '',
    type: typeMatch?.[1] || '',
    dueDate: dueDateMatch?.[1]?.trim() || '',
    status: statusMatch?.[1] || '',
    weighting: weightMatch?.[1] || '',
    teacher: teacherMatch?.[1]?.trim() || '',
    description,
    criteria: criteriaMatch ? cleanExtracted(criteriaMatch[1], 2000) : '',
    materials: materialsMatch ? cleanExtracted(materialsMatch[1], 1000) : '',
    terminology: termMatch ? cleanExtracted(termMatch[1], 2000) : '',
    aiPolicy: aiMatch ? cleanExtracted(aiMatch[1], 500) : ''
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

    // Click to open modal/navigate to detail page
    await link.click()
    await page.waitForTimeout(2000)

    // Try to read from specific content areas first, not the full body
    let contentText = ''
    for (const selector of [
      '.modal-body', '.modal-content', '.assessment-detail',
      '.component-content', '[class*="modal"]', '[role="dialog"]',
      '.content-area', '#content', 'main'
    ]) {
      const el = page.locator(selector).first()
      if (await el.count() > 0) {
        const text = await el.textContent()
        if (text && text.length > 50) {
          contentText = text
          break
        }
      }
    }

    // If we're on a full detail page (not a modal), get the main content
    if (!contentText || contentText.length < 50) {
      // Check if we navigated to a detail page (URL changed)
      const currentUrl = page.url()
      if (currentUrl.includes('/learning/assessments/')) {
        // We're on the detail page — get the content block, not the whole body
        const mainContent = page.locator('.assessment-content, .content-wrapper, [class*="assessment"], main .component-content').first()
        if (await mainContent.count() > 0) {
          contentText = await mainContent.textContent() || ''
        }
      }
    }

    // Last resort: get body text but try to exclude nav/sidebar
    if (!contentText || contentText.length < 50) {
      // Try body minus obvious nav elements
      contentText = await page.evaluate(() => {
        const body = document.body.cloneNode(true) as HTMLElement
        // Remove nav, sidebar, footer elements
        body.querySelectorAll('nav, .sidebar, .nav, #sidebar, footer, .footer, [class*="menu"], [class*="navigation"]').forEach(el => el.remove())
        return body.textContent || ''
      })
    }

    const fields = parseDueWorkFields(contentText)

    // Extract and download attachments from the modal
    const attachments: AttachmentInfo[] = []
    const attachmentsDir = join(config.dataDir, 'attachments', String(i))
    const downloadLinks = await page.locator('a[href*="download"], a[href*="/file/"], a[href*="/storage/fetch"]').all()
    for (const dl of downloadLinks) {
      const dlHref = await dl.getAttribute('href') || ''
      const dlText = (await dl.textContent())?.trim() || ''
      if (dlText.length > 2 && dlHref) {
        const fullUrl = dlHref.startsWith('http') ? dlHref : `${baseUrl}${dlHref}`
        let filePath: string | null = null

        // Download the attachment file
        try {
          if (!existsSync(attachmentsDir)) mkdirSync(attachmentsDir, { recursive: true })
          const safeName = dlText.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
          filePath = join(attachmentsDir, safeName)

          const response = await page.context().request.get(fullUrl)
          if (response.ok()) {
            const buffer = await response.body()
            const ws = createWriteStream(filePath)
            ws.write(buffer)
            ws.end()
            console.log(`    Attachment: downloaded "${dlText}"`)
          } else {
            filePath = null
          }
        } catch (err) {
          console.warn(`    Attachment: failed to download "${dlText}":`, err)
          filePath = null
        }

        attachments.push({
          name: dlText.replace(/\s+/g, ' '),
          size: '',
          url: fullUrl,
          filePath
        })
      }
    }

    // Navigate directly to the assessment detail page for full content
    let extendedDescription = ''
    try {
      // Close any modal first
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      // Navigate to the full detail page using the assessment URL
      await page.goto(schoolboxUrl, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(1500)

      // Extract content from the detail page, excluding nav/sidebar
      const detailBody = await page.evaluate(() => {
        const body = document.body.cloneNode(true) as HTMLElement
        body.querySelectorAll('nav, .sidebar, .nav, #sidebar, footer, .footer, [class*="menu"], [class*="navigation"], header, .header').forEach(el => el.remove())
        return body.textContent || ''
      })

      if (detailBody.length > 50) {
        // Re-parse with the clean detail page content
        const detailFields = parseDueWorkFields(detailBody)
        if (detailFields.description && detailFields.description.length > fields.description.length) {
          fields.description = detailFields.description
        }
        if (detailFields.criteria && detailFields.criteria.length > fields.criteria.length) {
          fields.criteria = detailFields.criteria
        }
        if (detailFields.terminology && detailFields.terminology.length > fields.terminology.length) {
          fields.terminology = detailFields.terminology
        }
        if (detailFields.materials && detailFields.materials.length > fields.materials.length) {
          fields.materials = detailFields.materials
        }
        if (detailFields.aiPolicy && detailFields.aiPolicy.length > fields.aiPolicy.length) {
          fields.aiPolicy = detailFields.aiPolicy
        }

        // If still no description from structured extraction, get the main content block
        if (!fields.description || fields.description.length < 30) {
          extendedDescription = detailBody.trim().replace(/\s+/g, ' ').slice(0, 5000)
        }
      }

      // Also check for additional attachments on the detail page
      const detailAttachLinks = await page.locator('a[href*="download"], a[href*="/file/"], a[href*="/storage/fetch"]').all()
      for (const dl of detailAttachLinks) {
        const dlHref = await dl.getAttribute('href') || ''
        const dlText = (await dl.textContent())?.trim() || ''
        if (dlText.length > 2 && dlHref && !attachments.some(a => a.url.includes(dlHref))) {
          const fullUrl = dlHref.startsWith('http') ? dlHref : `${baseUrl}${dlHref}`
          let filePath: string | null = null

          try {
            if (!existsSync(attachmentsDir)) mkdirSync(attachmentsDir, { recursive: true })
            const safeName = dlText.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
            filePath = join(attachmentsDir, safeName)
            const response = await page.context().request.get(fullUrl)
            if (response.ok()) {
              const buffer = await response.body()
              const ws = createWriteStream(filePath)
              ws.write(buffer)
              ws.end()
              console.log(`    Detail attachment: downloaded "${dlText}"`)
            } else {
              filePath = null
            }
          } catch {
            filePath = null
          }

          attachments.push({
            name: dlText.replace(/\s+/g, ' '),
            size: '',
            url: fullUrl,
            filePath
          })
        }
      }
    } catch (err) {
      // Detail page extraction is best-effort
      console.warn(`    Detail page: failed for "${title}":`, err)
    }

    // Merge extended description if richer
    if (extendedDescription && extendedDescription.length > fields.description.length) {
      fields.description = extendedDescription
    }

    items.push({ schoolboxUrl, title, ...fields, attachments })

    console.log(`  [${i + 1}/${totalCount}] ${title}`)

    // Close modal (if still open)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }

  console.log(`Due work: ${items.length} items extracted (${items.filter(i => i.description).length} with details)`)
  return items
}
