import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('SCRAPER_API_KEY', 'test-key')
vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
vi.stubEnv('SCHOOLBOX_URL', 'https://mytyndale.tyndale.edu.au/')
vi.stubEnv('DATA_DIR', '/tmp/test-scraper')

const { parseTimetableEvent, extractSubjects } = await import('../src/scraper/timetable.scraper.js')
const { parseDueWorkFields } = await import('../src/scraper/due-work.scraper.js')
const { parseFeedItems } = await import('../src/scraper/feed.scraper.js')
const { parseGradeEntries } = await import('../src/scraper/grades.scraper.js')

describe('Timetable parser', () => {
  it('parses a standard timetable event', () => {
    const result = parseTimetableEvent('9:10am - 9:58am Monday B, Period 1, 7SCI C, N10')
    expect(result).toEqual({
      startTime: '9:10am',
      endTime: '9:58am',
      dayName: 'Monday',
      week: 'B',
      periodLabel: 'Period 1',
      subjectCode: '7SCI C',
      room: 'N10'
    })
  })

  it('parses pastoral care period', () => {
    const result = parseTimetableEvent('8:45am - 9:10am Monday B, Pastoral Care, 7PC C, M4')
    expect(result).toEqual({
      startTime: '8:45am',
      endTime: '9:10am',
      dayName: 'Monday',
      week: 'B',
      periodLabel: 'Pastoral Care',
      subjectCode: '7PC C',
      room: 'M4'
    })
  })

  it('handles pm times', () => {
    const result = parseTimetableEvent('1:55pm - 2:43pm Friday A, Period 5, 7MATS4 C, M8')
    expect(result).toEqual({
      startTime: '1:55pm',
      endTime: '2:43pm',
      dayName: 'Friday',
      week: 'A',
      periodLabel: 'Period 5',
      subjectCode: '7MATS4 C',
      room: 'M8'
    })
  })

  it('returns null for invalid input', () => {
    expect(parseTimetableEvent('')).toBeNull()
    expect(parseTimetableEvent('invalid text')).toBeNull()
    expect(parseTimetableEvent('some random content here')).toBeNull()
  })

  it('handles extra whitespace', () => {
    const result = parseTimetableEvent('  9:10am  -  9:58am   Monday   B,  Period 1,  7SCI C,  N10  ')
    expect(result).not.toBeNull()
    expect(result!.subjectCode).toBe('7SCI C')
  })

  it('extractSubjects collects unique subject codes', () => {
    const periods = [
      { dayName: 'Monday', week: 'A', periodLabel: 'Period 1', startTime: '9:10am', endTime: '9:58am', subjectCode: '7SCI C', room: 'N10' },
      { dayName: 'Monday', week: 'A', periodLabel: 'Period 2', startTime: '9:58am', endTime: '10:46am', subjectCode: '7ENG C', room: 'M5' },
      { dayName: 'Tuesday', week: 'A', periodLabel: 'Period 1', startTime: '9:10am', endTime: '9:58am', subjectCode: '7SCI C', room: 'N10' }
    ]
    const subjects = extractSubjects(periods)
    expect(subjects.size).toBe(2)
    expect(subjects.has('7SCI C')).toBe(true)
    expect(subjects.has('7ENG C')).toBe(true)
  })
})

