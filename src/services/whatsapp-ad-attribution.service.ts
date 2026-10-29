import type {
  WhatsAppAdReferral,
  WhatsAppAdSettings,
  WhatsAppAdSpend,
  WhatsAppContact,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden, whatsappAdSpendNotFound } from '@/src/errors'
import { csvDocument } from '@/src/lib/csv-writer'
import { err, ok, type Result } from '@/src/lib/result'
import {
  adLeadSource,
  type InboundAdReferral,
  leadPhoneFromWaId,
} from '@/src/lib/whatsapp/ad-referral'
import { buildAdReport } from '@/src/lib/whatsapp/ad-report'
import { rangeBounds } from '@/src/lib/whatsapp/cost'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppAdRepository } from '@/src/repositories/whatsapp-ad.repository'
import type {
  CreateWhatsAppAdSpendDTO,
  UpdateWhatsAppAdSettingsDTO,
  WhatsAppAdReportQueryDTO,
} from '@/src/schemas/whatsapp-ad.schema'
import type {
  WhatsAppAdReferralDTO,
  WhatsAppAdReportDTO,
  WhatsAppAdSettingsDTO,
  WhatsAppAdSpendDTO,
} from '@/types/whatsapp-ad'
import { assertModulePrivileged } from './authz'
import { CrmLeadService } from './crm-lead.service'
import { notifyCrmLeadAssigned } from './crm-notifications'
import { WhatsAppConversationService } from './whatsapp-conversation.service'
import { whatsAppAdminIds } from './whatsapp-notify'

export const DEFAULT_AD_LEAD_SOURCE = 'Anúncio Click-to-WhatsApp'

const DEFAULT_SETTINGS: WhatsAppAdSettingsDTO = {
  enabled: false,
  createLeads: false,
  leadOwnerId: null,
  leadSource: DEFAULT_AD_LEAD_SOURCE,
}

function toSettingsDTO(row: WhatsAppAdSettings | null): WhatsAppAdSettingsDTO {
  if (!row) return { ...DEFAULT_SETTINGS }
  return {
    enabled: row.enabled,
    createLeads: row.createLeads,
    leadOwnerId: row.leadOwnerId,
    leadSource: row.leadSource,
  }
}

