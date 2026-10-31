import type { OpenApiRegistry, RouteConfig } from '../registry'
import { aiRoutes } from './whatsapp/ai'
import { aiCampaignRoutes } from './whatsapp/ai-campaigns'
import { archiveRoutes } from './whatsapp/archives'
import { broadcastRoutes } from './whatsapp/broadcasts'
import { buttonRoutes } from './whatsapp/buttons'
import { chatbotRoutes } from './whatsapp/chatbots'
import { connectionRoutes } from './whatsapp/connections'
import { contactRoutes } from './whatsapp/contacts'
import { conversationRoutes } from './whatsapp/conversations'
import { dashboardRoutes } from './whatsapp/dashboards'
import { flowRoutes } from './whatsapp/flows'
import { groupRoutes } from './whatsapp/groups'
import { phoneCallRoutes } from './whatsapp/phone-calls'
import { pixRoutes } from './whatsapp/pix'
import { realtimeRoutes } from './whatsapp/realtime'
import { settingsRoutes } from './whatsapp/settings'
import { slaRoutes } from './whatsapp/sla'
import { surveyRoutes } from './whatsapp/surveys'
import { teamRoutes } from './whatsapp/teams'
import { templateRoutes } from './whatsapp/templates'
import { voiceAgentRoutes } from './whatsapp/voice-agent'
import { widgetRoutes } from './whatsapp/widget'

/**
 * Comunicação (WhatsApp) — `app/api/workspaces/[id]/whatsapp/**` (sessão +
 * membro + módulo COMMUNICATION; peças comuns em `./whatsapp/shared`), o SSE
 * `app/api/whatsapp/events` e os webhooks de entrada
 * `app/api/whatsapp/webhook/{meta,zapi}`. Uma lista de rotas por tag em
 * `./whatsapp/*.ts`; DTOs em `../schemas/whatsapp`.
 */
const routes: RouteConfig[] = [
  ...connectionRoutes,
  ...conversationRoutes,
  ...contactRoutes,
  ...groupRoutes,
  ...broadcastRoutes,
  ...aiCampaignRoutes,
  ...templateRoutes,
  ...buttonRoutes,
  ...aiRoutes,
  ...settingsRoutes,
  ...dashboardRoutes,
  ...realtimeRoutes,
  ...teamRoutes,
  ...phoneCallRoutes,
  ...voiceAgentRoutes,
  ...slaRoutes,
  ...archiveRoutes,
  ...chatbotRoutes,
  ...flowRoutes,
  ...surveyRoutes,
  ...pixRoutes,
  ...widgetRoutes,
]

export function registerWhatsAppPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
