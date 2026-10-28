import type { WorkspaceSendingDomain } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  sendingDomainInUse,
  sendingDomainInvalid,
  sendingDomainTaken,
} from '@/src/errors'
import { emailDomain } from '@/src/lib/newsletter/urls'
import { err, ok, type Result } from '@/src/lib/result'
import { lookupDmarc } from '@/src/lib/sending-domain/dmarc'
import { isPublicSuffix } from '@/src/lib/sending-domain/public-suffix'
import {
  type ProviderDomain,
  ResendDomains,
} from '@/src/lib/sending-domain/resend-domains'
import { toSendingDomainDTO } from '@/src/mappers/sending-domain.mapper'
import {
  type ActiveNewsletterSender,
  SendingDomainRepository,
} from '@/src/repositories/sending-domain.repository'
import type {
  CreateSendingDomainDTO,
  SendingDomainDTO,
  SendingDomainRecord,
  SendingDomainStatusValue,
} from '@/src/schemas/sending-domain.schema'
import { assertModulePrivileged } from './authz'
import { emitNotification, workspaceAdminIds } from './notification-emitter'

/**
 * Sending domains of the CRM newsletter (ADR 0054): a workspace registers
 * its own domain in Resend, publishes the DNS records and, once VERIFIED,
 * sends newsletters from it. OWNER/ADMIN of a workspace with the CRM module.
 * The worker (`sending-domains` queue) re-checks them in the background.
 */

/** Settings page, relative to the workspace (the emitter adds the slug). */
export const EMAIL_DOMAINS_SETTINGS_PATH = '/settings/email-domains'

const HOUR = 60 * 60 * 1000
/** Young domains are re-checked every tick during their first 72 h. */
export const SENDING_DOMAIN_YOUNG_HOURS = 72
/** A tick runs every 10 min; a domain checked less than 9 min ago waits. */
export const SENDING_DOMAIN_FREQUENT_GAP_MS = 9 * 60 * 1000
/** Daily re-checks (verified, failed, older than 72 h). */
export const SENDING_DOMAIN_DAILY_GAP_MS = 24 * HOUR - 10 * 60 * 1000
/** Domains per tick: Resend allows a few requests per second per team. */
export const SENDING_DOMAIN_TICK_LIMIT = 50
/** Pause between domains in a tick (2 calls each) to stay under the limit. */
export const SENDING_DOMAIN_TICK_PAUSE_MS = 600

export interface SendingDomainTickResult {
  checked: number
  failed: number
  changed: number
}

type CheckMode = 'manual' | 'tick'

/**
 * A VERIFIED domain only leaves VERIFIED on a failure: right after a
 * re-check request Resend reports `pending` while it looks again, and that
 * must not stop the newsletters.
 */
export function nextSendingDomainStatus(
  previous: SendingDomainStatusValue,
  provider: SendingDomainStatusValue,
): SendingDomainStatusValue {
  if (
    previous === 'VERIFIED' &&
    (provider === 'PENDING' || provider === 'NOT_STARTED')
  ) {
    return 'VERIFIED'
  }
  return provider
}

/** pt-BR reason shown under the domain, or `null` when nothing is wrong. */
export function sendingDomainFailureReason(
  status: SendingDomainStatusValue,
  records: readonly SendingDomainRecord[],
): string | null {
  if (status === 'TEMPORARY_FAILURE') {
    return 'O DNS do domínio não respondeu na última verificação. O Steel tenta de novo sozinho.'
  }
  if (status !== 'FAILED') return null
  const failing = records.filter((item) => item.status === 'failed')
  if (failing.length === 0) {
    return 'O provedor não encontrou os registros DNS. Confira se foram publicados exatamente como aparecem aqui.'
  }
  const names = failing.map(
    (item) => `${item.record} (${item.type} ${item.name})`,
  )
  return `Registros não encontrados no DNS: ${names.join(', ')}.`
}

