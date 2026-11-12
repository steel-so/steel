import type {
  WhatsAppConnection,
  WhatsAppContact,
  WhatsAppContactBlock,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  forbidden,
  notFound,
  validationError,
  whatsappConnectionNotFound,
  whatsappContactBlocked,
  whatsappContactNotFound,
} from '@/src/errors'
import { can, type PermissionAction } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import {
  BLOCK_PENDING_META_MESSAGE,
  blockWaIdVariants,
  normalizeBlockWaId,
  type ProviderBlockClient,
  type ProviderBlockOutcome,
  resolveBlockClient,
} from '@/src/lib/whatsapp/contact-block'
import type { WhatsAppConversationScope } from '@/src/lib/whatsapp/conversation-scope'
import { toWhatsAppContactBlockDTO } from '@/src/mappers/whatsapp-contact-block.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import {
  type CreateContactBlockInput,
  WhatsAppContactBlockRepository,
  type WhatsAppContactBlockWithRefs,
} from '@/src/repositories/whatsapp-contact-block.repository'
import type {
  CreateWhatsAppContactBlockDTO,
  SyncWhatsAppContactBlocksDTO,
  WhatsAppContactBlockQueryDTO,
} from '@/src/schemas/whatsapp-contact-block.schema'
import type {
  WhatsAppContactBlockDTO,
  WhatsAppContactBlockResultDTO,
  WhatsAppContactBlockSyncDTO,
  WhatsAppContactBlockSyncRowDTO,
  WhatsAppContactUnblockResultDTO,
  WhatsAppConversationBlockStateDTO,
} from '@/types/whatsapp-contact-block'
import { assertModuleMember } from './authz'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from './whatsapp-conversation-scope.service'

const COMPONENT = 'WhatsAppContactBlockService'

/** pt-BR reason a batch send (broadcast, campaign) records on a skip. */
export const CONTACT_BLOCKED_SKIP = 'Contato bloqueado neste número'

/** Bounds one sync: the rest is retried on the next one. */
const SYNC_RETRY_LIMIT = 200

type LineRef = Pick<
  WhatsAppConnection,
  'id' | 'workspaceId' | 'module' | 'provider'
>

interface BlockAccess {
  scope: WhatsAppConversationScope
  /** OWNER/ADMIN or leader of a team: unblock, sync, block from a list. */
  manager: boolean
  /** May answer conversations (`conversations × CREATE`). */
  canReply: boolean
}

/** Phone lines of the Comunicação module: the only ones with blocks. */
function isBlockableLine(connection: LineRef): boolean {
  return (
    connection.module === 'COMMUNICATION' &&
    (connection.provider === 'META' || connection.provider === 'ZAPI')
  )
}

