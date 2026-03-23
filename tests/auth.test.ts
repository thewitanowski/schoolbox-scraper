import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Must set env BEFORE any app imports
vi.stubEnv('SCRAPER_API_KEY', 'test-api-key-123')
vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')

const { buildServer } = await import('../src/api/server.js')
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('Health check', () => {
  it('returns ok without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })
})

describe('API key authentication', () => {
  it('rejects requests without X-API-Key header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/last-updated'
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('Missing X-API-Key header')
  })

  it('rejects requests with wrong API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/last-updated',
      headers: { 'x-api-key': 'wrong-key' }
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('Invalid API key')
  })

  it('accepts requests with valid API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/last-updated',
      headers: { 'x-api-key': 'test-api-key-123' }
    })

    expect(response.statusCode).toBe(200)
  })

  it('does not require auth for non-api routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    })

    expect(response.statusCode).toBe(200)
  })
})
