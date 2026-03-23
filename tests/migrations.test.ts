import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

vi.stubEnv('SCRAPER_API_KEY', 'test-key')
vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Migration SQL', () => {
  it('contains valid SQL structure for all required tables', () => {
    const sql = readFileSync(
      join(__dirname, '../migrations/001-initial-schema.sql'),
      'utf-8'
    )

    // Check all required tables are defined
    const requiredTables = [
      'scrape_runs',
      'schoolbox_subjects',
      'schoolbox_timetable',
      'schoolbox_due_work',
      'schoolbox_grades',
      'schoolbox_feed',
      'schoolbox_schedules',
      'schoolbox_attachments'
    ]

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE ${table}`)
    }
  })

  it('has unique constraints on natural keys', () => {
    const sql = readFileSync(
      join(__dirname, '../migrations/001-initial-schema.sql'),
      'utf-8'
    )

    // Natural key constraints for dedup
    expect(sql).toContain('schoolbox_code TEXT NOT NULL UNIQUE')
    expect(sql).toContain('schoolbox_url TEXT NOT NULL UNIQUE')
    expect(sql).toContain('UNIQUE (subject_code, assessment_name)')
    expect(sql).toContain('UNIQUE (title, feed_date, subject)')
    expect(sql).toContain('pdf_url TEXT NOT NULL UNIQUE')
    expect(sql).toContain('url TEXT NOT NULL UNIQUE')
  })

  it('has foreign keys to scrape_runs', () => {
    const sql = readFileSync(
      join(__dirname, '../migrations/001-initial-schema.sql'),
      'utf-8'
    )

    // All data tables reference scrape_runs
    const fkCount = (sql.match(/REFERENCES scrape_runs/g) || []).length
    expect(fkCount).toBeGreaterThanOrEqual(4) // timetable, due_work, grades, feed
  })

  it('has indexes on commonly queried columns', () => {
    const sql = readFileSync(
      join(__dirname, '../migrations/001-initial-schema.sql'),
      'utf-8'
    )

    expect(sql).toContain('CREATE INDEX idx_timetable_scrape')
    expect(sql).toContain('CREATE INDEX idx_due_work_subject')
    expect(sql).toContain('CREATE INDEX idx_grades_subject')
    expect(sql).toContain('CREATE INDEX idx_feed_date')
  })
})