/** ACTIVE newsletters sending from the domain (linked or by From address). */
export function countNewslettersUsing(
  domain: Pick<WorkspaceSendingDomain, 'id' | 'name'>,
  senders: readonly ActiveNewsletterSender[],
): number {
  return senders.filter(
    (sender) =>
      sender.sendingDomainId === domain.id ||
      emailDomain(sender.fromEmail) === domain.name,
  ).length
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function newslettersCount(
  domain: WorkspaceSendingDomain,
): Promise<Result<number>> {
  const senders = await SendingDomainRepository.listActiveNewsletterSenders(
    domain.workspaceId,
  )
  if (!senders.ok) return senders
  return ok(countNewslettersUsing(domain, senders.value))
}

async function toDetail(
  domain: WorkspaceSendingDomain,
): Promise<Result<SendingDomainDTO>> {
  const [count, dmarc] = await Promise.all([
    newslettersCount(domain),
    lookupDmarc(domain.name),
  ])
  if (!count.ok) return count
  return ok(toSendingDomainDTO(domain, count.value, dmarc))
}

async function notifyTransition(
  previous: WorkspaceSendingDomain,
  updated: WorkspaceSendingDomain,
  actorId: string | null,
  at: Date,
): Promise<void> {
  const day = at.toISOString().slice(0, 10)
  const path = `${EMAIL_DOMAINS_SETTINGS_PATH}?domain=${encodeURIComponent(updated.id)}`

  if (previous.status !== 'VERIFIED' && updated.status === 'VERIFIED') {
    await emitNotification({
      workspaceId: updated.workspaceId,
      recipients: await workspaceAdminIds(updated.workspaceId),
      actorId,
      kind: 'CRM_SENDING_DOMAIN_VERIFIED',
      title: `Domínio verificado: ${updated.name}`,
      body: 'Os registros DNS foram confirmados. As newsletters já podem sair de endereços deste domínio.',
      path,
      dedupeKey: `sending-domain-verified:${updated.id}:${day}`,
    })
    return
  }

  if (
    previous.status === 'VERIFIED' &&
    (updated.status === 'FAILED' || updated.status === 'TEMPORARY_FAILURE')
  ) {
    await emitNotification({
      workspaceId: updated.workspaceId,
      recipients: await workspaceAdminIds(updated.workspaceId),
      actorId,
      kind: 'CRM_SENDING_DOMAIN_FAILED',
      title: `Domínio deixou de estar verificado: ${updated.name}`,
      body: 'Os registros DNS não foram encontrados na verificação diária. As newsletters deste domínio ficam paradas até o DNS ser corrigido.',
      path,
      dedupeKey: `sending-domain-failed:${updated.id}:${day}`,
    })
  }
}

/**
 * Re-checks one domain at the provider and stores the result. `manual`
 * always asks Resend to verify again; the tick does it only for domains not
 * yet verified (a verified one is just read, so a re-check in flight never
 * flips it).
 */
async function checkDomain(
  domain: WorkspaceSendingDomain,
  mode: CheckMode,
  actorId: string | null,
  now: Date,
): Promise<Result<WorkspaceSendingDomain>> {
  if (!domain.resendDomainId) return ok(domain)

  if (mode === 'manual' || domain.status !== 'VERIFIED') {
    const verify = await ResendDomains.verify(domain.resendDomainId)
    if (!verify.ok) return verify
  }
  const fetched = await ResendDomains.get(domain.resendDomainId)
  if (!fetched.ok) return fetched

  const status = nextSendingDomainStatus(domain.status, fetched.value.status)
  const verifiedAt = status === 'VERIFIED' ? (domain.verifiedAt ?? now) : null
  const updated = await SendingDomainRepository.updateCheck(domain.id, {
    status,
    records: fetched.value.records,
    lastCheckedAt: now,
    verifiedAt,
    failureReason: sendingDomainFailureReason(status, fetched.value.records),
  })
  if (!updated.ok) return updated

  if (updated.value.status !== domain.status) {
    logger.info('sending_domain.status_changed', {
      component: 'SendingDomain',
      workspaceId: domain.workspaceId,
      domainId: domain.id,
      from: domain.status,
      to: updated.value.status,
      providerStatus: fetched.value.providerStatus,
      mode,
    })
    await notifyTransition(domain, updated.value, actorId, now)
  }
  return updated
}

function initialRow(provider: ProviderDomain, now: Date) {
  return {
    resendDomainId: provider.id,
    status: provider.status,
    records: provider.records,
    verifiedAt: provider.status === 'VERIFIED' ? now : null,
    lastCheckedAt: now,
  }
}

export const SendingDomainService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SendingDomainDTO[]>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access

    const [domains, senders] = await Promise.all([
      SendingDomainRepository.listByWorkspace(workspaceId),
      SendingDomainRepository.listActiveNewsletterSenders(workspaceId),
    ])
    if (!domains.ok) return domains
    if (!senders.ok) return senders

    return ok(
      domains.value.map((domain) =>
        toSendingDomainDTO(
          domain,
          countNewslettersUsing(domain, senders.value),
        ),
      ),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    domainId: string,
  ): Promise<Result<SendingDomainDTO>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access

    const domain = await SendingDomainRepository.findById(domainId, workspaceId)
    if (!domain.ok) return domain
    return toDetail(domain.value)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSendingDomainDTO,
    now: Date = new Date(),
  ): Promise<Result<SendingDomainDTO>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access

    if (isPublicSuffix(dto.name)) {
      return err(
        sendingDomainInvalid(
          'Informe o domínio da empresa, não só a terminação (como news.suaempresa.com.br)',
        ),
      )
    }

    const existing = await SendingDomainRepository.findByName(dto.name)
    if (!existing.ok) return existing
    if (existing.value) {
      auditMutation({
        entity: 'sending_domain',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: 'SENDING_DOMAIN_TAKEN',
        meta: { workspaceId, domain: dto.name },
      })
      return err(sendingDomainTaken())
    }

    const provider = await ResendDomains.create(dto.name, dto.region)
    if (!provider.ok) {
      auditMutation({
        entity: 'sending_domain',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: provider.error.code,
        meta: { workspaceId, domain: dto.name },
      })
      return provider
    }

    const created = await SendingDomainRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      region: dto.region,
      ...initialRow(provider.value, now),
    })
    if (!created.ok) {
      // Never leave a domain registered at the provider without its row.
      await ResendDomains.remove(provider.value.id)
      auditMutation({
        entity: 'sending_domain',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
        meta: { workspaceId, domain: dto.name },
      })
      return created
    }

    auditMutation({
      entity: 'sending_domain',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, domain: dto.name, region: dto.region },
    })
    logger.info('sending_domain.created', {
      component: 'SendingDomain',
      workspaceId,
      domainId: created.value.id,
      status: created.value.status,
    })
    return toDetail(created.value)
  },

  /** "Verificar agora": `domains.verify` then `domains.get`. */
  async verify(
    actorId: string,
    workspaceId: string,
    domainId: string,
    now: Date = new Date(),
  ): Promise<Result<SendingDomainDTO>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access

    const domain = await SendingDomainRepository.findById(domainId, workspaceId)
    if (!domain.ok) return domain

    const checked = await checkDomain(domain.value, 'manual', actorId, now)
    if (!checked.ok) return checked
    return toDetail(checked.value)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    domainId: string,
  ): Promise<Result<void>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access

    const domain = await SendingDomainRepository.findById(domainId, workspaceId)
    if (!domain.ok) return domain

    const count = await newslettersCount(domain.value)
    if (!count.ok) return count
    if (count.value > 0) return err(sendingDomainInUse())

    if (domain.value.resendDomainId) {
      const removed = await ResendDomains.remove(domain.value.resendDomainId)
      if (!removed.ok) return removed
    }

    const deleted = await SendingDomainRepository.delete(domain.value.id)
    if (!deleted.ok) return deleted

    auditMutation({
      entity: 'sending_domain',
      action: 'delete',
      actorId,
      targetId: domain.value.id,
      meta: { workspaceId, domain: domain.value.name },
    })
    return ok(undefined)
  },

  /**
   * Worker tick (every 10 min): re-checks the domains that are due. Never
   * fails as a whole — one domain's provider error is logged and skipped
   * (it stays due and is picked again on the next tick).
   */
  async runCheckTick(
    now: Date = new Date(),
    options: { pauseMs?: number } = {},
  ): Promise<SendingDomainTickResult> {
    const pauseMs = options.pauseMs ?? SENDING_DOMAIN_TICK_PAUSE_MS
    const result: SendingDomainTickResult = {
      checked: 0,
      failed: 0,
      changed: 0,
    }

    const due = await SendingDomainRepository.listDueForCheck({
      youngSince: new Date(now.getTime() - SENDING_DOMAIN_YOUNG_HOURS * HOUR),
      frequentBefore: new Date(now.getTime() - SENDING_DOMAIN_FREQUENT_GAP_MS),
      dailyBefore: new Date(now.getTime() - SENDING_DOMAIN_DAILY_GAP_MS),
      limit: SENDING_DOMAIN_TICK_LIMIT,
    })
    if (!due.ok) {
      logger.warn('sending_domain.tick_list_failed', {
        component: 'SendingDomain',
        reason: due.error.code,
      })
      return result
    }

    for (const [index, domain] of due.value.entries()) {
      if (index > 0 && pauseMs > 0) await pause(pauseMs)
      const checked = await checkDomain(domain, 'tick', null, now)
      if (!checked.ok) {
        result.failed += 1
        logger.warn('sending_domain.tick_check_failed', {
          component: 'SendingDomain',
          workspaceId: domain.workspaceId,
          domainId: domain.id,
          reason: checked.error.code,
        })
        continue
      }
      result.checked += 1
      if (checked.value.status !== domain.status) result.changed += 1
    }
    return result
  },
}
