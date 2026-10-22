import { apiFetch } from '@/src/hooks/_fetch'
import type { WebphoneCallTrackingDTO } from '@/types/whatsapp-phone-call'
import type { WebPhoneCallEvent } from './client'

/** What the phone knows about a call it is about to place. */
export interface OutboundCallInput {
  number: string
  name: string | null
  /** Conversation the call is placed from, when the UI knows it. */
  conversationId?: string | null
}

type Begin = {
  direction: 'in' | 'out'
  number: string
  name: string | null
  conversationId?: string
  pabxUniqueId?: string
}

/**
 * Reports the calls of the browser phone to the Steel (ADR 0044 addendum), so
 * each one lands in the conversation history and, when the workspace records
 * calls, the PABX recording reaches the ADR 0043 pipeline. Tracking never gets
 * in the way of the phone: every failure is swallowed.
 */
export class WebPhoneCallTracker {
  /** The call in progress, once the server knows it. */
  private current: Promise<WebphoneCallTrackingDTO | null> | null = null
  /** An outbound call was registered before dialing (its INVITE carries the token). */
  private preparedOutbound = false

  constructor(
    private readonly workspaceId: string,
    /** The recording notice the agent reads to the contact; `null` when not recorded. */
    private readonly onNotice: (notice: string | null) => void = () =>
      undefined,
  ) {}

  private url(path = ''): string {
    return `/api/workspaces/${encodeURIComponent(this.workspaceId)}/phone-calls${path}`
  }

  private begin(input: Begin): Promise<WebphoneCallTrackingDTO | null> {
    return apiFetch<WebphoneCallTrackingDTO>(
      this.url('/webphone'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Não foi possível registrar a ligação',
    ).catch(() => null)
  }

  /**
   * Registers an outbound call before the INVITE and returns the SIP headers
   * that make the PABX report and record it like a click-to-call.
   */
  async prepareOutbound(input: OutboundCallInput): Promise<string[]> {
    this.preparedOutbound = true
    this.current = this.begin({
      direction: 'out',
      number: input.number,
      name: input.name,
      conversationId: input.conversationId ?? undefined,
    })
    const tracking = await this.current
    this.onNotice(tracking?.call.recordingNotice ?? null)
    if (!tracking?.callbackToken) return []
    const headers = [
      `X-Steel-Callback-Url: ${tracking.callbackUrl}`,
      `X-Steel-Callback-Token: ${tracking.callbackToken}`,
    ]
    if (tracking.record) headers.push('X-Steel-Record: 1')
    return headers
  }

  /** The INVITE never left: closes the call registered for it as failed. */
  abandonPrepared(): void {
    if (!this.preparedOutbound) return
    this.preparedOutbound = false
    this.handle({ type: 'ended', answered: false, outcome: 'failed' })
  }

  /** Feeds a phone event; reports are serialized per call. */
  handle(event: WebPhoneCallEvent): void {
    if (event.type === 'started') {
      if (event.direction === 'out' && this.preparedOutbound) {
        this.preparedOutbound = false
        return
      }
      this.current = this.begin({
        direction: event.direction,
        number: event.number,
        name: event.name,
        pabxUniqueId: event.pabxUniqueId ?? undefined,
      })
      return
    }

    const tracked = this.current
    if (!tracked) return
    const body =
      event.type === 'answered'
        ? { event: 'answered' }
        : { event: 'ended', outcome: event.outcome }
    const sent = tracked.then(async (tracking) => {
      if (!tracking) return null
      await apiFetch(
        this.url(`/${encodeURIComponent(tracking.call.id)}/webphone`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        'Não foi possível atualizar a ligação',
      ).catch(() => undefined)
      return tracking
    })
    // The next report waits for this one; an ended call frees the slot.
    if (event.type === 'ended') this.onNotice(null)
    this.current = event.type === 'ended' ? null : sent
  }
}
