import { randomBytes } from 'node:crypto'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import {
  sdStatusPageNotFound,
  sdStatusPageSlugTaken,
  sdStatusSubscriberNotFound,
  sdStatusSubscriptionsClosed,
} from '@/src/errors'
import { sendSdStatusConfirmEmail } from '@/src/lib/mail/servicedesk/send-sd-status-update'
import { err, ok, type Result } from '@/src/lib/result'
import {
  SD_STATUS_PAGE_HISTORY_DAYS,
  sdNormalizeStatusEmail,
  sdStatusPageAutoSlug,
  sdStatusSubscriptionPath,
} from '@/src/lib/servicedesk/major-incident'
import { SD_STATUS_MAINTENANCE_LOOKAHEAD_DAYS } from '@/src/lib/servicedesk/status-maintenance'
import {
  maskStatusAddress,
  toSdPublicStatusPageDTO,
  toSdStatusPageDTO,
  toSdStatusSubscriberDTO,
} from '@/src/mappers/sd-status-page.mapper'
import { SdStatusComponentRepository } from '@/src/repositories/sd-status-component.repository'
import { SdStatusMaintenanceRepository } from '@/src/repositories/sd-status-maintenance.repository'
import {
  SdStatusPageRepository,
  type SdStatusPageRow,
  type SdStatusSubscriberRow,
} from '@/src/repositories/sd-status-page.repository'
import type {
  AddSdStatusSubscriberInput,
  CreateSdStatusPageInput,
  SubscribeSdStatusPageInput,
  UpdateSdStatusPageInput,
} from '@/src/schemas/sd-status-page.schema'
import type {
  SdPublicStatusPageDTO,
  SdStatusPageDTO,
  SdStatusPageListDTO,
  SdStatusSubscriberDTO,
  SdStatusSubscriberListDTO,
  SdStatusSubscriptionDTO,
} from '@/types/sd-status-page'
import { SdAccess } from './sd-access'

/**
 * Páginas de status por cliente ou serviço. A configuração é do admin do
 * ServiceDesk; quem atende (agente) vê as páginas e gerencia os assinantes.
 * A página pública não exige sessão: o endereço (`slug`) é o acesso e só
 * expõe o que o agente escreveu para o cliente (título, resumo e mensagens
 * publicadas) — nunca dados do chamado.
 *
 * Inscrição pelo próprio cliente: só e-mail, com confirmação (double
 * opt-in). WhatsApp só é adicionado por agente (o número é do cadastro do
 * cliente e o consentimento é da empresa).
 */

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

async function dtosFor(
  workspaceId: string,
  rows: SdStatusPageRow[],
): Promise<Result<SdStatusPageDTO[]>> {
  const counts = await SdStatusPageRepository.counts(rows.map((r) => r.id))
  if (!counts.ok) return counts
  const dtos: SdStatusPageDTO[] = []
  for (const row of rows) {
    const names = await SdStatusPageRepository.findNames(workspaceId, {
      serviceIds: row.serviceIds,
      customerId: row.customerId,
    })
    if (!names.ok) return names
    dtos.push(
      toSdStatusPageDTO(row, {
        ...names.value,
        subscribers: counts.value.subscribers.get(row.id) ?? 0,
        active: counts.value.active.get(row.id) ?? 0,
      }),
    )
  }
  return ok(dtos)
}

