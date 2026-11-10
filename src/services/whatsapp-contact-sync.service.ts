import { auditMutation } from '@/lib/axiom/audit'
import {
  whatsappContactSyncUnavailable,
  whatsappProviderError,
} from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { listZapiPhonebook } from '@/src/lib/whatsapp/zapi-client'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import type { WhatsAppContactSyncResultDTO } from '@/types/whatsapp-contact-sync'
import { assertModuleMember } from './authz'

const PHONE = /^\d{10,15}$/

export const WhatsAppContactSyncService = {
  /**
   * Copies the paired phone's address book into the workspace contacts.
   * Z-API only: Meta's Cloud API cannot list a phone's contacts, so a
   * workspace without a Z-API connection is refused with a clear message.
   */
  async syncPhonebook(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppContactSyncResultDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const connections =
      await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
    if (!connections.ok) return connections

    const zapi = connections.value.find(
      (connection) =>
        connection.provider === 'ZAPI' &&
        connection.zapiInstanceId &&
        connection.encryptedZapiToken,
    )
    if (!zapi) {
      const hasMeta = connections.value.some(
        (connection) => connection.provider === 'META',
      )
      return err(
        whatsappContactSyncUnavailable(
          hasMeta
            ? 'Sincronizar a agenda não é permitido na conexão da Meta (API oficial): ela não permite ler os contatos do telefone. Conecte uma instância Z-API para usar este recurso.'
            : undefined,
        ),
      )
    }

    let entries: Awaited<ReturnType<typeof listZapiPhonebook>>
    try {
      entries = await listZapiPhonebook({
        instanceId: zapi.zapiInstanceId as string,
        token: await decryptConnectionSecret(zapi.encryptedZapiToken as string),
        clientToken: zapi.encryptedZapiClientToken
          ? await decryptConnectionSecret(zapi.encryptedZapiClientToken)
          : undefined,
      })
    } catch (error) {
      return err(
        whatsappProviderError(
          error instanceof Error ? error.message : 'Falha ao ler a agenda',
        ),
      )
    }

    // De-duplicate by number; groups and broadcast ids never match PHONE.
    const byPhone = new Map<string, string | undefined>()
    for (const entry of entries) {
      const phone = entry.phone?.replace(/\D/g, '')
      if (!phone || !PHONE.test(phone)) continue
      const name = entry.name || entry.vname || entry.short || entry.notify
      if (!byPhone.has(phone) || (name && !byPhone.get(phone))) {
        byPhone.set(phone, name || undefined)
      }
    }

    const existing = await WhatsAppContactRepository.findManyByWaIds(
      workspaceId,
      [...byPhone.keys()],
    )
    if (!existing.ok) return existing
    const known = new Set(existing.value.map((contact) => contact.waId))

    let created = 0
    let updated = 0
    let skipped = entries.length - byPhone.size
    for (const [waId, name] of byPhone) {
      const isKnown = known.has(waId)
      const saved = await WhatsAppContactRepository.upsertByWaId({
        workspaceId,
        waId,
        // Never overwrite a name the team may have edited.
        name: isKnown ? undefined : name,
      })
      if (!saved.ok) {
        skipped++
        continue
      }
      if (isKnown) updated++
      else created++
      void indexSearchDocument('zap-contact', workspaceId, saved.value.id)
    }

    auditMutation({
      entity: 'whatsapp_contact',
      action: 'create',
      actorId,
      meta: { source: 'phonebook_sync', created, updated, skipped },
    })

    return ok({ created, updated, skipped })
  },
}
