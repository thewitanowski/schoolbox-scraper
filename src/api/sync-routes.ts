import { FastifyInstance } from 'fastify'
import pg from 'pg'
import { createReadStream, existsSync } from 'fs'

export function registerSyncRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/api/sync/last-updated', async () => {
    const { rows } = await pool.query(
      `SELECT id, status, completed_at, started_at,
              timetable_count, due_work_count, grades_count, feed_count, schedules_count
       FROM scrape_runs ORDER BY id DESC LIMIT 1`
    )
    if (rows.length === 0) {
      return { lastScrape: null, status: 'no_data' }
    }
    const run = rows[0]
    return {
      lastScrape: run.completed_at || run.started_at,
      status: run.status,
      counts: {
        timetable: run.timetable_count,
        dueWork: run.due_work_count,
        grades: run.grades_count,
        feed: run.feed_count,
        schedules: run.schedules_count
      }
    }
  })

  app.get<{ Querystring: { since?: string } }>('/api/sync/subjects', async (request) => {
    const since = request.query.since
    let query = 'SELECT id, schoolbox_code, name, teacher, updated_at FROM schoolbox_subjects'
    const params: unknown[] = []

    if (since) {
      query += ' WHERE updated_at > $1'
      params.push(since)
    }

    query += ' ORDER BY name'
    const { rows } = await pool.query(query, params)
    return { data: rows, lastUpdated: new Date().toISOString() }
  })

  app.get<{ Querystring: { since?: string } }>('/api/sync/timetable', async (request) => {
    // Return timetable from the latest successful scrape
    const { rows: runs } = await pool.query(
      "SELECT id FROM scrape_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1"
    )
    if (runs.length === 0) return { data: [], lastUpdated: null }

    const runId = runs[0].id
    const { rows } = await pool.query(
      `SELECT id, day_name, week, period_label, start_time, end_time, subject_code, room
       FROM schoolbox_timetable WHERE scrape_run_id = $1
       ORDER BY day_name, start_time`,
      [runId]
    )
    return { data: rows, lastUpdated: new Date().toISOString() }
  })

  app.get<{ Querystring: { since?: string } }>('/api/sync/due-work', async (request) => {
    const since = request.query.since
    let query = `SELECT dw.id, dw.schoolbox_url, dw.title, dw.subject, dw.subject_code,
                        dw.type, dw.due_date, dw.status, dw.weighting, dw.description,
                        dw.criteria, dw.materials, dw.terminology, dw.ai_policy, dw.teacher,
                        dw.updated_at,
                        COALESCE(json_agg(json_build_object(
                          'id', a.id, 'name', a.name, 'size', a.size, 'url', a.url,
                          'file_path', a.file_path
                        )) FILTER (WHERE a.id IS NOT NULL), '[]') as attachments
                 FROM schoolbox_due_work dw
                 LEFT JOIN schoolbox_attachments a ON a.due_work_id = dw.id`
    const params: unknown[] = []

    if (since) {
      query += ' WHERE dw.updated_at > $1'
      params.push(since)
    }

    query += ' GROUP BY dw.id ORDER BY dw.due_date'
    const { rows } = await pool.query(query, params)
    return { data: rows, lastUpdated: new Date().toISOString() }
  })

  app.get<{ Querystring: { since?: string } }>('/api/sync/grades', async (request) => {
    const since = request.query.since
    let query = `SELECT id, subject, subject_code, teacher, assessment_name,
                        status, type, due_date, grade, feedback, updated_at
                 FROM schoolbox_grades`
    const params: unknown[] = []

    if (since) {
      query += ' WHERE updated_at > $1'
      params.push(since)
    }

    query += ' ORDER BY subject, due_date'
    const { rows } = await pool.query(query, params)
    return { data: rows, lastUpdated: new Date().toISOString() }
  })

  app.get<{ Querystring: { since?: string } }>('/api/sync/feed', async (request) => {
    const since = request.query.since
    let query = `SELECT id, feed_date, title, teacher, subject, time, grade, feedback, detail_url, created_at
                 FROM schoolbox_feed`
    const params: unknown[] = []

    if (since) {
      query += ' WHERE created_at > $1'
      params.push(since)
    }

    query += ' ORDER BY created_at DESC LIMIT 100'
    const { rows } = await pool.query(query, params)
    return { data: rows, lastUpdated: new Date().toISOString() }
  })

  app.get('/api/sync/schedules', async () => {
    const { rows } = await pool.query(
      'SELECT id, subject_name, pdf_url, downloaded_at FROM schoolbox_schedules ORDER BY subject_name'
    )
    return { data: rows, lastUpdated: new Date().toISOString() }
  })

  app.get<{ Params: { id: string } }>('/api/sync/attachments/:id', async (request, reply) => {
    const { id } = request.params
    const { rows } = await pool.query(
      'SELECT name, file_path FROM schoolbox_attachments WHERE id = $1',
      [id]
    )

    if (rows.length === 0 || !rows[0].file_path) {
      reply.code(404).send({ error: 'Attachment not found' })
      return
    }

    const filePath = rows[0].file_path
    if (!existsSync(filePath)) {
      reply.code(404).send({ error: 'File not found on disk' })
      return
    }

    const ext = filePath.split('.').pop()?.toLowerCase() || 'bin'
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }

    reply.header('Content-Type', mimeMap[ext] || 'application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename="${rows[0].name}"`)
    return reply.send(createReadStream(filePath))
  })
}
