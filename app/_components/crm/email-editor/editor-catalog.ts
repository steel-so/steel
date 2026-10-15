import {
  BracketsIcon,
  PaintBoardIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ComponentType } from 'react'
import type {
  CanvasCatalog,
  CanvasComponentDefinition,
  CustomControlProps,
  InspectorSection,
} from '@/src/lib/canvas/registry'
import { createEmailCatalog } from '@/src/lib/canvas-email/catalog'
import type { EmailRenderContext } from '@/src/lib/canvas-email/theme'

export const PRODUCT_BLOCK = 'email.product'

/** Icons of the editor's own sidebar tabs (resolved through the catalog). */
export const EDITOR_TAB_ICONS = {
  'global-styles': PaintBoardIcon,
  variables: BracketsIcon,
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
 * workspace admins, the CRM product picker and the icons of the editor tabs.
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
  const product = catalog.components[PRODUCT_BLOCK]
  return {
    ...catalog,
    components: {
      ...catalog.components,
      [PRODUCT_BLOCK]: withProductPicker(product, options.productPicker),
    },
    icons: { ...catalog.icons, ...EDITOR_TAB_ICONS },
  }
}
