import pg from 'pg'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../../migrations')

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect()

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Get applied migrations
    const { rows: applied } = await client.query(
      'SELECT version FROM _migrations ORDER BY version'
    )
    const appliedVersions = new Set(applied.map((r) => r.version))

    // Read migration files (001-name.sql, 002-name.sql, etc.)
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const version = parseInt(file.split('-')[0], 10)
      if (isNaN(version) || appliedVersions.has(version)) continue

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
      const name = file.replace(/\.sql$/, '')

      console.log(`Running migration ${name}...`)

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO _migrations (version, name) VALUES ($1, $2)',
          [version, name]
        )
        await client.query('COMMIT')
        console.log(`  Applied: ${name}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${name} failed: ${err}`)
      }
    }

    console.log('Migrations complete')
  } finally {
    client.release()
  }
}

// Allow running directly: tsx src/db/migrate.ts
if (process.argv[1]?.includes('migrate')) {
  const { config } = await import('../config.js')
  const { Pool } = pg
  const pool = new Pool({ connectionString: config.databaseUrl })
  await runMigrations(pool)
  await pool.end()
}
