import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppConnection, WhatsAppFlow } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { buildFlowToken } from '@/src/lib/whatsapp/flows/answers'
import { firstScreenId } from '@/src/lib/whatsapp/flows/meta-json'
import { flowPrefillData } from '@/src/lib/whatsapp/flows/prefill'
import {
  buildFlowButtonComponent,
  findTemplateFlowButton,
} from '@/src/lib/whatsapp/flows/template-button'
import type { WhatsAppOutboundFlow } from '@/src/lib/whatsapp/types'
import { parseStoredDefinition } from '@/src/mappers/whatsapp-flow.mapper'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import { WhatsAppFlowResponseRepository } from '@/src/repositories/whatsapp-flow-response.repository'

/**
 * Sends of a Flow that have no agent behind them: a template in a broadcast
 * and the "send form" node of the chatbot. The agent path lives in
 * `WhatsAppFlowService.send`; the pieces here are the same (token, prefill,
 * pending response row), just driven by the system.
 */

export interface DispatchContact {
  id: string
  name: string | null
  waId: string
}

/** Why a Flow could not be sent right now. */
export type FlowUnsendable =
  | 'not_found'
  | 'deprecated'
  | 'not_published'
  | 'other_connection'
  | 'not_meta'

function flowIssue(
  flow: WhatsAppFlow | null,
  connection?: Pick<WhatsAppConnection, 'id' | 'provider'>,
): FlowUnsendable | null {
  if (!flow) return 'not_found'
  if (flow.status === 'DEPRECATED') return 'deprecated'
  if (!flow.metaFlowId) return 'not_published'
  if (connection) {
    if (connection.provider !== 'META') return 'not_meta'
    if (flow.connectionId !== connection.id) return 'other_connection'
  }
  return null
}

export interface PreparedTemplateFlow {
  flow: WhatsAppFlow
  flowToken: string
  /** The `button` component to append to the template send. */
  component: ReturnType<typeof buildFlowButtonComponent>
}

export const WhatsAppFlowDispatchService = {
  /**
   * For a template with a FLOW button that points at one of the workspace's
   * Flows: a fresh token and the button component for this contact. `null`
   * when the template has no such button, the Flow is not ours or it is
   * retired (the send then goes without a token and the answer is matched by
   * conversation, as before).
   */
  async prepareTemplateButton(
    workspaceId: string,
    templateComponents: unknown,
    contact: DispatchContact,
  ): Promise<Result<PreparedTemplateFlow | null>> {
    const button = findTemplateFlowButton(templateComponents)
    if (!button?.metaFlowId) return ok(null)
    const found = await WhatsAppFlowRepository.findByMetaFlowId(
      workspaceId,
      button.metaFlowId,
    )
    if (!found.ok) return found
    const flow = found.value
    if (!flow || flowIssue(flow) !== null) return ok(null)

    const definition = parseStoredDefinition(
      flow.publishedDefinition ?? flow.definition,
    )
    const flowToken = buildFlowToken(flow.id, createId())
    return ok({
      flow,
      flowToken,
      component: buildFlowButtonComponent({
        index: button.index,
        flowToken,
        data: flowPrefillData(definition, contact),
      }),
    })
  },

  /**
   * Interactive message for the chatbot: validates the Flow against the
   * conversation's connection and builds the Meta payload with the prefill.
   */
  async prepareInteractive(
    workspaceId: string,
    connection: Pick<WhatsAppConnection, 'id' | 'provider'>,
    flowId: string,
    contact: DispatchContact,
    overrides: { bodyText?: string; ctaLabel?: string } = {},
  ): Promise<
    Result<
      | {
          kind: 'ready'
          flow: WhatsAppFlow
          input: Omit<WhatsAppOutboundFlow, 'to'>
        }
      | { kind: 'blocked'; reason: FlowUnsendable }
    >
  > {
    const loaded = await WhatsAppFlowRepository.findById(flowId, workspaceId)
    if (!loaded.ok) return loaded
    const flow = loaded.value
    const issue = flowIssue(flow, connection)
    if (issue || !flow)
      return ok({ kind: 'blocked', reason: issue ?? 'not_found' })

    const definition = parseStoredDefinition(
      flow.publishedDefinition ?? flow.definition,
    )
    return ok({
      kind: 'ready',
      flow,
      input: {
        flowId: flow.metaFlowId as string,
        flowToken: buildFlowToken(flow.id, createId()),
        bodyText: overrides.bodyText?.trim() || flow.bodyText,
        ctaLabel: overrides.ctaLabel?.trim() || flow.ctaLabel,
        screen: firstScreenId(),
        draft: flow.metaStatus !== 'PUBLISHED',
        data: flowPrefillData(definition, contact),
      },
    })
  },

  /**
   * Records the pending answer of a send that already left. A failure here
   * only costs the "sent" counter (the reply still resolves by the token),
   * so it is logged, never returned.
   */
  async recordSent(input: {
    workspaceId: string
    flowId: string
    contactId: string
    conversationId?: string | null
    flowToken: string
    messageId?: string | null
  }): Promise<void> {
    const saved = await WhatsAppFlowResponseRepository.create({
      workspaceId: input.workspaceId,
      flowId: input.flowId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      flowToken: input.flowToken,
      messageId: input.messageId ?? null,
    })
    if (!saved.ok) {
      logger.error('whatsapp.flow.response_record_failed', {
        flowId: input.flowId,
        reason: saved.error.code,
      })
    }
  },
}
