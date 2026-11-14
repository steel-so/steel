import type { TourDefinition } from '../../types'
import { CRM_MARKETING_TOURS } from './marketing'
import { CRM_SALES_TOURS } from './sales'

export const CRM_TOURS: readonly TourDefinition[] = [
  ...CRM_SALES_TOURS,
  ...CRM_MARKETING_TOURS,
]
