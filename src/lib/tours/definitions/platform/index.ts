import type { TourDefinition } from '../../types'
import { homeTour } from './home'
import { inboxTour } from './inbox'
import { settingsMembersTour } from './settings-members'
import { whiteboardBoardTour } from './whiteboard-board'
import { wikiPageTour } from './wiki-page'

export const PLATFORM_TOURS: readonly TourDefinition[] = [
  homeTour,
  inboxTour,
  wikiPageTour,
  whiteboardBoardTour,
  settingsMembersTour,
]
