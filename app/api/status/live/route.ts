import { connection } from 'next/server'
import { successResponse } from '@/utils/http-response'

/**
 * Liveness of this app process, for the container healthcheck and the
 * rolling deploy (ADR 0038): answers as soon as the server serves requests,
 * without touching Postgres or Redis (those are the status page's job), so a
 * database blip never takes every replica out of nginx's upstream at once.
 *
 * Not wrapped in `withAxiom` and not rate limited on purpose: Docker probes
 * each replica every few seconds, and logging that would drown the request
 * log in health checks.
 */
export async function GET() {
  // Render per request: with Cache Components a GET that reads nothing from
  // the request would be prerendered at build and answer even from a broken
  // process.
  await connection()
  const response = successResponse({ status: 'ok' as const })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