function providerName(provider: WhatsAppConnection['provider']): string {
  return provider === 'META' ? 'Meta' : 'Z-API'
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Module member with `conversations × action`, their conversation
 * visibility (Equipes) and whether they manage blocks.
 */
async function accessOf(
  actorId: string,
  workspaceId: string,
  action: PermissionAction,
): Promise<Result<BlockAccess>> {
  const membership = await assertModuleMember(
    actorId,
    workspaceId,
    'COMMUNICATION',
    { resource: 'conversations', action },
  )
  if (!membership.ok) return membership
  const scope = await resolveConversationScope(
    actorId,
    workspaceId,
    membership.value.role,
  )
  if (!scope.ok) return scope
  const { isPrivileged, permissions } = membership.value
  return ok({
    scope: scope.value,
    manager: isPrivileged || scope.value.leadsTeamIds.length > 0,
    canReply:
      isPrivileged ||
      (permissions !== null && can(permissions, 'conversations', 'CREATE')),
  })
}

async function managerAccess(
  actorId: string,
  workspaceId: string,
): Promise<Result<BlockAccess>> {
  const access = await accessOf(actorId, workspaceId, 'VIEW')
  if (!access.ok) return access
  if (!access.value.manager) return err(forbidden())
  return access
}

/** The block client of a line, or null (no credentials, decrypt failed). */
async function clientOf(
  connection: WhatsAppConnection,
): Promise<ProviderBlockClient | null> {
  try {
    return await resolveBlockClient(connection)
  } catch (error) {
    logger.warn('whatsapp.contact_block.client_failed', {
      component: COMPONENT,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      reason: reasonOf(error),
    })
    return null
  }
}

const NO_CREDENTIALS =
  'A conexão está sem credenciais válidas, então o bloqueio ficou só no Steel. Reconecte o número e use Sincronizar.'

async function applyAtProvider(
  connection: WhatsAppConnection,
  waId: string,
): Promise<ProviderBlockOutcome> {
  const client = await clientOf(connection)
  if (!client) return { status: 'FAILED', error: NO_CREDENTIALS }
  return client.block(waId)
}

async function toDTOs(
  rows: WhatsAppContactBlockWithRefs[],
): Promise<Result<WhatsAppContactBlockDTO[]>> {
  const names = await WhatsAppContactBlockRepository.findUserNames(
    rows.flatMap((row) => (row.blockedById ? [row.blockedById] : [])),
  )
  if (!names.ok) return names
  return ok(rows.map((row) => toWhatsAppContactBlockDTO(row, names.value)))
}

async function toDTO(
  row: WhatsAppContactBlockWithRefs,
): Promise<Result<WhatsAppContactBlockDTO>> {
  const dtos = await toDTOs([row])
  return dtos.ok ? ok(dtos.value[0]) : dtos
}

function blockNotice(
  provider: WhatsAppConnection['provider'],
  outcome: ProviderBlockOutcome,
): string {
  const name = providerName(provider)
  if (outcome.status === 'APPLIED') {
    return `Contato bloqueado no Steel e na ${name}.`
  }
  if (outcome.status === 'PENDING') {
    return `Contato bloqueado no Steel. ${BLOCK_PENDING_META_MESSAGE}`
  }
  return `Contato bloqueado no Steel, mas a ${name} recusou: ${outcome.error ?? 'erro desconhecido'} Nada chega e nada sai pelo Steel; tente de novo em Sincronizar.`
}

/** Resolves the line and the contact a block request points at. */
async function resolveTarget(
  access: BlockAccess,
  workspaceId: string,
  dto: CreateWhatsAppContactBlockDTO,
): Promise<
  Result<{ connection: WhatsAppConnection; contact: WhatsAppContact }>
> {
  let connectionId: string
  let contact: WhatsAppContact
  if (dto.conversationId) {
    const conversation = await loadVisibleConversation(
      access.scope,
      workspaceId,
      dto.conversationId,
    )
    if (!conversation.ok) return conversation
    connectionId = conversation.value.connectionId
    contact = conversation.value.contact
  } else {
    // Outside a conversation there is no visibility rule to lean on.
    if (!access.manager) return err(forbidden())
    const found = await WhatsAppContactRepository.findById(
      dto.contactId as string,
      workspaceId,
    )
    if (!found.ok) return found
    if (!found.value) return err(whatsappContactNotFound())
    connectionId = dto.connectionId as string
    contact = found.value
  }

  const connection = await WhatsAppConnectionRepository.findById(
    connectionId,
    workspaceId,
  )
  if (!connection.ok) return connection
  if (!connection.value) return err(whatsappConnectionNotFound())
  if (!isBlockableLine(connection.value)) {
    return err(
      validationError(
        'Só dá para bloquear contatos em números do WhatsApp (Meta ou Z-API)',
      ),
    )
  }
  return ok({ connection: connection.value, contact })
}

/** Blocks found at the provider become Steel blocks (APPLIED, imported). */
async function importProviderBlocks(
  connection: WhatsAppConnection,
  providerWaIds: string[],
  known: Set<string>,
  now: Date,
): Promise<Result<number>> {
  const fresh = [...new Set(providerWaIds)].filter(
    (waId) => !blockWaIdVariants(waId).some((key) => known.has(key)),
  )
  if (fresh.length === 0) return ok(0)
  const contacts = await WhatsAppContactRepository.findManyByWaIds(
    connection.workspaceId,
    fresh.flatMap((waId) => blockWaIdVariants(waId)),
  )
  if (!contacts.ok) return contacts
  const contactOf = new Map<string, string>()
  for (const contact of contacts.value) {
    for (const key of blockWaIdVariants(contact.waId)) {
      contactOf.set(key, contact.id)
    }
  }
  const rows: CreateContactBlockInput[] = fresh.map((waId) => ({
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    contactId: contactOf.get(waId) ?? null,
    waId,
    reason: null,
    blockedById: null,
    origin: 'PROVIDER',
    providerStatus: 'APPLIED',
    providerError: null,
    at: now,
  }))
  return WhatsAppContactBlockRepository.createMany(rows)
}

async function syncConnection(
  connection: WhatsAppConnection,
  now: Date,
): Promise<Result<WhatsAppContactBlockSyncRowDTO>> {
  const row: WhatsAppContactBlockSyncRowDTO = {
    connectionId: connection.id,
    label: connection.label,
    provider: connection.provider,
    imported: 0,
    retried: 0,
    applied: 0,
    listSupported: connection.provider === 'META',
    error: null,
  }
  const client = await clientOf(connection)
  if (!client) return ok({ ...row, error: NO_CREDENTIALS })

  // 1) The provider's block list (Meta only; Z-API cannot list it).
  let providerKeys = new Set<string>()
  try {
    const listed = await client.list()
    row.listSupported = listed.supported
    if (listed.supported) {
      const known = await WhatsAppContactBlockRepository.listWaIds(
        connection.id,
      )
      if (!known.ok) return known
      const imported = await importProviderBlocks(
        connection,
        listed.waIds,
        known.value,
        now,
      )
      if (!imported.ok) return imported
      row.imported = imported.value
      providerKeys = new Set(listed.waIds.flatMap(blockWaIdVariants))
    }
  } catch (error) {
    row.error = reasonOf(error)
  }

  // 2) Blocks still waiting or refused: already at the provider → APPLIED;
  //    otherwise sent again.
  const unapplied = await WhatsAppContactBlockRepository.listUnapplied(
    connection.id,
  )
  if (!unapplied.ok) return unapplied
  for (const block of unapplied.value.slice(0, SYNC_RETRY_LIMIT)) {
    const alreadyThere = blockWaIdVariants(block.waId).some((key) =>
      providerKeys.has(key),
    )
    const outcome: ProviderBlockOutcome = alreadyThere
      ? { status: 'APPLIED', error: null }
      : await client.block(block.waId)
    if (!alreadyThere) row.retried += 1
    if (outcome.status === 'APPLIED') row.applied += 1
    const saved = await WhatsAppContactBlockRepository.updateProviderStatus(
      block.id,
      { providerStatus: outcome.status, providerError: outcome.error, at: now },
    )
    if (!saved.ok) return saved
  }
  return ok(row)
}

/**
 * Meta's PENDING block (the person had not written in 24 h): the message
 * just received opens the window, so the block goes to Meta now. Never
 * fails the webhook.
 */
async function applyPendingOnInbound(
  connection: WhatsAppConnection,
  block: WhatsAppContactBlock,
  now: Date,
): Promise<void> {
  const outcome = await applyAtProvider(connection, block.waId)
  const saved = await WhatsAppContactBlockRepository.updateProviderStatus(
    block.id,
    { providerStatus: outcome.status, providerError: outcome.error, at: now },
  )
  logger.info('whatsapp.contact_block.pending_retried', {
    component: COMPONENT,
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    blockId: block.id,
    providerStatus: outcome.status,
    saved: saved.ok,
  })
  if (outcome.status === 'APPLIED') {
    auditMutation({
      entity: 'whatsapp_contact_block',
      action: 'block',
      actorId: null,
      targetId: block.contactId,
      meta: {
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        provider: connection.provider,
        providerStatus: 'APPLIED',
        trigger: 'inbound_window',
      },
    })
  }
}

/**
 * Contacts blocked on a WhatsApp number of the Comunicação module
 * (zap-block-contacts). The internal block always holds — inbound messages
 * of the contact are dropped before anything else and every send to them
 * is refused (`WHATSAPP_CONTACT_BLOCKED`) — whatever the provider says.
 */
export const WhatsAppContactBlockService = {
  /**
   * Shared send layer (`WhatsAppSend`): refuses a recipient blocked on the
   * number. Lines outside the Comunicação phone lines are never checked.
   */
  async assertCanSend(
    connection: LineRef,
    to: string,
  ): Promise<Result<void>> {
    if (!isBlockableLine(connection) || !to) return ok(undefined)
    const found = await WhatsAppContactBlockRepository.findActive(
      connection.id,
      blockWaIdVariants(to),
    )
    if (!found.ok) return found
    if (!found.value) return ok(undefined)
    logger.info('whatsapp.contact_block.send_refused', {
      component: COMPONENT,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      blockId: found.value.id,
    })
    return err(whatsappContactBlocked())
  },

  /** Batch senders (broadcasts, campaigns) skip a blocked recipient. */
  async isBlocked(connection: LineRef, waId: string): Promise<Result<boolean>> {
    if (!isBlockableLine(connection)) return ok(false)
    const found = await WhatsAppContactBlockRepository.findActive(
      connection.id,
      blockWaIdVariants(waId),
    )
    if (!found.ok) return found
    return ok(found.value !== null)
  },

  /**
   * Webhooks, before anything is created: `blocked: true` means drop the
   * message (counted on the block). A failed lookup lets the message
   * through — losing a customer's message is worse. Never throws.
   */
  async screenInbound(
    connection: WhatsAppConnection,
    sender: { waId: string; bsuid?: string },
    now = new Date(),
  ): Promise<{ blocked: boolean }> {
    if (!isBlockableLine(connection)) return { blocked: false }
    try {
      const keys = [
        ...blockWaIdVariants(sender.waId),
        ...(sender.bsuid ? [sender.bsuid] : []),
      ]
      const found = await WhatsAppContactBlockRepository.findActive(
        connection.id,
        keys,
      )
      if (!found.ok) {
        logger.warn('whatsapp.contact_block.screen_failed', {
          component: COMPONENT,
          workspaceId: connection.workspaceId,
          connectionId: connection.id,
          reason: found.error.code,
        })
        return { blocked: false }
      }
      const block = found.value
      if (!block) return { blocked: false }

      await WhatsAppContactBlockRepository.recordDropped(block.id, now)
      logger.info('whatsapp.contact_block.inbound_dropped', {
        component: COMPONENT,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        blockId: block.id,
      })
      if (
        block.providerStatus === 'PENDING' &&
        connection.provider === 'META'
      ) {
        await applyPendingOnInbound(connection, block, now)
      }
      return { blocked: true }
    } catch (error) {
      logger.warn('whatsapp.contact_block.screen_failed', {
        component: COMPONENT,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        reason: reasonOf(error),
      })
      return { blocked: false }
    }
  },

  /** Settings › Contatos bloqueados. OWNER/ADMIN and team leaders. */
  async list(
    actorId: string,
    workspaceId: string,
    query: WhatsAppContactBlockQueryDTO = {},
  ): Promise<Result<WhatsAppContactBlockDTO[]>> {
    const access = await managerAccess(actorId, workspaceId)
    if (!access.ok) return access
    const rows = await WhatsAppContactBlockRepository.listByWorkspace(
      workspaceId,
      query.connectionId,
    )
    if (!rows.ok) return rows
    return toDTOs(rows.value)
  },

  /** Inbox: is the contact of this conversation blocked on its number? */
  async conversationState(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppConversationBlockStateDTO>> {
    const access = await accessOf(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access
    const conversation = await loadVisibleConversation(
      access.value.scope,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation
    const connection = await WhatsAppConnectionRepository.findById(
      conversation.value.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())

    const supported = isBlockableLine(connection.value)
    let block: WhatsAppContactBlockDTO | null = null
    if (supported) {
      const found = await WhatsAppContactBlockRepository.findWithRefs(
        connection.value.id,
        blockWaIdVariants(conversation.value.contact.waId),
      )
      if (!found.ok) return found
      if (found.value) {
        const dto = await toDTO(found.value)
        if (!dto.ok) return dto
        block = dto.value
      }
    }
    return ok({
      conversationId,
      connectionId: connection.value.id,
      provider: connection.value.provider,
      supported,
      block,
      canBlock: supported && access.value.canReply,
      canUnblock: supported && access.value.manager,
    })
  },

  /**
   * Blocks the contact on the number: internal block at once, then the
   * provider (Meta 131047 → PENDING; any other refusal → FAILED). Blocking
   * twice returns the existing block. Audited (no message content).
   */
  async block(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppContactBlockDTO,
    now = new Date(),
  ): Promise<Result<WhatsAppContactBlockResultDTO>> {
    const access = await accessOf(actorId, workspaceId, 'CREATE')
    if (!access.ok) return access
    const target = await resolveTarget(access.value, workspaceId, dto)
    if (!target.ok) return target
    const { connection, contact } = target.value

    const waId = normalizeBlockWaId(contact.waId)
    const existing = await WhatsAppContactBlockRepository.findWithRefs(
      connection.id,
      blockWaIdVariants(waId),
    )
    if (!existing.ok) return existing
    if (existing.value) {
      const current = await toDTO(existing.value)
      if (!current.ok) return current
      return ok({
        block: current.value,
        notice: 'Este contato já estava bloqueado neste número.',
      })
    }

    const outcome = await applyAtProvider(connection, waId)
    const created = await WhatsAppContactBlockRepository.create({
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      waId,
      reason: dto.reason ?? null,
      blockedById: actorId,
      origin: 'STEEL',
      providerStatus: outcome.status,
      providerError: outcome.error,
      at: now,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_contact_block',
      action: 'block',
      actorId,
      targetId: contact.id,
      meta: {
        workspaceId,
        connectionId: connection.id,
        provider: connection.provider,
        providerStatus: outcome.status,
        hasReason: Boolean(dto.reason),
        from: dto.conversationId ? 'conversation' : 'contact',
      },
    })
    logger.info('whatsapp.contact_block.blocked', {
      component: COMPONENT,
      workspaceId,
      connectionId: connection.id,
      blockId: created.value.id,
      providerStatus: outcome.status,
    })

    const block = await toDTO(created.value)
    if (!block.ok) return block
    return ok({
      block: block.value,
      notice: blockNotice(connection.provider, outcome),
    })
  },

  /**
   * Unblocks: at the provider when it holds the block there, then the
   * internal block goes away. A provider refusal never keeps the contact
   * blocked in Steel — it comes back as `providerWarning`. Audited.
   */
  async unblock(
    actorId: string,
    workspaceId: string,
    blockId: string,
  ): Promise<Result<WhatsAppContactUnblockResultDTO>> {
    const access = await managerAccess(actorId, workspaceId)
    if (!access.ok) return access
    const found = await WhatsAppContactBlockRepository.findById(
      blockId,
      workspaceId,
    )
    if (!found.ok) return found
    if (!found.value) return err(notFound('Bloqueio'))
    const block = found.value

    let providerWarning: string | null = null
    if (block.providerStatus === 'APPLIED') {
      const connection = await WhatsAppConnectionRepository.findById(
        block.connectionId,
        workspaceId,
      )
      if (!connection.ok) return connection
      const client = connection.value ? await clientOf(connection.value) : null
      const name = providerName(block.connection.provider)
      if (!client) {
        providerWarning = `Desbloqueado no Steel, mas a conexão está sem credenciais: desbloqueie também pela ${name}.`
      } else {
        const result = await client.unblock(block.waId)
        if (!result.ok) {
          providerWarning = `Desbloqueado no Steel, mas a ${name} recusou: ${result.error ?? 'erro desconhecido'} Confira o bloqueio direto na ${name}.`
        }
      }
    }

    const removed = await WhatsAppContactBlockRepository.delete(
      block.id,
      workspaceId,
    )
    if (!removed.ok) return removed

    auditMutation({
      entity: 'whatsapp_contact_block',
      action: 'unblock',
      actorId,
      targetId: block.contactId,
      meta: {
        workspaceId,
        connectionId: block.connectionId,
        provider: block.connection.provider,
        providerStatus: block.providerStatus,
        providerRefused: providerWarning !== null,
      },
    })
    logger.info('whatsapp.contact_block.unblocked', {
      component: COMPONENT,
      workspaceId,
      connectionId: block.connectionId,
      blockId: block.id,
      providerRefused: providerWarning !== null,
    })
    return ok({ id: block.id, providerWarning })
  },

  /**
   * "Sincronizar": imports the blocks made outside Steel (Meta's list; Z-API
   * has none) and sends PENDING/FAILED blocks to the provider again.
   */
  async sync(
    actorId: string,
    workspaceId: string,
    dto: SyncWhatsAppContactBlocksDTO = {},
    now = new Date(),
  ): Promise<Result<WhatsAppContactBlockSyncDTO>> {
    const access = await managerAccess(actorId, workspaceId)
    if (!access.ok) return access
    const connections =
      await WhatsAppContactBlockRepository.listBlockableConnections(
        workspaceId,
        dto.connectionId,
      )
    if (!connections.ok) return connections
    if (dto.connectionId && connections.value.length === 0) {
      return err(whatsappConnectionNotFound())
    }

    const rows: WhatsAppContactBlockSyncRowDTO[] = []
    for (const connection of connections.value) {
      const synced = await syncConnection(connection, now)
      if (!synced.ok) return synced
      rows.push(synced.value)
    }

    auditMutation({
      entity: 'whatsapp_contact_block',
      action: 'sync',
      actorId,
      targetId: dto.connectionId ?? null,
      meta: {
        workspaceId,
        connections: rows.length,
        imported: rows.reduce((sum, row) => sum + row.imported, 0),
        retried: rows.reduce((sum, row) => sum + row.retried, 0),
        applied: rows.reduce((sum, row) => sum + row.applied, 0),
        failed: rows.filter((row) => row.error !== null).length,
      },
    })
    return ok({ connections: rows })
  },
}
