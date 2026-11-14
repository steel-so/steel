import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import type {
  WebhookEventData,
  WebhookEventType,
} from '@/src/lib/webhooks/events'
import {
  crmCompanySnapshot,
  crmPersonSnapshot,
  documentSnapshot,
  sdContactSnapshot,
  sdCustomerSnapshot,
  sdKbArticleSnapshot,
} from '@/src/lib/webhooks/payloads'
import type { CrmCompanyDTO } from '@/types/crm-company'
import type { CrmPersonDTO } from '@/types/crm-person'
import type { DocumentListItemDTO } from '@/types/document'
import type { SdContactDTO } from '@/types/sd-contact'
import type { SdCustomerDTO } from '@/types/sd-customer'
import type { SdKbArticleSummaryDTO } from '@/types/sd-kb-article'
import { emitWebhookEvent } from './webhook-emitter'

/**
 * The single place that turns a register/knowledge-base/document mutation
 * into an outbound webhook (ADR 0036). A service says *what happened*
 * (`{ entity, action, record }`) right after the write; the event type, the
 * public snapshot and the delivery live here, so adding an entity is one
 * `case` plus its catalog entry — not another hand-written call per service.
 *
 * Fire-and-forget like `emitWebhookEvent`: it never throws and never waits on
 * the network, so a webhook problem cannot fail the save. The type names
 * (`crm.person.created`...) are part of the public contract and stay stable.
 */

type CrudAction = 'created' | 'updated' | 'deleted'

export type EntityWebhook =
  | { entity: 'person'; action: CrudAction; record: CrmPersonDTO }
  | { entity: 'company'; action: CrudAction; record: CrmCompanyDTO }
  | { entity: 'document'; action: CrudAction; record: DocumentListItemDTO }
  | {
      entity: 'document'
      action: 'sent'
      record: DocumentListItemDTO
      recipients: number
    }
  | {
      entity: 'document_answer'
      action: 'accepted' | 'declined'
      document: { id: string; title: string; ownerId: string | null }
      reader: { name: string | null; email: string | null }
      reason: string | null
    }
  | { entity: 'sd_customer'; action: CrudAction; record: SdCustomerDTO }
  | { entity: 'sd_contact'; action: CrudAction; record: SdContactDTO }
  | {
      entity: 'kb_article'
      action: CrudAction | 'published' | 'unpublished'
      record: SdKbArticleSummaryDTO
    }

type Built = {
  [T in WebhookEventType]: { type: T; data: WebhookEventData<T> }
}[WebhookEventType]

/** Pure: the catalog type and the `data` of one entity event. */
export function buildEntityWebhook(
  event: EntityWebhook,
  actorId: string | null,
): Built {
  switch (event.entity) {
    case 'person':
      return {
        type: `crm.person.${event.action}`,
        data: { person: crmPersonSnapshot(event.record), actorId },
      }
    case 'company':
      return {
        type: `crm.company.${event.action}`,
        data: { company: crmCompanySnapshot(event.record), actorId },
      }
    case 'document':
      if (event.action === 'sent') {
        return {
          type: 'crm.document.sent',
          data: {
            document: documentSnapshot(event.record),
            actorId,
            recipients: event.recipients,
          },
        }
      }
      return {
        type: `crm.document.${event.action}`,
        data: { document: documentSnapshot(event.record), actorId },
      }
    case 'document_answer':
      return {
        type: `crm.document.${event.action}`,
        data: {
          document: event.document,
          reader: event.reader,
          reason: event.reason,
        },
      }
    case 'sd_customer':
      return {
        type: `servicedesk.customer.${event.action}`,
        data: { customer: sdCustomerSnapshot(event.record), actorId },
      }
    case 'sd_contact':
      return {
        type: `servicedesk.contact.${event.action}`,
        data: { contact: sdContactSnapshot(event.record), actorId },
      }
    case 'kb_article':
      return {
        type: `servicedesk.kb_article.${event.action}`,
        data: { article: sdKbArticleSnapshot(event.record), actorId },
      }
  }
}

/** `actorId`: the user who did it, or `null` (public link, automation). */
export async function emitEntityWebhook(
  workspaceId: string,
  actorId: string | null,
  event: EntityWebhook,
): Promise<void> {
  let built: Built
  try {
    built = buildEntityWebhook(event, actorId)
  } catch (cause) {
    logger.warn(
      'webhooks.entity_build_failed',
      logFields(
        { component: 'WebhookEntityEvents', workspaceId },
        {
          entity: event.entity,
          action: event.action,
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    )
    return
  }
  // `built.type` and `built.data` are a matching pair (see `Built`); the
  // emitter validates `data` against the catalog before sending.
  await emitWebhookEvent(workspaceId, built.type, built.data as never)
}
