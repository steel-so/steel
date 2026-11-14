import type { TourDefinition } from '../../../types'
import { crmDashboardBuilderTour } from './dashboard-builder'
import { crmDashboardsTour } from './dashboards'
import { crmDocumentsEditorTour } from './documents-editor'
import { crmLeadsTour } from './leads'
import { crmOpportunitiesTour } from './opportunities'
import { crmPeopleTour } from './people'
import { crmPipelinesTour } from './pipelines'
import { crmReportsTour } from './reports'
import { crmSocialTour } from './social'

export const CRM_SALES_TOURS: readonly TourDefinition[] = [
  crmLeadsTour,
  crmOpportunitiesTour,
  crmPipelinesTour,
  crmPeopleTour,
  crmDocumentsEditorTour,
  crmDashboardsTour,
  crmDashboardBuilderTour,
  crmReportsTour,
  crmSocialTour,
]
