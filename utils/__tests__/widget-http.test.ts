import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/whatsapp-widget-public.service', () => ({
  WhatsAppWidgetPublicService: { authorize: vi.fn() },
}))

import { WhatsAppWidgetPublicService } from '@/src/services/whatsapp-widget-public.service'
import {
  authorizeWidgetRequest,
  widgetPreflight,
  widgetTokenFrom,
  withWidgetCors,
} from '../widget-http'

const authorize = vi.mocked(WhatsAppWidgetPublicService.authorize)
const ORIGIN = 'https://cliente.example.com'

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: 'OPTIONS', headers })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('withWidgetCors', () => {
  it('should echo the given origin and vary on it', () => {
    const response = withWidgetCors(new Response('{}'), ORIGIN)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(response.headers.get('vary')).toBe('Origin')
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'x-steel-widget-token',
    )
  })
})

describe('widgetPreflight', () => {
  it('should answer 204 with CORS for a valid key and origin', async () => {
    authorize.mockResolvedValue(ok({} as never))
    const response = await widgetPreflight(
      request('https://steel.test/api/widget/messages?key=stw_a', {
        origin: ORIGIN,
      }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(authorize).toHaveBeenCalledWith('stw_a', ORIGIN)
  })

  it('should answer 403 without CORS when the origin or key is missing', async () => {
    const noOrigin = await widgetPreflight(
      request('https://steel.test/api/widget/messages?key=stw_a'),
    )
    const noKey = await widgetPreflight(
      request('https://steel.test/api/widget/messages', { origin: ORIGIN }),
    )
    expect(noOrigin.status).toBe(403)
    expect(noKey.status).toBe(403)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('should answer 403 without CORS when the check fails', async () => {
    authorize.mockResolvedValue(err(databaseError('x')))
    const response = await widgetPreflight(
      request('https://steel.test/api/widget/messages?key=stw_a', {
        origin: ORIGIN,
      }),
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('widgetTokenFrom', () => {
  it('should read the token header', () => {
    const req = new Request('https://x.test', {
      headers: { 'x-steel-widget-token': ' tok ' },
    })
    expect(widgetTokenFrom(req)).toBe('tok')
  })

  it('should ignore a missing, empty or oversized token', () => {
    expect(widgetTokenFrom(new Request('https://x.test'))).toBeNull()
    expect(
      widgetTokenFrom(
        new Request('https://x.test', {
          headers: { 'x-steel-widget-token': '   ' },
        }),
      ),
    ).toBeNull()
    expect(
      widgetTokenFrom(
        new Request('https://x.test', {
          headers: { 'x-steel-widget-token': 'a'.repeat(201) },
        }),
      ),
    ).toBeNull()
  })
})

describe('authorizeWidgetRequest', () => {
  it('should return the context and the allowed origin', async () => {
    const ctx = { workspaceId: 'ws1' } as never
    authorize.mockResolvedValue(ok(ctx))
    const result = await authorizeWidgetRequest(
      new Request('https://x.test', { headers: { origin: ORIGIN } }),
      'stw_a',
    )
    expect(result).toEqual({ ok: true, value: { ctx, origin: ORIGIN } })
  })

  it('should pass the failure through', async () => {
    authorize.mockResolvedValue(err(databaseError('x')))
    const result = await authorizeWidgetRequest(
      new Request('https://x.test'),
      'stw_a',
    )
    expect(result.ok).toBe(false)
    expect(authorize).toHaveBeenCalledWith('stw_a', null)
  })
})
