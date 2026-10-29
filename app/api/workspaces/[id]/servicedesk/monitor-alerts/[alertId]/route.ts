import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { LinkSdMonitorAlertSchema } from '@/src/schemas/sd-monitor-source.schema'
import { SdMonitorSourceService } from '@/src/services/sd-monitor-source.service'

/** Liga (ou desliga) o item da CMDB de um alerta. Só agentes. */
export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/servicedesk/monitor-alerts/[alertId]',
  body: LinkSdMonitorAlertSchema,
  handler: ({ userId, params, body }) =>
    SdMonitorSourceService.linkAlert(userId, params.id, params.alertId, body),
})
