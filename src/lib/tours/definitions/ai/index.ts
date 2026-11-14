import type { TourDefinition } from '../../types'
import { agentsNewTour } from './agents-new'
import { chatTour } from './chat'
import { memoryTour } from './memory'
import { proceduresEditorTour } from './procedures-editor'
import { skillsTour } from './skills'

export const AI_TOURS: readonly TourDefinition[] = [
  chatTour,
  agentsNewTour,
  proceduresEditorTour,
  skillsTour,
  memoryTour,
]
