import { FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'

export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key']

  if (!apiKey) {
    reply.code(401).send({ error: 'Missing X-API-Key header' })
    return
  }

  if (apiKey !== config.scraperApiKey) {
    reply.code(403).send({ error: 'Invalid API key' })
    return
  }
}