function toReferralDTO(row: WhatsAppAdReferral): WhatsAppAdReferralDTO {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    headline: row.headline,
    body: row.body,
    mediaType: row.mediaType,
    mediaUrl: row.mediaUrl,
    leadId: row.leadId,
    receivedAt: row.receivedAt.toISOString(),
  }
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toSpendDTO(row: WhatsAppAdSpend): WhatsAppAdSpendDTO {
  return {
    id: row.id,
    sourceId: row.sourceId,
    label: row.label,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    amount: Number(row.amount),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Click-to-WhatsApp ad attribution (roadmap Z4). The webhook hands over the
 * `referral` block of the first message; this service stores it, opens the
 * CRM lead (opt-in) and measures the funnel and the return per ad. Reports,
 * spend and settings are for OWNER/ADMIN: they hold money.
 */
export const WhatsAppAdAttributionService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAdSettingsDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const row = await WhatsAppAdRepository.findSettings(workspaceId)
    if (!row.ok) return row
    return ok(toSettingsDTO(row.value))
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppAdSettingsDTO,
  ): Promise<Result<WhatsAppAdSettingsDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    if (dto.leadOwnerId) {
      const owner = await MembershipRepository.findByUserAndWorkspace(
        dto.leadOwnerId,
        workspaceId,
      )
      if (!owner.ok) return owner
      if (!owner.value) return err(forbidden())
    }

    const current = await WhatsAppAdRepository.findSettings(workspaceId)
    if (!current.ok) return current
    const base = toSettingsDTO(current.value)
    const next = {
      enabled: dto.enabled ?? base.enabled,
      createLeads: dto.createLeads ?? base.createLeads,
      leadOwnerId:
        dto.leadOwnerId === undefined ? base.leadOwnerId : dto.leadOwnerId,
      leadSource: dto.leadSource ?? base.leadSource,
    }

    const saved = await WhatsAppAdRepository.upsertSettings(workspaceId, {
      ...next,
      updatedById: actorId,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_ad_settings',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: { workspaceId, ...next },
    })
    return ok(toSettingsDTO(saved.value))
  },

  /**
   * Webhook entry: stores the referral of an inbound message and, when
   * enabled, opens the lead. The caller treats a failure as log-only — the
   * message itself is already saved and must not be retried by Meta.
   */
  async onInboundReferral(input: {
    workspaceId: string
    contact: Pick<WhatsAppContact, 'id' | 'name' | 'waId'>
    conversationId: string
    providerMessageId: string
    referral: InboundAdReferral
  }): Promise<Result<void>> {
    const { workspaceId, contact, referral } = input

    const settings = await WhatsAppAdRepository.findSettings(workspaceId)
    if (!settings.ok) return settings
    if (!settings.value?.enabled) return ok(undefined)

    const created = await WhatsAppAdRepository.createReferral({
      workspaceId,
      contactId: contact.id,
      conversationId: input.conversationId,
      providerMessageId: input.providerMessageId,
      sourceType: referral.sourceType,
      sourceId: referral.sourceId,
      sourceUrl: referral.sourceUrl,
      headline: referral.headline,
      body: referral.body,
      mediaType: referral.mediaType,
      mediaUrl: referral.mediaUrl,
      ctwaClid: referral.ctwaClid,
    })
    if (!created.ok) return created
    // A webhook retry: already stored, nothing else to do.
    if (!created.value) return ok(undefined)

    logger.info(
      'whatsapp.ad.referral_stored',
      logFields(
        { component: 'WhatsAppAdAttributionService', workspaceId },
        {
          conversationId: input.conversationId,
          sourceId: referral.sourceId,
        },
      ),
    )

    if (!settings.value.createLeads) return ok(undefined)
    await openLead({
      settings: settings.value,
      referralRow: created.value,
      referral,
      contact,
    })
    return ok(undefined)
  },

  /** The ad that opened a conversation (null for an ordinary one). */
  async getConversationReferral(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppAdReferralDTO | null>> {
    // Same visibility rules as the conversation itself (404 when hidden).
    const conversation = await WhatsAppConversationService.get(
      actorId,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const row = await WhatsAppAdRepository.findLatestByConversation(
      workspaceId,
      conversationId,
    )
    if (!row.ok) return row
    return ok(row.value ? toReferralDTO(row.value) : null)
  },

  async report(
    actorId: string,
    workspaceId: string,
    query: WhatsAppAdReportQueryDTO,
  ): Promise<Result<WhatsAppAdReportDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const { start, endExclusive } = rangeBounds(query.from, query.to)
    const referrals = await WhatsAppAdRepository.listReferralsInRange(
      workspaceId,
      start,
      endExclusive,
    )
    if (!referrals.ok) return referrals

    const leadIds = [
      ...new Set(
        referrals.value.flatMap((row) => (row.leadId ? [row.leadId] : [])),
      ),
    ]
    const leads = await WhatsAppAdRepository.listLeadOutcomes(
      workspaceId,
      leadIds,
    )
    if (!leads.ok) return leads

    const spends = await WhatsAppAdRepository.listSpendsOverlapping(
      workspaceId,
      new Date(`${query.from}T00:00:00Z`),
      new Date(`${query.to}T00:00:00Z`),
    )
    if (!spends.ok) return spends

    return ok(
      buildAdReport({
        from: query.from,
        to: query.to,
        referrals: referrals.value,
        leads: leads.value,
        spends: spends.value.map((row) => ({
          sourceId: row.sourceId,
          label: row.label,
          periodStart: day(row.periodStart),
          periodEnd: day(row.periodEnd),
          amount: Number(row.amount),
        })),
      }),
    )
  },

  /** CSV of the report (comma separated, UTF-8 with BOM). */
  async exportCsv(
    actorId: string,
    workspaceId: string,
    query: WhatsAppAdReportQueryDTO,
  ): Promise<Result<string>> {
    const report = await WhatsAppAdAttributionService.report(
      actorId,
      workspaceId,
      query,
    )
    if (!report.ok) return report

    const rows = report.value.rows.map((row) => [
      row.sourceId,
      row.name,
      row.sourceType,
      row.clicks,
      row.conversations,
      row.leads,
      row.leadsWon,
      row.spend,
      row.revenue,
      row.costPerConversation,
      row.costPerLead,
      row.roi,
    ])
    return ok(
      csvDocument(
        [
          'Id do anúncio',
          'Anúncio',
          'Tipo',
          'Cliques',
          'Conversas',
          'Leads',
          'Leads ganhos',
          'Gasto',
          'Receita',
          'Custo por conversa',
          'Custo por lead',
          'ROI',
        ],
        rows,
      ),
    )
  },

  async listSpends(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAdSpendDTO[]>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const rows = await WhatsAppAdRepository.listSpends(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSpendDTO))
  },

  async createSpend(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppAdSpendDTO,
  ): Promise<Result<WhatsAppAdSpendDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const saved = await WhatsAppAdRepository.createSpend({
      workspaceId,
      sourceId: dto.sourceId,
      label: dto.label || null,
      periodStart: new Date(`${dto.periodStart}T00:00:00Z`),
      periodEnd: new Date(`${dto.periodEnd}T00:00:00Z`),
      amount: dto.amount,
      note: dto.note || null,
      createdById: actorId,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_ad_spend',
      action: 'create',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        sourceId: dto.sourceId,
        amount: dto.amount,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
      },
    })
    return ok(toSpendDTO(saved.value))
  },

  async deleteSpend(
    actorId: string,
    workspaceId: string,
    spendId: string,
  ): Promise<Result<void>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const removed = await WhatsAppAdRepository.deleteSpend(workspaceId, spendId)
    if (!removed.ok) return removed
    if (!removed.value) return err(whatsappAdSpendNotFound())

    auditMutation({
      entity: 'whatsapp_ad_spend',
      action: 'delete',
      actorId,
      targetId: spendId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },
}

