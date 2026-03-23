import 'dotenv/config'

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/schoolbox_scraper',
  scraperApiKey: process.env.SCRAPER_API_KEY || '',
  schoolbox: {
    url: process.env.SCHOOLBOX_URL || 'https://mytyndale.tyndale.edu.au/',
    username: process.env.SCHOOLBOX_USERNAME || '',
    password: process.env.SCHOOLBOX_PASSWORD || '',
    studentId: process.env.SCHOOLBOX_STUDENT_ID || '8087',
    parentId: process.env.SCHOOLBOX_PARENT_ID || '8166'
  },
  dataDir: process.env.DATA_DIR || './data'
} as const

export function validateConfig(): void {
  const required = [
    ['DATABASE_URL', config.databaseUrl],
    ['SCRAPER_API_KEY', config.scraperApiKey]
  ] as const

  const missing = required.filter(([, value]) => !value).map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}
