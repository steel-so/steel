import {
  BookmarkAdd01Icon,
  BracketsIcon,
  PaintBoardIcon,
  SparklesIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ComponentType } from 'react'
import type {
  CanvasCatalog,
  CanvasComponentDefinition,
  CustomControlProps,
  InspectorSection,
} from '@/src/lib/canvas/registry'
import { EMAIL_AI_FIELDS } from '@/src/lib/canvas-email/ai-blocks'
import {
  createEmailCatalog,
  EMAIL_BLOCK_TYPES,
} from '@/src/lib/canvas-email/catalog'
import { SECTION } from '@/src/lib/canvas-email/components/layout'
import type { EmailRenderContext } from '@/src/lib/canvas-email/theme'
import { AiTextControl } from './ai-text-control'
import { ConditionControl } from './condition-control'
import {
  DeviceVisibilityControl,
  MobileFontSizeControl,
  MobilePaddingControl,
} from './mobile-controls'

export const PRODUCT_BLOCK = 'email.product'

/** Icons of the editor's own sidebar tabs (resolved through the catalog). */
export const EDITOR_TAB_ICONS = {
  'global-styles': PaintBoardIcon,
  variables: BracketsIcon,
  saved: BookmarkAdd01Icon,
  ai: SparklesIcon,
}

/** Types that take "Mostrar se" (sections and content blocks). */
const CONDITIONAL_TYPES = new Set([SECTION, ...EMAIL_BLOCK_TYPES])

const custom = (component: ComponentType<CustomControlProps>) =>
  ({ kind: 'custom', component }) as const

/**
 * Editor-only inspector sections (E3): "IA" on text blocks, "Mostrar se"
 * on sections and blocks, and the "Celular" overrides (visibility, padding,
 * font size) wherever the component has those props.
 */
export function editorSections(
  definition: CanvasComponentDefinition,
): InspectorSection[] {
  const sections: InspectorSection[] = []
  const ai = EMAIL_AI_FIELDS[definition.type]
  if (ai) {
    sections.push({
      id: 'editor-ai',
      label: 'IA',
      tab: 'content',
      fields: [
        {
          path: ai.path,
          label: 'Texto com IA',
          control: custom(AiTextControl),
        },
      ],
    })
  }
  const defaults = definition.defaultProps() as Record<string, unknown>
  const hasTypography = definition.inspector.some((section) =>
    section.fields.some((field) => field.path === 'typography'),
  )
  const mobile: InspectorSection['fields'] = []
  if ('visibility' in defaults) {
    mobile.push({
      path: 'visibility',
      label: 'Exibição',
      control: custom(DeviceVisibilityControl),
    })
  }
  if ('padding' in defaults) {
    mobile.push({
      path: 'padding',
      label: 'Margem',
      control: custom(MobilePaddingControl),
    })
  }
  if (hasTypography) {
    mobile.push({
      path: 'typography',
      label: 'Fonte',
      control: custom(MobileFontSizeControl),
    })
  }
  if (mobile.length > 0) {
    sections.push({
      id: 'editor-mobile',
      label: 'Celular',
      tab: 'advanced',
      fields: mobile,
      collapsed: true,
    })
  }
  if (CONDITIONAL_TYPES.has(definition.type)) {
    sections.push({
      id: 'editor-condition',
      label: 'Mostrar se',
      tab: 'advanced',
      fields: [
        {
          path: 'showIf',
          label: 'Condição',
          help: 'Só os destinatários que atendem à condição recebem este elemento.',
          control: custom(ConditionControl),
        },
      ],
    })
  }
  return sections
}

/** Swaps the provisional text field of `productId` for a custom control. */
function withProductPicker(
  definition: CanvasComponentDefinition,
  picker: ComponentType<CustomControlProps>,
): CanvasComponentDefinition {
  const inspector = definition.inspector.map(
    (section): InspectorSection => ({
      ...section,
      fields: section.fields.map((field) =>
        field.path === 'productId'
          ? { ...field, control: { kind: 'custom', component: picker } }
          : field,
      ),
    }),
  )
  return { ...definition, inspector }
}

/**
 * The e-mail catalog as the CRM editor uses it: render context read on
 * every render (brand, products, the document), the HTML block only for
 * workspace admins, the CRM product picker, the editor-only inspector
 * sections (IA, Celular, Mostrar se) and the icons of the editor tabs.
 */
export function createEditorEmailCatalog(options: {
  allowHtml: boolean
  context: () => EmailRenderContext
  productPicker: ComponentType<CustomControlProps>
}): CanvasCatalog {
  const catalog = createEmailCatalog({
    allowHtml: options.allowHtml,
    context: options.context,
  })
  const components: Record<string, CanvasComponentDefinition> = {}
  for (const [type, definition] of Object.entries(catalog.components)) {
    const withPicker =
      type === PRODUCT_BLOCK
        ? withProductPicker(definition, options.productPicker)
        : definition
    components[type] = {
      ...withPicker,
      inspector: [...withPicker.inspector, ...editorSections(withPicker)],
    }
  }
  return {
    ...catalog,
    components,
    icons: { ...catalog.icons, ...EDITOR_TAB_ICONS },
  }
}
