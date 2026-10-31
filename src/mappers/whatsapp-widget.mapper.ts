import type { WhatsAppWidgetSettings } from '@prisma/client'
import { SURVEY_SCALES } from '@/src/lib/survey/scale'
import {
  buildWidgetSnippet,
  WIDGET_KEY_PREFIX,
  type WidgetSurveyKind,
  widgetSurveyQuestion,
} from '@/src/lib/whatsapp/widget'
import type { WidgetMessageRow } from '@/src/repositories/whatsapp-widget.repository'
import type {
  WhatsAppWidgetPositionDTO,
  WhatsAppWidgetSettingsDTO,
  WidgetMessageDTO,
  WidgetPublicConfigDTO,
  WidgetSurveyDTO,
} from '@/types/whatsapp-widget'

export const WHATSAPP_WIDGET_DEFAULTS = {
  enabled: false,
  allowedOrigins: [] as string[],
  title: 'Fale com a gente',
  welcomeMessage: 'Olá! Como podemos ajudar?',
  accentColor: '#2563eb',
  position: 'RIGHT' as WhatsAppWidgetPositionDTO,
  preChatEnabled: false,
  preChatAskEmail: true,
  preChatAskPhone: false,
  offlineEnabled: true,
  offlineMessage:
    'No momento estamos fora do horário de atendimento. Deixe sua mensagem que respondemos assim que possível.',
  teamId: null as string | null,
  showPortal: false,
  showSurvey: false,
}

function position(value: string): WhatsAppWidgetPositionDTO {
  return value === 'LEFT' ? 'LEFT' : 'RIGHT'
}

/** Admin DTO. `row` null = the workspace never saved (defaults, no key yet). */
export function toWhatsAppWidgetSettingsDTO(
  workspaceId: string,
  row: WhatsAppWidgetSettings | null,
  baseUrl: string,
): WhatsAppWidgetSettingsDTO {
  const publicKey = row?.publicKey ?? ''
  return {
    workspaceId,
    enabled: row?.enabled ?? WHATSAPP_WIDGET_DEFAULTS.enabled,
    publicKey,
    allowedOrigins: row?.allowedOrigins ?? WHATSAPP_WIDGET_DEFAULTS.allowedOrigins,
    title: row?.title ?? WHATSAPP_WIDGET_DEFAULTS.title,
    welcomeMessage: row?.welcomeMessage ?? WHATSAPP_WIDGET_DEFAULTS.welcomeMessage,
    accentColor: row?.accentColor ?? WHATSAPP_WIDGET_DEFAULTS.accentColor,
    position: row ? position(row.position) : WHATSAPP_WIDGET_DEFAULTS.position,
    preChatEnabled: row?.preChatEnabled ?? WHATSAPP_WIDGET_DEFAULTS.preChatEnabled,
    preChatAskEmail:
      row?.preChatAskEmail ?? WHATSAPP_WIDGET_DEFAULTS.preChatAskEmail,
    preChatAskPhone:
      row?.preChatAskPhone ?? WHATSAPP_WIDGET_DEFAULTS.preChatAskPhone,
    offlineEnabled: row?.offlineEnabled ?? WHATSAPP_WIDGET_DEFAULTS.offlineEnabled,
    offlineMessage: row?.offlineMessage ?? WHATSAPP_WIDGET_DEFAULTS.offlineMessage,
    teamId: row?.teamId ?? WHATSAPP_WIDGET_DEFAULTS.teamId,
    showPortal: row?.showPortal ?? WHATSAPP_WIDGET_DEFAULTS.showPortal,
    showSurvey: row?.showSurvey ?? WHATSAPP_WIDGET_DEFAULTS.showSurvey,
    snippet: publicKey.startsWith(WIDGET_KEY_PREFIX)
      ? buildWidgetSnippet(baseUrl, publicKey)
      : '',
    portalUrl: `${baseUrl}/suporte`,
  }
}

/** What the script on the site reads (never exposes admin-only fields). */
export function toWidgetPublicConfigDTO(
  row: WhatsAppWidgetSettings,
  online: boolean,
  baseUrl: string,
): WidgetPublicConfigDTO {
  return {
    title: row.title,
    welcomeMessage: row.welcomeMessage,
    accentColor: row.accentColor,
    position: position(row.position),
    preChatEnabled: row.preChatEnabled,
    preChatAskEmail: row.preChatAskEmail,
    preChatAskPhone: row.preChatAskPhone,
    online,
    offlineMessage: !online && row.offlineEnabled ? row.offlineMessage : null,
    portalUrl: row.showPortal ? `${baseUrl}/suporte` : null,
  }
}

const NO_TEXT_PLACEHOLDER: Record<string, string> = {
  IMAGE: 'Enviou uma imagem',
  AUDIO: 'Enviou um áudio',
  VIDEO: 'Enviou um vídeo',
  DOCUMENT: 'Enviou um documento',
}

export function toWidgetMessageDTO(row: WidgetMessageRow): WidgetMessageDTO {
  const from =
    row.direction === 'IN' ? 'visitor' : row.sentByAi ? 'ai' : 'agent'
  const text = row.text?.trim() || NO_TEXT_PLACEHOLDER[row.type] || 'Mensagem'
  return {
    id: row.id,
    from,
    text,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toWidgetSurveyDTO(kind: WidgetSurveyKind): WidgetSurveyDTO {
  return {
    kind,
    question: widgetSurveyQuestion(kind),
    scaleMin: SURVEY_SCALES[kind].min,
    scaleMax: SURVEY_SCALES[kind].max,
  }
}
