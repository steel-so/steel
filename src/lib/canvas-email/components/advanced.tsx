import {
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import { spacing } from '@/src/lib/canvas/values'
import { BLOCK_LAYOUT_SECTION } from '../inspector'
import { BlockFrame, EditorHint, SHOWN } from '../primitives'
import { sanitizeEmailHtml } from '../sanitize-html'
import { type EmailHtmlProps, htmlSchema } from '../schemas'
import { useEmailBody } from './layout'

export const HTML_BLOCK = 'email.html'

function HtmlView(props: CanvasRenderProps<EmailHtmlProps>) {
  const { node, editing } = props
  const body = useEmailBody()
  const html = sanitizeEmailHtml(node.props.html).trim()
  if (!html && !editing) return null
  return (
    <BlockFrame {...props}>
      {html ? (
        <div
          style={{ fontFamily: body.fontStack, color: body.textColor }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <EditorHint editing={editing} label='Cole o seu HTML' />
      )}
    </BlockFrame>
  )
}

/** Raw HTML (sanitized). Only workspace admins may add or change it — the
 * service enforces it; the editor hides it from the palette of others. */
export const htmlDefinition = defineComponent<EmailHtmlProps>({
  type: HTML_BLOCK,
  label: 'HTML',
  icon: 'html',
  category: 'Avançado',
  keywords: ['código', 'personalizado', 'embed'],
  propsSchema: htmlSchema,
  defaultProps: () => ({
    html: '<p style="margin:0">Seu HTML aqui</p>',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'HTML',
      tab: 'content',
      fields: [
        {
          path: 'html',
          label: 'Código',
          control: { kind: 'textarea', rows: 12, maxLength: 50_000 },
          help: 'Scripts, formulários e eventos são removidos. Só administradores editam este bloco.',
        },
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: (props) => <HtmlView {...props} />,
})
