import type { TourDefinition } from '../../types'
import { changesCalendarTour } from './changes-calendar'
import { configItemsTour } from './config-items'
import { dashboardsTour } from './dashboards'
import { inventoryTour } from './inventory'
import { knowledgeTour } from './knowledge'
import { knowledgeArticleTour } from './knowledge-article'
import { majorIncidentRoomTour } from './major-incident-room'
import { majorIncidentsTour } from './major-incidents'
import { portalTour } from './portal'
import { portalNewTour } from './portal-new'
import { settingsTour } from './settings'
import { statusPagesTour } from './status-pages'
import { ticketTour } from './ticket'
import { ticketsTour } from './tickets'

export const SERVICEDESK_TOURS: readonly TourDefinition[] = [
  ticketsTour,
  ticketTour,
  portalTour,
  portalNewTour,
  settingsTour,
  knowledgeTour,
  knowledgeArticleTour,
  changesCalendarTour,
  majorIncidentsTour,
  majorIncidentRoomTour,
  configItemsTour,
  inventoryTour,
  dashboardsTour,
  statusPagesTour,
]
