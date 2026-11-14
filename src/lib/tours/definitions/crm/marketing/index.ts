import type { TourDefinition } from '../../../types'
import { cadenceStatsTour } from './cadence-stats'
import { cadencesTour } from './cadences'
import { campaignFlowTour } from './campaign-flow'
import { campaignsTour } from './campaigns'
import { emailCampaignsTour } from './email-campaigns'
import { emailEditorTour } from './email-editor'
import { emailTemplatesTour } from './email-templates'
import { emailTemplatesNewTour } from './email-templates-new'
import { formBuilderTour } from './form-builder'
import { mailingListsTour } from './mailing-lists'
import { newsletterIssueTour } from './newsletter-issue'
import { newsletterReportTour } from './newsletter-report'
import { newsletterViewTour } from './newsletter-view'
import { newslettersTour } from './newsletters'
import { siteBlogPostTour } from './site-blog-post'
import { siteEditorTour } from './site-editor'
import { sitesTour } from './sites'
import { workflowEditorTour } from './workflow-editor'
import { workflowsTour } from './workflows'

export const CRM_MARKETING_TOURS: readonly TourDefinition[] = [
  sitesTour,
  siteEditorTour,
  siteBlogPostTour,
  campaignsTour,
  campaignFlowTour,
  emailCampaignsTour,
  mailingListsTour,
  emailTemplatesTour,
  emailTemplatesNewTour,
  emailEditorTour,
  newslettersTour,
  newsletterViewTour,
  newsletterIssueTour,
  newsletterReportTour,
  formBuilderTour,
  workflowsTour,
  workflowEditorTour,
  cadencesTour,
  cadenceStatsTour,
]
