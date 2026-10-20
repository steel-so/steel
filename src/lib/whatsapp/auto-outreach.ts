import type { WhatsAppConnection, WhatsAppTemplate } from '@prisma/client'
import {
  buildMetaSendComponents,
  extractTemplateFillableFields,
  parseMetaTemplateComponents,
  renderTemplateText,
} from './template-variables'

/** Pause between two automatic sends until the workspace picks its own. */
export const WHATSAPP_AUTO_OUTREACH_DEFAULT_INTERVAL_SECONDS = 30
/** Skipped contacts (opt-out, already in service) move on almost at once. */
export const WHATSAPP_AUTO_OUTREACH_SKIP_DELAY_MS = 1000
/** Contacts added in one call (the whole contact list at most). */
export const WHATSAPP_AUTO_OUTREACH_MAX_QUEUE = 10_000

/**
 * Why a template cannot be sent automatically, or `null` when it can: it
 * must be approved, belong to a Meta connection of the Communication module
 * and have no dynamic URL button (there is no value to fill per contact).
 * Text variables ({{n}}) are filled with the contact's first name.
 */
export function autoOutreachTemplateProblem(
  connection: Pick<WhatsAppConnection, 'provider' | 'module'>,
  template: Pick<WhatsAppTemplate, 'status' | 'components'>,
): string | null {
  if (connection.provider !== 'META' || connection.module !== 'COMMUNICATION') {
    return 'O disparo automático usa uma conexão da API oficial da Meta do módulo Comunicação'
  }
  if (template.status !== 'APPROVED') {
    return 'O template precisa estar aprovado pela Meta'
  }
  const fields = extractTemplateFillableFields(
    parseMetaTemplateComponents(template.components as unknown[]),
  )
  if (fields.urlButtonVariables.length > 0) {
    return 'Templates com botão de link dinâmico não podem ser enviados automaticamente'
  }
  return null
}

/** First name of the contact, the value of every text variable. */
export function autoOutreachVariableValue(contactName: string | null): string {
  const first = contactName?.trim().split(/\s+/)[0]
  return first || 'cliente'
}

/**
 * Meta `components` for the send (every {{n}} = the first name) and the
 * body text as the contact reads it, stored on the outbound message.
 */
export function buildAutoOutreachTemplate(
  template: Pick<WhatsAppTemplate, 'components'>,
  contactName: string | null,
): { components: unknown[]; text: string } {
  const fields = extractTemplateFillableFields(
    parseMetaTemplateComponents(template.components as unknown[]),
  )
  const value = autoOutreachVariableValue(contactName)
  const fill = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [i + 1, value]),
    ) as Record<number, string>
  const body = fill(fields.body.variableCount)

  return {
    components: buildMetaSendComponents(fields, {
      header: fill(fields.header.variableCount),
      body,
      buttons: {},
    }),
    text: renderTemplateText(fields.body.text, body),
  }
}
