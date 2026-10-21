import type {
  AiCampaignVariableSource,
  AiCampaignVariables,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import {
  buildMetaSendComponents,
  extractTemplateFillableFields,
  parseMetaTemplateComponents,
  renderTemplateText,
  type TemplateFillableFields,
} from './template-variables'

/**
 * Campanhas de IA — partes puras (sem banco), seguras para o navegador:
 * as variáveis de um template e como cada uma é preenchida por contato.
 */

export type AiCampaignVariableGroup = 'header' | 'body' | 'buttons'

/** Um campo a preencher no template (cabeçalho, corpo ou botão de link). */
export interface AiCampaignVariableSlot {
  group: AiCampaignVariableGroup
  /** Posição: número da variável (`{{1}}` = "1") ou índice do botão. */
  key: string
  label: string
}

/** O que o preenchimento lê de cada contato. */
export interface AiCampaignRecipientContext {
  contactName: string | null
  waId: string
  description: string | null
  /** Colunas da planilha importada (coluna → valor). */
  values: Record<string, string>
}

export interface AiCampaignTemplateValues {
  header: Record<number, string>
  body: Record<number, string>
  buttons: Record<number, string>
}

export function templateFields(components: unknown): TemplateFillableFields {
  return extractTemplateFillableFields(
    parseMetaTemplateComponents(Array.isArray(components) ? components : []),
  )
}

/** Every fillable spot of the template, in display order. */
export function templateVariableSlots(
  fields: TemplateFillableFields,
): AiCampaignVariableSlot[] {
  const slots: AiCampaignVariableSlot[] = []
  for (let i = 1; i <= fields.header.variableCount; i += 1) {
    slots.push({
      group: 'header',
      key: String(i),
      label: `Cabeçalho {{${i}}}`,
    })
  }
  for (let i = 1; i <= fields.body.variableCount; i += 1) {
    slots.push({ group: 'body', key: String(i), label: `Variável {{${i}}}` })
  }
  for (const index of fields.urlButtonVariables) {
    slots.push({
      group: 'buttons',
      key: String(index),
      label: `Link do botão "${fields.buttons[index]?.text ?? index + 1}"`,
    })
  }
  return slots
}

/** Slots with no source chosen yet — the campaign cannot play with any. */
export function missingVariableSlots(
  fields: TemplateFillableFields,
  variables: AiCampaignVariables,
): AiCampaignVariableSlot[] {
  return templateVariableSlots(fields).filter(
    (slot) => !variables[slot.group]?.[slot.key],
  )
}

/** Spreadsheet columns the mapping reads. */
export function variableColumns(variables: AiCampaignVariables): string[] {
  const columns = new Set<string>()
  for (const group of ['header', 'body', 'buttons'] as const) {
    for (const source of Object.values(variables[group] ?? {})) {
      if (source.source === 'COLUMN') columns.add(source.column)
    }
  }
  return [...columns]
}

function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] ?? ''
}

function sourceValue(
  source: AiCampaignVariableSource,
  context: AiCampaignRecipientContext,
): string {
  switch (source.source) {
    case 'FIXED':
      return source.value
    case 'CONTACT': {
      const raw =
        source.field === 'FIRST_NAME'
          ? firstName(context.contactName)
          : source.field === 'NAME'
            ? (context.contactName?.trim() ?? '')
            : source.field === 'PHONE'
              ? context.waId
              : (context.description?.trim() ?? '')
      return raw || source.fallback || ''
    }
    case 'COLUMN':
      return context.values[source.column]?.trim() || source.fallback || ''
  }
}

/**
 * The values for one contact, or the first slot left empty (no value and no
 * fallback) — that contact is skipped rather than sent a broken message.
 */
export function resolveTemplateValues(
  fields: TemplateFillableFields,
  variables: AiCampaignVariables,
  context: AiCampaignRecipientContext,
):
  | { ok: true; values: AiCampaignTemplateValues }
  | { ok: false; missing: AiCampaignVariableSlot } {
  const values: AiCampaignTemplateValues = { header: {}, body: {}, buttons: {} }
  for (const slot of templateVariableSlots(fields)) {
    const source = variables[slot.group]?.[slot.key]
    const value = source ? sourceValue(source, context) : ''
    if (!value) return { ok: false, missing: slot }
    values[slot.group][Number(slot.key)] = value
  }
  return { ok: true, values }
}

/** Values for the preview: a missing value shows as `[slot label]`. */
export function previewTemplateValues(
  fields: TemplateFillableFields,
  variables: AiCampaignVariables,
  context: AiCampaignRecipientContext,
): AiCampaignTemplateValues {
  const values: AiCampaignTemplateValues = { header: {}, body: {}, buttons: {} }
  for (const slot of templateVariableSlots(fields)) {
    const source = variables[slot.group]?.[slot.key]
    const value = source ? sourceValue(source, context) : ''
    values[slot.group][Number(slot.key)] = value || `[${slot.label}]`
  }
  return values
}

/** Meta `components` for the send and the body as the contact reads it. */
export function buildAiCampaignMessage(
  fields: TemplateFillableFields,
  values: AiCampaignTemplateValues,
): { components: unknown[]; text: string } {
  return {
    components: buildMetaSendComponents(fields, values),
    text: renderTemplateText(fields.body.text, values.body),
  }
}

/**
 * Why the template cannot go out from this connection, or `null`. Any
 * template structure is accepted; Meta only lets approved templates out,
 * and only from its own API (Comunicação module).
 */
export function aiCampaignTemplateProblem(
  connection: { provider: string; module: string },
  template: { status: string },
): string | null {
  if (connection.provider !== 'META' || connection.module !== 'COMMUNICATION') {
    return 'Campanhas de IA usam uma conexão da API oficial da Meta do módulo Comunicação'
  }
  if (template.status !== 'APPROVED') {
    return 'O template precisa estar aprovado pela Meta para ser enviado'
  }
  return null
}

/** "300 contatos a cada 30 s ≈ 2 h 30 min" — the review step estimate. */
export function estimateAiCampaignDuration(
  pending: number,
  intervalSeconds: number,
): number {
  return Math.max(0, pending - 1) * intervalSeconds
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}
