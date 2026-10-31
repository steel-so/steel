import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import {
  WHATSAPP_META_APP_SECRET,
  WHATSAPP_META_VERIFY_TOKEN,
} from '@/lib/env/server'
import { parseSocialWebhook } from '@/src/lib/whatsapp/meta-social'
import { WhatsAppMetaSocialWebhookService } from '@/src/services/whatsapp-meta-social-webhook.service'
import { parseJson } from '@/utils/http-request'

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!WHATSAPP_META_APP_SECRET) return false
  if (!signatureHeader?.startsWith('sha256=')) return false

  const expected = createHmac('sha256', WHATSAPP_META_APP_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex')
  const provided = signatureHeader.slice('sha256='.length)

  if (expected.length !== provided.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}

/** Webhook verification handshake (same verify token as the WhatsApp one). */
export const GET = withAxiom(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (
    mode === 'subscribe' &&
    token &&
    WHATSAPP_META_VERIFY_TOKEN &&
    token === WHATSAPP_META_VERIFY_TOKEN
  ) {
    return new Response(challenge ?? '', { status: 200 })
  }

  return new Response('Token inválido', { status: 403 })
})

/**
 * Instagram (`object: instagram`) and Facebook Page (`object: page`)
 * webhooks: DMs, echoes of replies sent in the apps, and comments. The
 * workspace comes from the connection behind the Page / account id.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const rawBody = await request.text()

  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return new Response('Assinatura inválida', { status: 401 })
  }

  const parsedBody = parseJson(rawBody)
  if (!parsedBody.ok) {
    return new Response('Entrada inválida', { status: 400 })
  }

  const events = parseSocialWebhook(parsedBody.value)
  if (events.length === 0) {
    return new Response('SEM_EVENTOS', { status: 200 })
  }

  const result = await WhatsAppMetaSocialWebhookService.ingest(events)
  if (!result.ok) {
    const limited = result.error.code === 'RATE_LIMITED'
    return new Response(limited ? 'Muitas requisições' : 'Erro interno', {
      status: limited ? 429 : 500,
    })
  }

  return new Response('EVENT_RECEIVED', { status: 200 })
})
