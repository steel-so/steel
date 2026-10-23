import type { WhatsAppContact, WhatsAppOptOutSource } from '@prisma/client'
import { conflict } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type WhatsAppContactWithCount = WhatsAppContact & {
  _count: { conversations: number }
}

export const WhatsAppContactRepository = {
  async listByWorkspace(
    workspaceId: string,
    search?: string,
    whatsapp?: 'yes' | 'no' | 'unknown',
  ): Promise<Result<WhatsAppContactWithCount[]>> {
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: {
          workspaceId,
          ...(whatsapp
            ? { hasWhatsapp: { yes: true, no: false, unknown: null }[whatsapp] }
            : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { waId: { contains: search } },
                ],
              }
            : {}),
        },
        include: { _count: { select: { conversations: true } } },
        orderBy: { name: 'asc' },
      })
      return ok(contacts)
    } catch (error) {
      return err(dbError('Failed to list whatsapp contacts', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppContact | null>> {
    try {
      const contact = await prisma.whatsAppContact.findFirst({
        where: { id, workspaceId },
      })
      return ok(contact)
    } catch (error) {
      return err(dbError('Failed to find whatsapp contact', error))
    }
  },

  async findByWaId(
    workspaceId: string,
    waId: string,
  ): Promise<Result<WhatsAppContact | null>> {
    try {
      const contact = await prisma.whatsAppContact.findUnique({
        where: { workspaceId_waId: { workspaceId, waId } },
      })
      return ok(contact)
    } catch (error) {
      return err(dbError('Failed to find whatsapp contact by wa_id', error))
    }
  },

  async findManyByWaIds(
    workspaceId: string,
    waIds: string[],
  ): Promise<Result<WhatsAppContact[]>> {
    if (waIds.length === 0) return ok([])
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: { workspaceId, waId: { in: waIds } },
      })
      return ok(contacts)
    } catch (error) {
      return err(dbError('Failed to find whatsapp contacts by wa_ids', error))
    }
  },

  async create(data: {
    workspaceId: string
    waId: string
    name?: string
    avatarUrl?: string
    description?: string
  }): Promise<Result<WhatsAppContact>> {
    try {
      const contact = await prisma.whatsAppContact.create({ data })
      return ok(contact)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(conflict('Este contato já existe'))
      }
      return err(dbError('Failed to create whatsapp contact', error))
    }
  },

  /**
   * Upsert by identity. Meta may send only a BSUID (username users): `waId` is
   * then the identity key too. Lookup is by BSUID first, then by phone, so a
   * contact keeps one row when its phone shows up later (the phone replaces
   * the BSUID as `waId`, unless another contact already owns that phone).
   */
  async upsertByWaId(data: {
    workspaceId: string
    waId: string
    bsuid?: string
    username?: string
    name?: string
    avatarUrl?: string
  }): Promise<Result<WhatsAppContact>> {
    try {
      const { workspaceId, waId, bsuid, username } = data
      const known = bsuid
        ? await prisma.whatsAppContact.findUnique({
            where: { workspaceId_bsuid: { workspaceId, bsuid } },
          })
        : null
      const byPhone = await prisma.whatsAppContact.findUnique({
        where: { workspaceId_waId: { workspaceId, waId } },
      })
      const current = known ?? byPhone
      const fields = {
        ...(data.name ? { name: data.name } : {}),
        ...(data.avatarUrl ? { avatarUrl: data.avatarUrl } : {}),
        ...(username ? { username } : {}),
      }
      if (!current) {
        const created = await prisma.whatsAppContact.create({
          data: { workspaceId, waId, bsuid, ...fields },
        })
        return ok(created)
      }
      const adoptPhone = known !== null && known.waId !== waId && !byPhone
      const updated = await prisma.whatsAppContact.update({
        where: { id: current.id },
        data: {
          ...fields,
          ...(bsuid && !current.bsuid ? { bsuid } : {}),
          ...(adoptPhone ? { waId } : {}),
        },
      })
      return ok(updated)
    } catch (error) {
      return err(dbError('Failed to upsert whatsapp contact', error))
    }
  },

  /**
   * Meta changed a contact's BSUID (new phone number). Finds the contact by
   * the previous BSUID (or the phone it reports) and moves it to the new one;
   * the phone becomes `waId` when no other contact owns it. No-op for a
   * contact we never talked to.
   */
  async applyIdentityChange(data: {
    workspaceId: string
    bsuid: string
    previousBsuid?: string
    waId?: string
  }): Promise<Result<WhatsAppContact | null>> {
    try {
      const { workspaceId, bsuid, previousBsuid, waId } = data
      const contact =
        (previousBsuid
          ? await prisma.whatsAppContact.findUnique({
              where: {
                workspaceId_bsuid: { workspaceId, bsuid: previousBsuid },
              },
            })
          : null) ??
        (waId
          ? await prisma.whatsAppContact.findUnique({
              where: { workspaceId_waId: { workspaceId, waId } },
            })
          : null)
      if (!contact) return ok(null)
      const phoneTaken =
        waId && waId !== contact.waId
          ? await prisma.whatsAppContact.findUnique({
              where: { workspaceId_waId: { workspaceId, waId } },
            })
          : null
      const updated = await prisma.whatsAppContact.update({
        where: { id: contact.id },
        data: {
          bsuid,
          ...(waId && !phoneTaken ? { waId } : {}),
        },
      })
      return ok(updated)
    } catch (error) {
      return err(dbError('Failed to apply whatsapp identity change', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string | null
      avatarUrl?: string | null
      description?: string | null
    },
  ): Promise<Result<WhatsAppContact>> {
    try {
      const contact = await prisma.whatsAppContact.update({
        where: { id },
        data,
      })
      return ok(contact)
    } catch (error) {
      return err(dbError('Failed to update whatsapp contact', error))
    }
  },

  /** Registra (`{ at, source }`) ou remove (`null`) o opt-out LGPD de
   * transmissões. */
  async setBroadcastOptOut(
    id: string,
    optOut: { at: Date; source: WhatsAppOptOutSource } | null,
  ): Promise<Result<WhatsAppContact>> {
    try {
      const contact = await prisma.whatsAppContact.update({
        where: { id },
        data: {
          broadcastOptedOutAt: optOut?.at ?? null,
          broadcastOptOutSource: optOut?.source ?? null,
        },
      })
      return ok(contact)
    } catch (error) {
      return err(dbError('Failed to update whatsapp contact opt-out', error))
    }
  },

  /** Dos ids informados, só os que pertencem ao workspace e não se
   * descadastraram de transmissões — filtro no banco, não na UI. */
  async listBroadcastEligibleIds(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<string[]>> {
    if (ids.length === 0) return ok([])
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: { workspaceId, id: { in: ids }, broadcastOptedOutAt: null },
        select: { id: true },
      })
      const eligible = new Set(contacts.map((c) => c.id))
      return ok(ids.filter((id) => eligible.has(id)))
    } catch (error) {
      return err(
        dbError('Failed to list broadcast-eligible whatsapp contacts', error),
      )
    }
  },

  /** Contatos do workspace por id, só com o que a checagem "tem zap?" usa. */
  async listForWhatsappCheck(
    workspaceId: string,
    ids: string[],
  ): Promise<
    Result<
      {
        id: string
        waId: string
        hasWhatsapp: boolean | null
        whatsappCheckedAt: Date | null
      }[]
    >
  > {
    if (ids.length === 0) return ok([])
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: { workspaceId, id: { in: ids } },
        select: {
          id: true,
          waId: true,
          hasWhatsapp: true,
          whatsappCheckedAt: true,
        },
      })
      return ok(contacts)
    } catch (error) {
      return err(dbError('Failed to list contacts for whatsapp check', error))
    }
  },

  /** Ids de todos os contatos do workspace (limitado) — "validar tudo". */
  async listIds(workspaceId: string, take: number): Promise<Result<string[]>> {
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      })
      return ok(contacts.map((contact) => contact.id))
    } catch (error) {
      return err(dbError('Failed to list whatsapp contact ids', error))
    }
  },

  /**
   * Grava o resultado de uma checagem "tem zap?" (escopado ao workspace).
   * Quem tem WhatsApp guarda também o LID; quem não tem, limpa o LID.
   */
  async applyWhatsappChecks(
    workspaceId: string,
    checks: { id: string; hasWhatsapp: boolean; lid: string | null }[],
    checkedAt: Date,
  ): Promise<Result<number>> {
    if (checks.length === 0) return ok(0)
    try {
      const without = checks.filter((check) => !check.hasWhatsapp)
      const operations = [
        prisma.whatsAppContact.updateMany({
          where: { workspaceId, id: { in: without.map((c) => c.id) } },
          data: {
            hasWhatsapp: false,
            whatsappCheckedAt: checkedAt,
            whatsappLid: null,
          },
        }),
        ...checks
          .filter((check) => check.hasWhatsapp)
          .map((check) =>
            prisma.whatsAppContact.updateMany({
              where: { workspaceId, id: check.id },
              data: {
                hasWhatsapp: true,
                whatsappCheckedAt: checkedAt,
                whatsappLid: check.lid,
              },
            }),
          ),
      ]
      await prisma.$transaction(operations)
      return ok(checks.length)
    } catch (error) {
      return err(dbError('Failed to save whatsapp check results', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppContact.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp contact', error))
    }
  },
}
