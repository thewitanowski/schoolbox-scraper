import pg from 'pg'
import { TimetablePeriod, DueWorkItem, GradeEntry, FeedItem, ScheduleInfo } from './types.js'

export class ScrapeRepository {
  constructor(private pool: pg.Pool) {}

  async createRun(): Promise<number> {
    const { rows } = await this.pool.query(
      'INSERT INTO scrape_runs (status) VALUES ($1) RETURNING id',
      ['running']
    )
    return rows[0].id
  }

  async completeRun(runId: number, counts: Record<string, number>): Promise<void> {
    await this.pool.query(
      `UPDATE scrape_runs SET
        status = 'success',
        completed_at = NOW(),
        timetable_count = $2,
        due_work_count = $3,
        grades_count = $4,
        feed_count = $5,
        schedules_count = $6
      WHERE id = $1`,
      [runId, counts.timetable || 0, counts.dueWork || 0, counts.grades || 0, counts.feed || 0, counts.schedules || 0]
    )
  }

  async failRun(runId: number, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE scrape_runs SET status = 'failed', completed_at = NOW(), error_message = $2 WHERE id = $1`,
      [runId, error.slice(0, 2000)]
    )
  }

  async getLatestRun(): Promise<{ id: number; status: string; completedAt: string | null } | null> {
    const { rows } = await this.pool.query(
      'SELECT id, status, completed_at as "completedAt" FROM scrape_runs ORDER BY id DESC LIMIT 1'
    )
    return rows[0] || null
  }

  async saveTimetable(runId: number, periods: TimetablePeriod[]): Promise<void> {
    if (periods.length === 0) return

    const values: unknown[] = []
    const placeholders: string[] = []
    let idx = 1

    for (const p of periods) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`)
      values.push(runId, p.dayName, p.week, p.periodLabel, p.startTime, p.endTime, p.subjectCode, p.room)
    }

    await this.pool.query(
      `INSERT INTO schoolbox_timetable (scrape_run_id, day_name, week, period_label, start_time, end_time, subject_code, room)
       VALUES ${placeholders.join(', ')}`,
      values
    )
  }

  async saveSubjects(subjects: Map<string, string>): Promise<void> {
    for (const [code, name] of subjects) {
      await this.pool.query(
        `INSERT INTO schoolbox_subjects (schoolbox_code, name)
         VALUES ($1, $2)
         ON CONFLICT (schoolbox_code) DO UPDATE SET name = $2, updated_at = NOW()`,
        [code, name]
      )
    }
  }

  async saveDueWork(runId: number, items: DueWorkItem[]): Promise<void> {
    for (const item of items) {
      const { rows } = await this.pool.query(
        `INSERT INTO schoolbox_due_work
          (scrape_run_id, schoolbox_url, title, subject, subject_code, type, due_date, status, weighting, description, criteria, materials, terminology, ai_policy, teacher)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (schoolbox_url) DO UPDATE SET
          scrape_run_id = $1, title = $3, subject = $4, subject_code = $5, type = $6,
          due_date = $7, status = $8, weighting = $9, description = $10, criteria = $11,
          materials = $12, terminology = $13, ai_policy = $14, teacher = $15, updated_at = NOW()
         RETURNING id`,
        [runId, item.schoolboxUrl, item.title, item.subject, item.subjectCode, item.type,
         item.dueDate, item.status, item.weighting, item.description, item.criteria,
         item.materials, item.terminology, item.aiPolicy, item.teacher]
      )

      const dueWorkId = rows[0].id

      // Save attachments
      for (const att of item.attachments) {
        await this.pool.query(
          `INSERT INTO schoolbox_attachments (due_work_id, name, size, url)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (url) DO UPDATE SET due_work_id = $1, name = $2, size = $3`,
          [dueWorkId, att.name, att.size, att.url]
        )
      }
    }
  }

  async saveGrades(runId: number, entries: GradeEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.pool.query(
        `INSERT INTO schoolbox_grades
          (scrape_run_id, subject, subject_code, teacher, assessment_name, status, type, due_date, grade, feedback)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (subject_code, assessment_name) DO UPDATE SET
          scrape_run_id = $1, teacher = $4, status = $6, type = $7,
          due_date = $8, grade = $9, feedback = $10, updated_at = NOW()`,
        [runId, entry.subject, entry.subjectCode, entry.teacher, entry.assessmentName,
         entry.status, entry.type, entry.dueDate, entry.grade, entry.feedback]
      )
    }
  }

  async saveFeed(runId: number, items: FeedItem[]): Promise<void> {
    for (const item of items) {
      await this.pool.query(
        `INSERT INTO schoolbox_feed
          (scrape_run_id, feed_date, title, teacher, subject, time, grade, feedback, detail_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (title, feed_date, subject) DO NOTHING`,
        [runId, item.feedDate, item.title, item.teacher, item.subject,
         item.time, item.grade, item.feedback, item.detailUrl]
      )
    }
  }

  async saveSchedules(items: ScheduleInfo[]): Promise<void> {
    for (const item of items) {
      await this.pool.query(
        `INSERT INTO schoolbox_schedules (subject_name, pdf_url, file_path, downloaded_at)
         VALUES ($1, $2, $3, CASE WHEN $3 IS NOT NULL THEN NOW() ELSE NULL END)
         ON CONFLICT (pdf_url) DO UPDATE SET
          file_path = COALESCE($3, schoolbox_schedules.file_path),
          downloaded_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE schoolbox_schedules.downloaded_at END`,
        [item.subjectName, item.pdfUrl, item.filePath]
      )
    }
  }
}
