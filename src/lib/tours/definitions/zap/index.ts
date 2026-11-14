import type { TourDefinition } from '../../types'
import { aiCampaignEditorTour } from './ai-campaign-editor'
import { aiCampaignsTour } from './ai-campaigns'
import { aiSettingsTour } from './ai-settings'
import { broadcastsTour } from './broadcasts'
import { chatbotEditorTour } from './chatbot-editor'
import { connectionsTour } from './connections'
import { conversationsTour } from './conversations'
import { dashboardsTour } from './dashboards'
import { flowEditorTour } from './flow-editor'
import { surveysTour } from './surveys'
import { teamsTour } from './teams'
import { templatesTour } from './templates'

export const ZAP_TOURS: readonly TourDefinition[] = [
  conversationsTour,
  connectionsTour,
  templatesTour,
  broadcastsTour,
  aiCampaignsTour,
  aiCampaignEditorTour,
  chatbotEditorTour,
  flowEditorTour,
  teamsTour,
  aiSettingsTour,
  surveysTour,
  dashboardsTour,
]