describe('Due work parser', () => {
  it('extracts structured fields from assessment body text', () => {
    const bodyText = `
      Science - 1/C (7SCI C) Assessment Task 1
      TEACHER: Mr Smith
      DUE DATE Monday, March 30, 2026
      WEIGHTING 25%
      Not submitted
      TASK DESCRIPTION This is a research task about ecosystems.
      WHAT I AM LOOKING FOR Clear understanding of food chains.
      WHAT I NEED A4 paper, colored pencils
      KEY TERMINOLOGY ecosystem, biome, habitat
      USE OF ARTIFICIAL INTELLIGENCE (AI) AI may be used for research only.
    `

    const result = parseDueWorkFields(bodyText)
    expect(result.subject).toBe('Science')
    expect(result.subjectCode).toBe('7SCI C')
    expect(result.type).toBe('Assessment Task 1')
    expect(result.teacher).toBe('Mr Smith')
    expect(result.dueDate).toBe('Monday, March 30, 2026')
    expect(result.weighting).toBe('25%')
    expect(result.status).toBe('Not submitted')
    expect(result.description).toContain('research task about ecosystems')
    expect(result.criteria).toContain('food chains')
    expect(result.materials).toContain('colored pencils')
    expect(result.terminology).toContain('ecosystem')
    expect(result.aiPolicy).toContain('research only')
  })

  it('handles missing fields gracefully', () => {
    const result = parseDueWorkFields('Some random page content with no structured fields')
    expect(result.subject).toBe('')
    expect(result.type).toBe('')
    expect(result.description).toBe('')
  })

  it('parses homework type', () => {
    const result = parseDueWorkFields('Homework\nDUE DATE Friday, March 27, 2026')
    expect(result.type).toBe('Homework')
    expect(result.dueDate).toBe('Friday, March 27, 2026')
  })
})

describe('Feed parser', () => {
  it('parses feed items from body text', () => {
    const bodyText = `
      2 DAYS AGO PE - Active Participation Reviewed by Mr Clement Tang in PDHPE - 7/C | 12:38pm Great effort today!
      TODAY Homework Check Reviewed by Ms Jones in Mathematics - 7/C | 3:15pm Well done.
    `

    const items = parseFeedItems(bodyText)
    expect(items.length).toBe(2)

    expect(items[0].feedDate).toBe('2 DAYS AGO')
    expect(items[0].title).toBe('PE - Active Participation')
    expect(items[0].teacher).toBe('Mr Clement Tang')
    expect(items[0].subject).toBe('PDHPE - 7/C')
    expect(items[0].time).toBe('12:38pm')

    expect(items[1].feedDate).toBe('TODAY')
    expect(items[1].title).toBe('Homework Check')
    expect(items[1].teacher).toBe('Ms Jones')
  })

  it('returns empty array for text without feed items', () => {
    const items = parseFeedItems('No feed items here')
    expect(items).toEqual([])
  })
})

describe('Grades parser', () => {
  it('parses grade entries from section text', () => {
    const section = `
      Ecosystem Research Task Not submitted Assessment Task 1 Due March 30, 2026
      Homework Week 5 Submitted on time Homework Due March 20, 2026
    `
    const entries = parseGradeEntries(section, 'Science', '7SCI C', 'Mr Smith')

    expect(entries.length).toBe(2)
    expect(entries[0].assessmentName).toBe('Ecosystem Research Task')
    expect(entries[0].status).toBe('Not submitted')
    expect(entries[0].type).toBe('Assessment Task 1')
    expect(entries[0].subject).toBe('Science')
    expect(entries[0].subjectCode).toBe('7SCI C')
    expect(entries[0].teacher).toBe('Mr Smith')

    expect(entries[1].assessmentName).toBe('Homework Week 5')
    expect(entries[1].status).toBe('Submitted on time')
    expect(entries[1].type).toBe('Homework')
  })

  it('parses graded entries with scores', () => {
    const section = `
      Quick Quiz Reviewed Continuous Assessment Due March 15, 2026 3 / 5 Good understanding shown
    `
    const entries = parseGradeEntries(section, 'Maths', '7MAT C', 'Ms Lee')

    expect(entries.length).toBe(1)
    expect(entries[0].assessmentName).toBe('Quick Quiz')
    expect(entries[0].grade).toBe('3 / 5')
    expect(entries[0].feedback).toContain('Good understanding')
  })

  it('avoids duplicate entries', () => {
    const section = `
      Quiz 1 Reviewed Homework Due March 10, 2026
      Quiz 1 Reviewed Homework Due March 10, 2026 3 / 5 Feedback
    `
    const entries = parseGradeEntries(section, 'Maths', '7MAT C', 'Ms Lee')
    // Should only appear once (first regex captures it)
    const quizEntries = entries.filter(e => e.assessmentName === 'Quiz 1')
    expect(quizEntries.length).toBe(1)
  })

  it('returns empty array for no matches', () => {
    const entries = parseGradeEntries('No grade entries here', 'Science', '7SCI', 'Mr X')
    expect(entries).toEqual([])
  })
})