export const SdStatusPageService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdStatusPageListDTO>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    if (!access.ok) return access
    const rows = await SdStatusPageRepository.list(workspaceId)
    if (!rows.ok) return rows
    const items = await dtosFor(workspaceId, rows.value)
    if (!items.ok) return items
    return ok({ items: items.value })
  },

  async get(
    actorId: string,
    workspaceId: string,
    pageId: string,
  ): Promise<Result<SdStatusPageDTO>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    if (!access.ok) return access
    const row = await SdStatusPageRepository.findById(pageId, workspaceId)
    if (!row.ok) return row
    const items = await dtosFor(workspaceId, [row.value])
    if (!items.ok) return items
    return ok(items.value[0])
  },

  async create(
    actorId: string,
    workspaceId: string,
    input: CreateSdStatusPageInput,
  ): Promise<Result<SdStatusPageDTO>> {
    const access = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!access.ok) return access

    const data = {
      workspaceId,
      name: input.name,
      description: input.description ?? null,
      customerId: input.customerId ?? null,
      serviceIds: Array.from(new Set(input.serviceIds)),
      published: input.published,
      allowSubscriptions: input.allowSubscriptions,
      createdById: actorId,
    }
    let created = await SdStatusPageRepository.create({
      ...data,
      slug:
        input.slug ??
        sdStatusPageAutoSlug(input.name, randomBytes(3).toString('hex')),
    })
    // An auto-generated slug that collides is retried once; a typed one is
    // the admin's choice and comes back as an error.
    if (
      !input.slug &&
      !created.ok &&
      created.error.code === sdStatusPageSlugTaken().code
    ) {
      created = await SdStatusPageRepository.create({
        ...data,
        slug: sdStatusPageAutoSlug(input.name, randomBytes(4).toString('hex')),
      })
    }
    if (!created.ok) return created

    auditMutation({
      entity: 'sd_status_page',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, slug: created.value.slug },
    })
    const items = await dtosFor(workspaceId, [created.value])
    if (!items.ok) return items
    return ok(items.value[0])
  },

  async update(
    actorId: string,
    workspaceId: string,
    pageId: string,
    input: UpdateSdStatusPageInput,
  ): Promise<Result<SdStatusPageDTO>> {
    const access = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!access.ok) return access
    const updated = await SdStatusPageRepository.update(pageId, workspaceId, {
      ...input,
      ...(input.serviceIds
        ? { serviceIds: Array.from(new Set(input.serviceIds)) }
        : {}),
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'sd_status_page',
      action: 'update',
      actorId,
      targetId: pageId,
      meta: { workspaceId, fields: Object.keys(input) },
    })
    const items = await dtosFor(workspaceId, [updated.value])
    if (!items.ok) return items
    return ok(items.value[0])
  },

  async remove(
    actorId: string,
    workspaceId: string,
    pageId: string,
  ): Promise<Result<true>> {
    const access = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!access.ok) return access
    const removed = await SdStatusPageRepository.remove(pageId, workspaceId)
    if (!removed.ok) return removed
    auditMutation({
      entity: 'sd_status_page',
      action: 'delete',
      actorId,
      targetId: pageId,
      meta: { workspaceId },
    })
    return ok(true)
  },

  // ----- Subscribers (agents) -------------------------------------------

  async listSubscribers(
    actorId: string,
    workspaceId: string,
    pageId: string,
  ): Promise<Result<SdStatusSubscriberListDTO>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    if (!access.ok) return access
    const page = await SdStatusPageRepository.findById(pageId, workspaceId)
    if (!page.ok) return page
    const rows = await SdStatusPageRepository.listSubscribers(pageId)
    if (!rows.ok) return rows
    return ok({ items: rows.value.map(toSdStatusSubscriberDTO) })
  },

  async addSubscriber(
    actorId: string,
    workspaceId: string,
    pageId: string,
    input: AddSdStatusSubscriberInput,
  ): Promise<Result<SdStatusSubscriberDTO>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'EDIT',
    })
    if (!access.ok) return access
    const page = await SdStatusPageRepository.findById(pageId, workspaceId)
    if (!page.ok) return page

    const existing = await SdStatusPageRepository.findSubscriber(
      pageId,
      input.channel,
      input.address,
    )
    if (!existing.ok) return existing
    if (existing.value) {
      // Already there: an agent adding it confirms a pending self-signup.
      if (existing.value.confirmedAt) {
        return ok(toSdStatusSubscriberDTO(existing.value))
      }
      const confirmed = await SdStatusPageRepository.confirmSubscriber(
        existing.value.id,
      )
      if (!confirmed.ok) return confirmed
      return ok(toSdStatusSubscriberDTO(confirmed.value))
    }
    const created = await SdStatusPageRepository.createSubscriber({
      workspaceId,
      pageId,
      channel: input.channel,
      address: input.address,
      name: input.name ?? null,
      token: newToken(),
      confirmed: true,
      addedById: actorId,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'sd_status_subscriber',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, pageId, channel: input.channel },
    })
    return ok(toSdStatusSubscriberDTO(created.value))
  },

  async removeSubscriber(
    actorId: string,
    workspaceId: string,
    pageId: string,
    subscriberId: string,
  ): Promise<Result<true>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'EDIT',
    })
    if (!access.ok) return access
    const page = await SdStatusPageRepository.findById(pageId, workspaceId)
    if (!page.ok) return page
    const removed = await SdStatusPageRepository.removeSubscriber(
      subscriberId,
      pageId,
    )
    if (!removed.ok) return removed
    auditMutation({
      entity: 'sd_status_subscriber',
      action: 'delete',
      actorId,
      targetId: subscriberId,
      meta: { workspaceId, pageId },
    })
    return ok(true)
  },

  // ----- Public (no session) --------------------------------------------

  async getPublic(slug: string): Promise<Result<SdPublicStatusPageDTO>> {
    const page = await SdStatusPageRepository.findBySlug(slug)
    if (!page.ok) return page
    if (!page.value?.published) return err(sdStatusPageNotFound())
    const row = page.value

    const since = new Date(
      Date.now() - SD_STATUS_PAGE_HISTORY_DAYS * 86_400_000,
    )
    const now = new Date()
    const [incidents, names, workspace, components, maintenances] =
      await Promise.all([
        SdStatusPageRepository.listIncidents(row.id, since),
        SdStatusPageRepository.findNames(row.workspaceId, {
          serviceIds: row.serviceIds,
          customerId: null,
        }),
        SdStatusPageRepository.findWorkspaceName(row.workspaceId),
        SdStatusComponentRepository.listByPage(row.id, row.workspaceId),
        SdStatusMaintenanceRepository.listForPage(
          row.id,
          now,
          new Date(
            now.getTime() + SD_STATUS_MAINTENANCE_LOOKAHEAD_DAYS * 86_400_000,
          ),
        ),
      ])
    if (!incidents.ok) return incidents
    if (!names.ok) return names
    if (!workspace.ok) return workspace
    if (!components.ok) return components
    if (!maintenances.ok) return maintenances
    return ok(
      toSdPublicStatusPageDTO({
        page: row,
        workspaceName: workspace.value ?? '',
        services: row.serviceIds
          .map((id) => names.value.services.get(id))
          .filter((name): name is string => Boolean(name)),
        incidents: incidents.value,
        components: components.value,
        maintenances: maintenances.value,
        now,
      }),
    )
  },

  /**
   * Self-service e-mail subscription. The answer is the same whether or not
   * the address was already known (no address enumeration); a pending one
   * gets the confirmation again, a confirmed one gets nothing.
   */
  async subscribe(
    slug: string,
    input: SubscribeSdStatusPageInput,
  ): Promise<Result<true>> {
    const page = await SdStatusPageRepository.findBySlug(slug)
    if (!page.ok) return page
    if (!page.value?.published) return err(sdStatusPageNotFound())
    if (!page.value.allowSubscriptions) {
      return err(sdStatusSubscriptionsClosed())
    }
    const row = page.value
    const address = sdNormalizeStatusEmail(input.email)

    const existing = await SdStatusPageRepository.findSubscriber(
      row.id,
      'EMAIL',
      address,
    )
    if (!existing.ok) return existing
    let subscriber = existing.value
    if (subscriber?.confirmedAt) return ok(true)
    if (!subscriber) {
      const created = await SdStatusPageRepository.createSubscriber({
        workspaceId: row.workspaceId,
        pageId: row.id,
        channel: 'EMAIL',
        address,
        name: input.name ?? null,
        token: newToken(),
        confirmed: false,
        addedById: null,
      })
      if (!created.ok) return created
      subscriber = created.value
    }

    const workspace = await SdStatusPageRepository.findWorkspaceName(
      row.workspaceId,
    )
    try {
      await sendSdStatusConfirmEmail({
        email: address,
        pageName: row.name,
        workspaceName: workspace.ok ? (workspace.value ?? '') : '',
        confirmUrl: `${NEXT_PUBLIC_URL}${sdStatusSubscriptionPath(row.slug, subscriber.token)}`,
      })
    } catch (error) {
      logger.warn('servicedesk.status.confirm_mail_failed', {
        pageId: row.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return ok(true)
  },

  async subscription(
    slug: string,
    token: string,
  ): Promise<Result<SdStatusSubscriptionDTO>> {
    const found = await findSubscription(slug, token)
    if (!found.ok) return found
    return ok(
      toSubscriptionDTO(found.value.page, found.value.subscriber, false),
    )
  },

  async actOnSubscription(
    slug: string,
    token: string,
    action: 'CONFIRM' | 'UNSUBSCRIBE',
  ): Promise<Result<SdStatusSubscriptionDTO>> {
    const found = await findSubscription(slug, token)
    if (!found.ok) return found
    const { page, subscriber } = found.value

    if (action === 'UNSUBSCRIBE') {
      const removed = await SdStatusPageRepository.removeSubscriber(
        subscriber.id,
        page.id,
      )
      if (!removed.ok) return removed
      return ok(toSubscriptionDTO(page, subscriber, true))
    }
    const confirmed = subscriber.confirmedAt
      ? ok(subscriber)
      : await SdStatusPageRepository.confirmSubscriber(subscriber.id)
    if (!confirmed.ok) return confirmed
    return ok(toSubscriptionDTO(page, confirmed.value, false))
  },
}

type SubscriberRow = SdStatusSubscriberRow

async function findSubscription(
  slug: string,
  token: string,
): Promise<Result<{ page: SdStatusPageRow; subscriber: SubscriberRow }>> {
  const subscriber = await SdStatusPageRepository.findSubscriberByToken(token)
  if (!subscriber.ok) return subscriber
  if (!subscriber.value) return err(sdStatusSubscriberNotFound())
  const page = await SdStatusPageRepository.findById(
    subscriber.value.pageId,
    subscriber.value.workspaceId,
  )
  if (!page.ok) return page
  if (page.value.slug !== slug) return err(sdStatusSubscriberNotFound())
  return ok({ page: page.value, subscriber: subscriber.value })
}

function toSubscriptionDTO(
  page: SdStatusPageRow,
  subscriber: SubscriberRow,
  unsubscribed: boolean,
): SdStatusSubscriptionDTO {
  return {
    pageName: page.name,
    pageSlug: page.slug,
    channel: subscriber.channel,
    addressMasked: maskStatusAddress(subscriber.channel, subscriber.address),
    confirmed: subscriber.confirmedAt !== null,
    unsubscribed,
  }
}
