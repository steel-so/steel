import type { OpenApiRegistry, RouteConfig } from '../registry'
import { sdAiComparisonRoutes } from './servicedesk/ai-comparison'
import { sdChangeCabRoutes } from './servicedesk/change-cab'
import { sdConfigRoutes } from './servicedesk/config'
import { sdContractRoutes } from './servicedesk/contracts'
import { sdDashboardsPortalRoutes } from './servicedesk/dashboards-portal'
import { sdDirectoryRoutes } from './servicedesk/directory'
import { sdExternalPortalRoutes } from './servicedesk/external-portal'
import { sdIntegrationRoutes } from './servicedesk/integrations'
import { sdInventoryRoutes } from './servicedesk/inventory'
import { sdInventoryFollowupRoutes } from './servicedesk/inventory-followups'
import { sdKcsRoutes } from './servicedesk/kcs'
import { sdMailRoutes } from './servicedesk/mail'
import { sdMajorIncidentRoutes } from './servicedesk/major-incident'
import { sdMonitoringRoutes } from './servicedesk/monitoring'
import { sdNlConfigRoutes } from './servicedesk/nl-config'
import { sdNotificationRoutes } from './servicedesk/notifications'
import { sdOnCallRoutes } from './servicedesk/oncall'
import { sdRecurringRoutes } from './servicedesk/recurring'
import { sdReportRoutes } from './servicedesk/reports'
import { sdRiskRoutes } from './servicedesk/risk'
import { sdWfmRoutes } from './servicedesk/wfm'
import { sdSwarmRoutes } from './servicedesk/swarm'
import { sdTicketTabRoutes } from './servicedesk/ticket-tabs'
import { sdWhatsappAiRoutes } from './servicedesk/whatsapp-ai'

/**
 * ServiceDesk — `app/api/workspaces/[id]/servicedesk/**` (sessão + membro +
 * módulo SERVICE_DESK; admin × agente × solicitante no service). Uma lista
 * de rotas por fatia em `./servicedesk/*.ts`; DTOs em
 * `../schemas/servicedesk-*.ts`.
 */
const routes: RouteConfig[] = [
  ...sdConfigRoutes,
  ...sdDirectoryRoutes,
  ...sdMonitoringRoutes,
  ...sdTicketTabRoutes,
  ...sdNotificationRoutes,
  ...sdDashboardsPortalRoutes,
  ...sdExternalPortalRoutes,
  ...sdWhatsappAiRoutes,
  ...sdMailRoutes,
  ...sdOnCallRoutes,
  ...sdRecurringRoutes,
  ...sdReportRoutes,
  ...sdChangeCabRoutes,
  ...sdContractRoutes,
  ...sdRiskRoutes,
  ...sdWfmRoutes,
  ...sdKcsRoutes,
  ...sdAiComparisonRoutes,
  ...sdIntegrationRoutes,
  ...sdSwarmRoutes,
  ...sdMajorIncidentRoutes,
  ...sdInventoryRoutes,
  ...sdInventoryFollowupRoutes,
  ...sdNlConfigRoutes,
]

export function registerServiceDeskPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
