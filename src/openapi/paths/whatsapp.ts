import type { OpenApiRegistry, RouteConfig } from '../registry'
import { aiRoutes } from './whatsapp/ai'
import { broadcastRoutes } from './whatsapp/broadcasts'
import { buttonRoutes } from './whatsapp/buttons'
import { connectionRoutes } from './whatsapp/connections'
import { contactRoutes } from './whatsapp/contacts'
import { conversationRoutes } from './whatsapp/conversations'
import { dashboardRoutes } from './whatsapp/dashboards'
import { groupRoutes } from './whatsapp/groups'
import { realtimeRoutes } from './whatsapp/realtime'
import { settingsRoutes } from './whatsapp/settings'
import { templateRoutes } from './whatsapp/templates'

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
  ...templateRoutes,
  ...buttonRoutes,
  ...aiRoutes,
  ...settingsRoutes,
  ...dashboardRoutes,
  ...realtimeRoutes,
]

export function registerWhatsAppPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
