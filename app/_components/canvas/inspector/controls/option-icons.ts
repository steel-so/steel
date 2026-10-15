import type { IconSvgElement } from '@hugeicons/react'
import {
  AlignBottomIcon,
  AlignHorizontalCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  ArrowDown02Icon,
  ArrowRight02Icon,
  TextAlignCenterIcon,
  TextAlignJustifyLeftIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'

/** Icons segmented options can name without the catalog registering them. */
export const OPTION_ICONS: Record<string, IconSvgElement> = {
  'text-left': TextAlignLeftIcon,
  'text-center': TextAlignCenterIcon,
  'text-right': TextAlignRightIcon,
  'text-justify': TextAlignJustifyLeftIcon,
  'align-left': AlignLeftIcon,
  'align-center': AlignHorizontalCenterIcon,
  'align-right': AlignRightIcon,
  'align-top': AlignTopIcon,
  'align-middle': AlignVerticalCenterIcon,
  'align-bottom': AlignBottomIcon,
  'direction-column': ArrowDown02Icon,
  'direction-row': ArrowRight02Icon,
}

export function optionIcon(
  catalog: CanvasCatalog,
  name: string | undefined,
): IconSvgElement | undefined {
  if (!name) return undefined
  return catalog.icons?.[name] ?? OPTION_ICONS[name]
}
