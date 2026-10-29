import type {
  CrmCampaign,
  CrmCampaignChannel,
  CrmCampaignRecipient,
  WhatsAppConnection,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { crmCampaignWhatsappUnavailable } from '@/src/errors'
import { renderCampaignEmail } from '@/src/lib/crm-campaign/email-renderer'
import {
  isWithinSendWindow,
  nextSendWindowOpen,
  type SendWindow,
} from '@/src/lib/crm-campaign/send-window'
import {
  campaignClickUrl,
  campaignOpenPixelUrl,
  createCampaignLinkToken,
  createCampaignUnsubscribeToken,
} from '@/src/lib/crm-campaign/tokens'
import {
  type CampaignMessageContext,
  META_DAILY_CONVERSATION_LIMIT,
  renderButtonUrl,
  renderZapiText,
  resolveTemplateValues,
  templateFields,
} from '@/src/lib/crm-campaign/whatsapp-rules'
import {
  buildCrmUnsubscribeHeaders,
  buildCrmUnsubscribeUrls,
} from '@/src/lib/crm-email-unsubscribe'
import { sendEmail } from '@/src/lib/mail/send'
import { CrmCampaignsJob } from '@/src/lib/queue/jobs'
import { getCrmCampaignsQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import { checkCampaignSender } from '@/src/lib/sending-domain/campaign-sender'
import { resolveBroadcastMediaKind } from '@/src/lib/whatsapp/broadcast-media'
import { buildButtonPayload } from '@/src/lib/whatsapp/button-payload'
import { parseStoredButtons } from '@/src/lib/whatsapp/buttons'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import { buildMetaSendComponents } from '@/src/lib/whatsapp/template-variables'
import type {
  WhatsAppCostContext,
  WhatsAppSendResult,
} from '@/src/lib/whatsapp/types'
import {
  CrmCampaignRecipientRepository,
  CrmCampaignRepository,
} from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignAudienceRepository } from '@/src/repositories/crm-campaign-audience.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import type { CrmCampaignWhatsAppVariables } from '@/src/schemas/crm-campaign.schema'
import {
  notifyCrmCampaignSenderBlocked,
  notifyCrmMultichannelCampaignFinished,
} from './crm-notifications'

/**
 * Execution of multichannel campaigns (ADR 0025) — system flows run by the
 * `crm-campaigns` worker. Idempotency comes from the database: `send` only
 * proceeds after claiming the recipient row (PENDING → SENDING), so any job
 * may be re-queued (tick, resume, BullMQ retry) without a double send.
 */

const HOUR_MS = 60 * 60 * 1000
/** Recipients queued per dispatch round. */
export const DISPATCH_BATCH = 200
/** Rows left in SENDING longer than this are given back to PENDING. */
export const STUCK_AFTER_MS = 15 * 60 * 1000

/**
 * Spacing between messages of one campaign, per channel/provider: Resend
 * defaults to ~2 requests/s; Meta Cloud API tolerates ~1 msg/s per number
 * on tier 1; Z-API (an unofficial device session) needs a human-like pace
 * — the same 4 s the broadcasts use.
 */
export const SEND_INTERVAL_MS = {
  EMAIL: 600,
  META: 1000,
  ZAPI: 4000,
} as const

export type CampaignDispatchOutcome =
  | { status: 'missing' | 'inactive' | 'drained' }
  | { status: 'not_due' | 'outside_window'; retryAt: Date }
  | { status: 'queued'; count: number }

export type CampaignSendOutcome =
  | {
      status: 'skipped'
      reason:
        | 'missing'
        | 'inactive'
        | 'outside_window'
        | 'not_pending'
        | 'opted_out'
        | 'tier_limit'
    }
  | { status: 'retry'; reason: string }
  | { status: 'failed'; reason: string }
  | { status: 'sent'; providerMessageId: string }

function sendWindowOf(campaign: CrmCampaign): SendWindow {
  return {
    startHour: campaign.sendWindowStartHour,
    endHour: campaign.sendWindowEndHour,
    weekdaysOnly: campaign.sendWeekdaysOnly,
  }
}

/** When a channel of a launched campaign may start sending. */
export function channelStartAt(
  campaign: CrmCampaign,
  channel: CrmCampaignChannel,
): Date {
  const start = campaign.startAt ?? campaign.launchedAt ?? new Date(0)
  return channel === 'EMAIL'
    ? start
    : new Date(start.getTime() + campaign.whatsappDelayHours * HOUR_MS)
}

function channelsOf(campaign: CrmCampaign): CrmCampaignChannel[] {
  return campaign.whatsappEnabled ? ['EMAIL', 'WHATSAPP'] : ['EMAIL']
}

async function enqueueDispatchAt(
  campaignId: string,
  channel: CrmCampaignChannel,
  at: Date,
  now: Date,
): Promise<void> {
  await getCrmCampaignsQueue().add(
    CrmCampaignsJob.Dispatch,
    { campaignId, channel },
    {
      delay: Math.max(0, at.getTime() - now.getTime()),
      // Same channel + moment = same job (BullMQ drops the duplicate).
      jobId: `crm-campaign-dispatch-${campaignId}-${channel}-${at.getTime()}`,
    },
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function insertAfterBodyOpen(html: string, snippet: string): string {
  const match = /<body[^>]*>/i.exec(html)
  if (!match) return `${snippet}${html}`
  const at = match.index + match[0].length
  return `${html.slice(0, at)}${snippet}${html.slice(at)}`
}

function insertBeforeBodyClose(html: string, snippet: string): string {
  const at = html.search(/<\/body>/i)
  if (at === -1) return `${html}${snippet}`
  return `${html.slice(0, at)}${snippet}${html.slice(at)}`
}

/**
 * The full campaign e-mail of one contact: rendered template + preheader +
 * open pixel + LGPD unsubscribe footer. Pixel/footer are omitted on tests.
 */
export async function buildCampaignEmail(
  campaign: CrmCampaign,
  contact: {
    name: string
    email: string
    link: string
    openPixelUrl: string | null
    unsubscribePageUrl: string | null
    /** CRM person of the recipient (profile variables, "Mostrar se"). */
    personId?: string | null
  },
): Promise<Result<{ subject: string; html: string; text: string }>> {
  // The builder renders the template, `{{campaign_link}}` and the LGPD
  // unsubscribe footer (generic link on tests, the recipient's on sends).
  const rendered = await renderCampaignEmail(
    campaign.emailTemplateId as string,
    {
      workspaceId: campaign.workspaceId,
      name: contact.name,
      email: contact.email,
      campaignLink: contact.link,
      unsubscribeUrl: contact.unsubscribePageUrl ?? undefined,
      personId: contact.personId,
    },
  )
  if (!rendered.ok) return rendered

  let html = rendered.value.html
  if (campaign.emailPreheader) {
    html = insertAfterBodyOpen(
      html,
      `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(campaign.emailPreheader)}</div>`,
    )
  }
  if (contact.openPixelUrl) {
    html = insertBeforeBodyClose(
      html,
      `<img src="${escapeHtml(contact.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`,
    )
  }
  return ok({
    subject: campaign.emailSubject || rendered.value.subject,
    html,
    text: rendered.value.text,
  })
}

const CRM_CAMPAIGN_COST: WhatsAppCostContext = { source: 'CRM_CAMPAIGN' }

/**
 * Z-API text + the quick reply's buttons: reply buttons carry the quick
 * reply payload (their configured actions run on click), URL buttons get
 * `{link}` replaced by the recipient's campaign link. An image rides in the
 * button message; other media go first, on their own.
 */
async function sendQuickReplyButtons(
  connection: WhatsAppConnection,
  input: {
    to: CampaignMessageContext & { waId: string }
    text: string
    quickReplyId: string
    buttons: ReturnType<typeof parseStoredButtons>
    mediaUrl: string | null
  },
): Promise<Result<WhatsAppSendResult>> {
  const kind = input.mediaUrl
    ? (resolveBroadcastMediaKind({ url: input.mediaUrl }) ?? 'IMAGE')
    : null
  if (input.mediaUrl && kind && kind !== 'IMAGE' && kind !== 'AUDIO') {
    const media = await WhatsAppSend.media(
      connection,
      {
        to: input.to.waId,
        mediaUrl: input.mediaUrl,
        type: kind.toLowerCase() as 'video' | 'document',
      },
      { cost: CRM_CAMPAIGN_COST },
    )
    if (!media.ok) return media
  }
  return WhatsAppSend.buttons(
    connection,
    {
      to: input.to.waId,
      text: input.text,
      buttons: input.buttons.map((button) =>
        button.type === 'URL'
          ? {
              type: 'URL' as const,
              id: button.id,
              label: button.label,
              url: renderButtonUrl(button.url, input.to),
            }
          : {
              type: 'REPLY' as const,
              id: buildButtonPayload({
                sourceType: 'QUICK_REPLY',
                sourceId: input.quickReplyId,
                buttonId: button.id,
              }),
              label: button.label,
            },
      ),
      ...(input.mediaUrl && kind === 'IMAGE'
        ? { media: { url: input.mediaUrl, type: 'image' as const } }
        : {}),
    },
    { cost: CRM_CAMPAIGN_COST },
  )
}

/** Sends the campaign's WhatsApp message to one number, per provider. */
export async function sendCampaignWhatsApp(
  campaign: CrmCampaign,
  to: CampaignMessageContext & { waId: string },
): Promise<Result<WhatsAppSendResult>> {
  if (!campaign.whatsappConnectionId) {
    return err(crmCampaignWhatsappUnavailable('Conexão de WhatsApp ausente'))
  }
  const connection = await CrmCampaignLookupRepository.findConnection(
    campaign.workspaceId,
    campaign.whatsappConnectionId,
  )
  if (!connection.ok) return connection
  if (connection.value?.status !== 'CONNECTED') {
    return err(
      crmCampaignWhatsappUnavailable('A conexão de WhatsApp não está ativa'),
    )
  }

  if (connection.value.provider === 'META') {
    const template = campaign.whatsappTemplateId
      ? await CrmCampaignLookupRepository.findWhatsAppTemplate(
          campaign.workspaceId,
          connection.value.id,
          campaign.whatsappTemplateId,
        )
      : ok(null)
    if (!template.ok) return template
    if (template.value?.status !== 'APPROVED') {
      return err(
        crmCampaignWhatsappUnavailable(
          'Template da Meta ausente ou não aprovado',
        ),
      )
    }
    const fields = templateFields(template.value.components)
    const values = resolveTemplateValues(
      fields,
      (campaign.whatsappVariables as CrmCampaignWhatsAppVariables | null) ??
        null,
      to,
    )
    return WhatsAppSend.template(
      connection.value,
      {
        to: to.waId,
        templateName: template.value.name,
        language: template.value.language,
        components: applyTemplateSendExtras(
          template.value,
          buildMetaSendComponents(fields, values),
        ).components,
      },
      {
        cost: {
          source: 'CRM_CAMPAIGN',
          templateCategory: template.value.category,
        },
      },
    )
  }

  const text = renderZapiText(campaign.whatsappText ?? '', to)
  let mediaUrl = campaign.whatsappMediaUrl
  if (campaign.whatsappQuickReplyId) {
    const reply = await CrmCampaignLookupRepository.findQuickReply(
      campaign.workspaceId,
      campaign.whatsappQuickReplyId,
    )
    if (!reply.ok) return reply
    if (!reply.value) {
      return err(
        crmCampaignWhatsappUnavailable('A resposta rápida não existe mais'),
      )
    }
    mediaUrl = mediaUrl ?? reply.value.mediaUrl
    const buttons = parseStoredButtons(reply.value.buttons)
    if (buttons.length > 0) {
      return sendQuickReplyButtons(connection.value, {
        to,
        text,
        quickReplyId: reply.value.id,
        buttons,
        mediaUrl,
      })
    }
  }
  if (mediaUrl) {
    const kind = resolveBroadcastMediaKind({ url: mediaUrl }) ?? 'IMAGE'
    const type = kind.toLowerCase() as 'image' | 'video' | 'audio' | 'document'
    if (type !== 'audio') {
      return WhatsAppSend.media(
        connection.value,
        {
          to: to.waId,
          mediaUrl,
          type,
          caption: text,
        },
        { cost: CRM_CAMPAIGN_COST },
      )
    }
  }
  return WhatsAppSend.text(
    connection.value,
    { to: to.waId, text },
    { cost: CRM_CAMPAIGN_COST },
  )
}

async function sendEmailTo(
  campaign: CrmCampaign,
  recipient: CrmCampaignRecipient,
): Promise<Result<string, { retry: boolean; message: string }>> {
  // ADR 0055: a campaign scheduled before the rule (or whose domain lost its
  // verification) fails here with the reason, instead of sending.
  const sender = await checkCampaignSender(
    campaign.workspaceId,
    campaign.emailFrom as string,
  )
  if (!sender.ok) {
    return err({
      retry: sender.error.code !== 'SENDING_DOMAIN_NOT_VERIFIED',
      message: sender.error.message,
    })
  }
  const token = createCampaignLinkToken(recipient.id, 'EMAIL')
  const unsubscribe = buildCrmUnsubscribeUrls(
    BETTER_AUTH_URL,
    createCampaignUnsubscribeToken(recipient.id),
  )
  const email = await buildCampaignEmail(campaign, {
    name: recipient.name,
    email: recipient.email as string,
    link: campaignClickUrl(BETTER_AUTH_URL, token),
    openPixelUrl: campaignOpenPixelUrl(BETTER_AUTH_URL, token),
    unsubscribePageUrl: unsubscribe.pageUrl,
    personId: recipient.personId,
  })
  if (!email.ok) return err({ retry: false, message: email.error.message })
  try {
    const sent = await sendEmail({
      from: campaign.emailFrom as string,
      to: recipient.email as string,
      subject: email.value.subject,
      html: email.value.html,
      text: email.value.text,
      headers: buildCrmUnsubscribeHeaders(unsubscribe),
    })
    return ok(sent.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar'
    return err({ retry: /rate limited/i.test(message), message })
  }
}

async function sendWhatsAppTo(
  campaign: CrmCampaign,
  recipient: CrmCampaignRecipient,
): Promise<Result<string, { retry: boolean; message: string }>> {
  const token = createCampaignLinkToken(recipient.id, 'WHATSAPP')
  const sent = await sendCampaignWhatsApp(campaign, {
    waId: recipient.waId as string,
    name: recipient.name,
    link: campaignClickUrl(BETTER_AUTH_URL, token),
    linkCode: token,
  })
  if (!sent.ok) {
    return err({
      retry: sent.error.code === 'RATE_LIMITED',
      message: sent.error.message,
    })
  }
  return ok(sent.value.providerMessageId)
}

/**
 * Tells the owner, once, that the e-mails of a running campaign will fail
 * because its From is not on a verified domain (ADR 0055). Each send still
 * fails on its own with the reason; a lookup failure is left to the sends.
 */
async function warnBlockedSender(campaign: CrmCampaign): Promise<void> {
  if (!campaign.emailFrom) return
  const sender = await checkCampaignSender(
    campaign.workspaceId,
    campaign.emailFrom,
  )
  if (sender.ok || sender.error.code !== 'SENDING_DOMAIN_NOT_VERIFIED') return
  logger.warn('crm.campaign.sender_blocked', {
    component: 'CrmCampaignSendService',
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
  })
  await notifyCrmCampaignSenderBlocked({
    workspaceId: campaign.workspaceId,
    campaign: {
      id: campaign.id,
      title: campaign.name,
      createdById: campaign.createdById,
    },
    type: 'MULTICHANNEL',
    fromEmail: campaign.emailFrom,
  })
}

export const CrmCampaignSendService = {
  /** Queues the first dispatch of every channel of a launched campaign. */
  async enqueueDispatch(campaign: CrmCampaign, now: Date): Promise<void> {
    for (const channel of channelsOf(campaign)) {
      const at = channelStartAt(campaign, channel)
      await enqueueDispatchAt(campaign.id, channel, at > now ? at : now, now)
    }
  },

  async dispatch(
    campaignId: string,
    channel: CrmCampaignChannel,
    now: Date,
  ): Promise<Result<CampaignDispatchOutcome>> {
    const found = await CrmCampaignRepository.findByIdUnscoped(campaignId)
    if (!found.ok) return found
    let campaign = found.value
    if (!campaign) return ok({ status: 'missing' })

    if (
      campaign.status === 'SCHEDULED' &&
      campaign.startAt &&
      campaign.startAt <= now
    ) {
      const started = await CrmCampaignRepository.transition(
        campaignId,
        ['SCHEDULED'],
        { status: 'SENDING' },
      )
      if (!started.ok) return started
      campaign = started.value ?? campaign
    }
    if (campaign.status !== 'SENDING') return ok({ status: 'inactive' })

    const startAt = channelStartAt(campaign, channel)
    if (now < startAt) {
      await enqueueDispatchAt(campaignId, channel, startAt, now)
      return ok({ status: 'not_due', retryAt: startAt })
    }

    const window = sendWindowOf(campaign)
    if (!isWithinSendWindow(now, window)) {
      const retryAt = nextSendWindowOpen(now, window)
      await enqueueDispatchAt(campaignId, channel, retryAt, now)
      return ok({ status: 'outside_window', retryAt })
    }

    const pending = await CrmCampaignRecipientRepository.listPendingIds(
      campaignId,
      channel,
      DISPATCH_BATCH,
    )
    if (!pending.ok) return pending
    if (pending.value.length === 0) {
      await CrmCampaignSendService.completeIfDrained(campaignId, now)
      return ok({ status: 'drained' })
    }

    if (channel === 'EMAIL') await warnBlockedSender(campaign)

    let interval: number = SEND_INTERVAL_MS.EMAIL
    if (channel === 'WHATSAPP' && campaign.whatsappConnectionId) {
      const connection = await CrmCampaignLookupRepository.findConnection(
        campaign.workspaceId,
        campaign.whatsappConnectionId,
      )
      if (!connection.ok) return connection
      interval =
        connection.value?.provider === 'META'
          ? SEND_INTERVAL_MS.META
          : SEND_INTERVAL_MS.ZAPI
    }

    await getCrmCampaignsQueue().addBulk(
      pending.value.map((recipientId, index) => ({
        name: CrmCampaignsJob.Send,
        data: { campaignId, recipientId, channel },
        opts: {
          delay: index * interval,
          jobId: `crm-campaign-send-${recipientId}-${channel}-${now.getTime()}`,
        },
      })),
    )
    if (pending.value.length === DISPATCH_BATCH) {
      await enqueueDispatchAt(
        campaignId,
        channel,
        new Date(now.getTime() + DISPATCH_BATCH * interval),
        now,
      )
    }
    return ok({ status: 'queued', count: pending.value.length })
  },

  async send(
    campaignId: string,
    recipientId: string,
    channel: CrmCampaignChannel,
    now: Date,
  ): Promise<Result<CampaignSendOutcome>> {
    const found =
      await CrmCampaignRecipientRepository.findWithCampaign(recipientId)
    if (!found.ok) return found
    if (!found.value || found.value.campaignId !== campaignId) {
      return ok({ status: 'skipped', reason: 'missing' })
    }
    const { campaign, ...recipient } = found.value
    // Paused/canceled: leave the row as it is (resume re-dispatches it).
    if (campaign.status !== 'SENDING' || campaign.deletedAt) {
      return ok({ status: 'skipped', reason: 'inactive' })
    }
    if (!isWithinSendWindow(now, sendWindowOf(campaign))) {
      return ok({ status: 'skipped', reason: 'outside_window' })
    }

    // Meta tier: cap business-initiated messages per number per 24 h.
    if (channel === 'WHATSAPP' && campaign.whatsappConnectionId) {
      const connection = await CrmCampaignLookupRepository.findConnection(
        campaign.workspaceId,
        campaign.whatsappConnectionId,
      )
      if (!connection.ok) return connection
      if (connection.value?.provider === 'META') {
        const sentToday =
          await CrmCampaignRecipientRepository.countWhatsAppSentSince(
            connection.value.id,
            new Date(now.getTime() - 24 * HOUR_MS),
          )
        if (!sentToday.ok) return sentToday
        if (sentToday.value >= META_DAILY_CONVERSATION_LIMIT) {
          return ok({ status: 'skipped', reason: 'tier_limit' })
        }
      }
    }

    const claimed = await CrmCampaignRecipientRepository.claim(
      recipientId,
      channel,
    )
    if (!claimed.ok) return claimed
    if (!claimed.value) return ok({ status: 'skipped', reason: 'not_pending' })

    // LGPD: the contact may have opted out after the launch snapshot.
    const optedOut =
      channel === 'EMAIL'
        ? await CrmCampaignAudienceRepository.isEmailOptedOut(
            campaign.workspaceId,
            recipient.email as string,
            recipient.personId,
          )
        : await CrmCampaignAudienceRepository.isWhatsAppOptedOut(
            campaign.workspaceId,
            recipient.waId as string,
          )
    if (!optedOut.ok) {
      await CrmCampaignRecipientRepository.release(recipientId, channel)
      return optedOut
    }
    if (optedOut.value) {
      const skipped = await CrmCampaignRecipientRepository.markSkipped(
        recipientId,
        channel,
        'opted_out',
      )
      if (!skipped.ok) return skipped
      await CrmCampaignSendService.completeIfDrained(campaignId, now)
      return ok({ status: 'skipped', reason: 'opted_out' })
    }

    const sent =
      channel === 'EMAIL'
        ? await sendEmailTo(campaign, recipient)
        : await sendWhatsAppTo(campaign, recipient)

    if (!sent.ok) {
      if (sent.error.retry) {
        await CrmCampaignRecipientRepository.release(recipientId, channel)
        return ok({ status: 'retry', reason: sent.error.message })
      }
      const failed = await CrmCampaignRecipientRepository.markFailed(
        recipientId,
        channel,
        sent.error.message,
      )
      if (!failed.ok) return failed
      await CrmCampaignSendService.completeIfDrained(campaignId, now)
      return ok({ status: 'failed', reason: sent.error.message })
    }

    const recorded = await CrmCampaignRecipientRepository.markSent(
      recipientId,
      channel,
      sent.value,
      now,
    )
    // Already sent: never report an error (a retry would send it again).
    if (!recorded.ok) {
      logger.error('crm.campaign.send_record_failed', {
        component: 'CrmCampaignSendService',
        campaignId,
        recipientId,
        reason: recorded.error.code,
      })
    }
    await CrmCampaignSendService.completeIfDrained(campaignId, now)
    return ok({ status: 'sent', providerMessageId: sent.value })
  },

  /**
   * Closes a SENDING campaign without open rows: COMPLETED, or FAILED when
   * nothing went out and something failed. The conditional transition lets
   * only one concurrent caller close it (and notify the owner).
   */
  async completeIfDrained(campaignId: string, now: Date): Promise<void> {
    const email = await CrmCampaignRecipientRepository.countOpen(
      campaignId,
      'EMAIL',
    )
    const whatsapp = await CrmCampaignRecipientRepository.countOpen(
      campaignId,
      'WHATSAPP',
    )
    if (!email.ok || !whatsapp.ok || email.value + whatsapp.value > 0) return

    const funnel = await CrmCampaignRepository.funnel([campaignId])
    if (!funnel.ok) return
    const counts = funnel.value.get(campaignId)
    if (!counts) return
    const sent = counts.email.SENT + counts.whatsapp.SENT
    const failed = counts.email.FAILED + counts.whatsapp.FAILED
    const status = sent === 0 && failed > 0 ? 'FAILED' : 'COMPLETED'

    const closed = await CrmCampaignRepository.transition(
      campaignId,
      ['SENDING'],
      { status, completedAt: now },
    )
    if (!closed.ok || !closed.value) return

    auditMutation({
      entity: 'crm_campaign',
      action: 'update',
      actorId: null,
      targetId: campaignId,
      meta: { status, sent, failed, actor: 'system' },
    })
    await notifyCrmMultichannelCampaignFinished({
      workspaceId: closed.value.workspaceId,
      campaign: closed.value,
      status,
      emailSent: counts.email.SENT,
      whatsappSent: counts.whatsapp.SENT,
      failed,
    })
  },

  /** Safety net (every 5 min): start, re-dispatch, unstick and close. */
  async tick(
    now: Date,
  ): Promise<Result<{ campaigns: number; released: number }>> {
    const released = await CrmCampaignRecipientRepository.releaseStuck(
      new Date(now.getTime() - STUCK_AFTER_MS),
    )
    if (!released.ok) return released

    const runnable = await CrmCampaignRepository.listRunnable(now)
    if (!runnable.ok) return runnable

    for (const campaign of runnable.value) {
      for (const channel of channelsOf(campaign)) {
        const result = await CrmCampaignSendService.dispatch(
          campaign.id,
          channel,
          now,
        )
        if (!result.ok) {
          logger.error('crm.campaign.tick_dispatch_failed', {
            component: 'CrmCampaignSendService',
            campaignId: campaign.id,
            channel,
            reason: result.error.code,
          })
        }
      }
    }
    return ok({ campaigns: runnable.value.length, released: released.value })
  },
}
