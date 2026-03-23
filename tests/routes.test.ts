import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.stubEnv('SCRAPER_API_KEY', 'test-api-key')
vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')

// Mock pg pool that returns predictable data
function createMockPool() {
  const queryResults: Record<string, { rows: unknown[] }> = {
    'scrape_runs': {
      rows: [{
        id: 1,
        status: 'success',
        completed_at: '2026-03-23T06:00:00Z',
        started_at: '2026-03-23T05:55:00Z',
        timetable_count: 40,
        due_work_count: 8,
        grades_count: 25,
        feed_count: 12,
        schedules_count: 10
      }]
    },
    'schoolbox_subjects': {
      rows: [
        { id: 1, schoolbox_code: '7SCI C', name: 'Science', teacher: 'Mr Smith', updated_at: '2026-03-23T06:00:00Z' },
        { id: 2, schoolbox_code: '7ENG C', name: 'English', teacher: 'Ms Jones', updated_at: '2026-03-23T06:00:00Z' }
      ]
    },
    'schoolbox_timetable': {
      rows: [
        { id: 1, day_name: 'Monday', week: 'A', period_label: 'Period 1', start_time: '9:10am', end_time: '9:58am', subject_code: '7SCI C', room: 'N10' }
      ]
    },
    'schoolbox_due_work': {
      rows: [
        { id: 1, schoolbox_url: '/learning/assessments/123', title: 'Ecosystem Task', subject: 'Science', subject_code: '7SCI C', type: 'Assessment Task 1', due_date: 'March 30, 2026', status: 'Not submitted', weighting: '25%', description: 'Research', criteria: '', materials: '', terminology: '', ai_policy: '', teacher: 'Mr Smith', updated_at: '2026-03-23', attachments: '[]' }
      ]
    },
    'schoolbox_grades': {
      rows: [
        { id: 1, subject: 'Science', subject_code: '7SCI C', teacher: 'Mr Smith', assessment_name: 'Quiz 1', status: 'Reviewed', type: 'Homework', due_date: 'March 15, 2026', grade: '4 / 5', feedback: 'Good', updated_at: '2026-03-23' }
      ]
    },
    'schoolbox_feed': {
      rows: [
        { id: 1, feed_date: 'TODAY', title: 'Active Participation', teacher: 'Mr Tang', subject: 'PDHPE', time: '12:38pm', grade: '', feedback: 'Great effort', detail_url: '', created_at: '2026-03-23' }
      ]
    },
    'schoolbox_schedules': {
      rows: [
        { id: 1, subject_name: 'Science', pdf_url: '/storage/fetch.php?hash=abc', downloaded_at: '2026-03-23' }
      ]
    }
  }

  return {
    query: vi.fn().mockImplementation((sql: string) => {
      // Route to the right mock data based on query
      if (sql.includes('scrape_runs')) return Promise.resolve(queryResults['scrape_runs'])
      if (sql.includes('schoolbox_subjects')) return Promise.resolve(queryResults['schoolbox_subjects'])
      if (sql.includes('schoolbox_timetable')) return Promise.resolve(queryResults['schoolbox_timetable'])
      if (sql.includes('schoolbox_due_work')) return Promise.resolve(queryResults['schoolbox_due_work'])
      if (sql.includes('schoolbox_grades')) return Promise.resolve(queryResults['schoolbox_grades'])
      if (sql.includes('schoolbox_feed')) return Promise.resolve(queryResults['schoolbox_feed'])
      if (sql.includes('schoolbox_schedules')) return Promise.resolve(queryResults['schoolbox_schedules'])
      return Promise.resolve({ rows: [] })
    })
  } as any
}

const { buildServer } = await import('../src/api/server.js')

let app: FastifyInstance
const headers = { 'x-api-key': 'test-api-key' }

beforeAll(async () => {
  const mockPool = createMockPool()
  app = buildServer(mockPool)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('Sync API endpoints', () => {
  it('GET /api/sync/last-updated returns latest scrape run', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/last-updated', headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('success')
    expect(body.lastScrape).toBe('2026-03-23T06:00:00Z')
    expect(body.counts.timetable).toBe(40)
  })

  it('GET /api/sync/subjects returns subject list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/subjects', headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBe(2)
    expect(body.data[0].schoolbox_code).toBe('7SCI C')
    expect(body.lastUpdated).toBeDefined()
  })

  it('GET /api/sync/timetable returns periods', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/timetable', headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBe(1)
    expect(body.data[0].subject_code).toBe('7SCI C')
  })

  it('GET /api/sync/due-work returns assignments', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/due-work', headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBe(1)
    expect(body.data[0].title).toBe('Ecosystem Task')
  })

  it('GET /api/sync/grades returns grade entries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/grades', headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBe(1)
    expect(body.data[0].grade).toBe('4 / 5')
  })

  it('GET /api/sync/feed returns feed items', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/feed', headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBe(1)
    expect(body.data[0].teacher).toBe('Mr Tang')
  })

  it('GET /api/sync/schedules returns schedule metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/schedules', headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.length).toBe(1)
    expect(body.data[0].subject_name).toBe('Science')
  })

  it('supports ?since= parameter for incremental sync', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/subjects?since=2026-03-22T00:00:00Z',
      headers
    })
    expect(res.statusCode).toBe(200)
  })

  it('GET /api/sync/attachments/:id returns 404 for missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/attachments/999',
      headers
    })
    expect(res.statusCode).toBe(404)
  })
})
