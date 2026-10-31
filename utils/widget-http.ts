import type { NextRequest } from 'next/server'
import { ok, type Result } from '@/src/lib/result'
import { WIDGET_TOKEN_HEADER } from '@/src/lib/whatsapp/widget'
import {
  WhatsAppWidgetPublicService,
  type WidgetContext,
} from '@/src/services/whatsapp-widget-public.service'

/**
 * CORS of the site chat widget endpoints. The answer echoes the request
 * `Origin` only after the key and the origin passed `authorize`: the browser
 * of any other site gets no CORS headers and cannot read anything.
 */
function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${WIDGET_TOKEN_HEADER}`,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function withWidgetCors(response: Response, origin: string): Response {
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    response.headers.set(key, value)
  }
  return response
}

/** Preflight: 204 with CORS only when the key and the origin are valid. */
export async function widgetPreflight(request: NextRequest): Promise<Response> {
  const origin = request.headers.get('origin')
  const key = request.nextUrl.searchParams.get('key')
  if (!origin || !key) return new Response(null, { status: 403 })
  const ctx = await WhatsAppWidgetPublicService.authorize(key, origin)
  if (!ctx.ok) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

export function widgetTokenFrom(request: Request): string | null {
  const token = request.headers.get(WIDGET_TOKEN_HEADER)?.trim()
  return token && token.length <= 200 ? token : null
}

/**
 * Key + `Origin` check of a public call. On success `origin` is the exact,
 * allowed value to echo back in the CORS headers.
 */
export async function authorizeWidgetRequest(
  request: Request,
  key: string,
): Promise<Result<{ ctx: WidgetContext; origin: string }>> {
  const origin = request.headers.get('origin')
  const ctx = await WhatsAppWidgetPublicService.authorize(key, origin)
  if (!ctx.ok) return ctx
  // `authorize` only passes an allowed (hence present) origin.
  return ok({ ctx: ctx.value, origin: origin as string })
}