/**
 * Opens (or matches) the CRM lead of a contact that came from an ad and links
 * the referral to it — first touch wins when the lead already has one.
 * Failures are logged only: attribution never breaks the inbound flow.
 */
async function openLead(input: {
  settings: WhatsAppAdSettings
  referralRow: WhatsAppAdReferral
  referral: InboundAdReferral
  contact: Pick<WhatsAppContact, 'id' | 'name' | 'waId'>
}): Promise<void> {
  const { settings, referralRow, referral, contact } = input
  const workspaceId = settings.workspaceId
  const logContext = { component: 'WhatsAppAdAttributionService', workspaceId }

  const phone = leadPhoneFromWaId(contact.waId)
  if (!phone) {
    logger.info(
      'whatsapp.ad.lead_skipped_no_phone',
      logFields(logContext, { referralId: referralRow.id }),
    )
    return
  }

  const createdById =
    settings.leadOwnerId ?? (await whatsAppAdminIds(workspaceId))[0]
  if (!createdById) {
    logger.warn(
      'whatsapp.ad.lead_skipped_no_creator',
      logFields(logContext, { referralId: referralRow.id }),
    )
    return
  }

  const intake = await CrmLeadService.intake(
    workspaceId,
    {
      kind: 'system',
      createdById,
      via: 'whatsapp_ad',
      refId: referralRow.id,
    },
    {
      name: contact.name?.trim() || phone,
      phones: [phone],
      source: adLeadSource(settings.leadSource, referral.headline),
      channel: 'WhatsApp',
    },
  )
  if (!intake.ok) {
    logger.warn(
      'whatsapp.ad.lead_failed',
      logFields(logContext, {
        referralId: referralRow.id,
        reason: intake.error.code,
      }),
    )
    return
  }

  const lead = intake.value.lead
  if (!intake.value.created) {
    const owned = await WhatsAppAdRepository.leadHasReferral(
      workspaceId,
      lead.id,
    )
    if (!owned.ok || owned.value) return
  } else if (!lead.ownerId && settings.leadOwnerId) {
    const assigned = await CrmLeadRepository.update(lead.id, {
      ownerId: settings.leadOwnerId,
    })
    if (assigned.ok) {
      void notifyCrmLeadAssigned({
        workspaceId,
        lead: { id: lead.id, name: lead.name },
        ownerId: settings.leadOwnerId,
        actorId: null,
        routed: true,
      })
    }
  }

  const linked = await WhatsAppAdRepository.linkLead(referralRow.id, lead.id)
  if (!linked.ok) {
    logger.warn(
      'whatsapp.ad.lead_link_failed',
      logFields(logContext, {
        referralId: referralRow.id,
        reason: linked.error.code,
      }),
    )
  }
}
