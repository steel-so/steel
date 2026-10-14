'use client'

import {
  type MetaTemplateButton,
  renderTemplateText,
  type TemplateFillableFields,
} from '@/src/lib/whatsapp/template-variables'
import {
  type PreviewButton,
  type PreviewHeader,
  WhatsappBubblePreview,
} from './whatsapp-bubble-preview'

const BUTTON_TYPE: Record<MetaTemplateButton['type'], PreviewButton['type']> = {
  QUICK_REPLY: 'REPLY',
  URL: 'URL',
  PHONE_NUMBER: 'PHONE_NUMBER',
  COPY_CODE: 'COPY_CODE',
}

/** A Meta template rendered as the contact will see it, with the variables
 * filled so far. */
export function TemplatePreview({
  fields,
  values,
  headerMediaUrl,
}: {
  fields: TemplateFillableFields
  values: {
    header: Record<number, string>
    body: Record<number, string>
    buttons: Record<number, string>
  }
  /** Our stored copy of the media header (sent on every send). */
  headerMediaUrl?: string | null
}) {
  const format = fields.header.format
  let header: PreviewHeader | null = null
  if (format === 'TEXT' && fields.header.text) {
    header = {
      format: 'TEXT',
      text: renderTemplateText(fields.header.text, values.header),
    }
  } else if (format && format !== 'TEXT') {
    header = { format, url: headerMediaUrl }
  }

  return (
    <WhatsappBubblePreview
      header={header}
      body={renderTemplateText(fields.body.text, values.body)}
      footer={fields.footer?.text}
      buttons={fields.buttons.map((button) => ({
        type: BUTTON_TYPE[button.type],
        label: button.text ?? '',
      }))}
    />
  )
}
