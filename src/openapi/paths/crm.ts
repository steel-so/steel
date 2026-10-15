import type { OpenApiRegistry, RouteConfig } from '../registry'
import { crmActivitiesRoutes } from './crm/activities'
import { crmCampaignRoutes } from './crm/campaigns'
import { crmEmailRoutes } from './crm/email'
import { crmEmailEditorRoutes } from './crm/email-editor'
import { crmForecastRoutes } from './crm/forecast'
import { crmFormsRoutes } from './crm/forms'
import { crmHookVaultRoutes } from './crm/hook-vault'
import { crmIntegrationsRoutes } from './crm/integrations'
import { crmLeadsRoutes } from './crm/leads'
import { crmOpportunitiesRoutes } from './crm/opportunities'
import { crmPeopleRoutes } from './crm/people'
import { crmProductsRoutes } from './crm/products'
import { crmProposalsRoutes } from './crm/proposals'
import { crmReportsRoutes } from './crm/reports'
import { crmSettingsRoutes } from './crm/settings'
import { crmSiteExperimentRoutes } from './crm/site-experiments'
import { crmSitePlatformRoutes } from './crm/site-platform'
import { crmSiteStudioRoutes } from './crm/site-studio'
import { crmSitesRoutes } from './crm/sites'
import { crmSocialRoutes } from './crm/social'
import { crmWorkflowsRoutes } from './crm/workflows'

/**
 * CRM interno — `app/api/workspaces/[id]/crm/**` (sessão + membro do
 * workspace + módulo CRM habilitado + permissão recurso × ação; peças comuns
 * em `./crm/shared.ts`). As APIs públicas do CRM (`/crm/*`) ficam em
 * `./public.ts`. Cada grupo de tags tem seu arquivo em `./crm/`; os DTOs de
 * resposta ficam em `../schemas/crm/`.
 */
const routes: RouteConfig[] = [
  ...crmActivitiesRoutes,
  ...crmCampaignRoutes,
  ...crmEmailRoutes,
  ...crmEmailEditorRoutes,
  ...crmForecastRoutes,
  ...crmFormsRoutes,
  ...crmHookVaultRoutes,
  ...crmIntegrationsRoutes,
  ...crmLeadsRoutes,
  ...crmOpportunitiesRoutes,
  ...crmPeopleRoutes,
  ...crmProductsRoutes,
  ...crmProposalsRoutes,
  ...crmReportsRoutes,
  ...crmSettingsRoutes,
  ...crmSitesRoutes,
  ...crmSiteStudioRoutes,
  ...crmSitePlatformRoutes,
  ...crmSiteExperimentRoutes,
  ...crmSocialRoutes,
  ...crmWorkflowsRoutes,
]

export function registerCrmPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
