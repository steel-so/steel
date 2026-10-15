export interface QuickReplyVariableContext {
  contactName?: string | null
  userName?: string | null
  workspaceName?: string | null
}

export const QUICK_REPLY_VARIABLES: Array<{
  token: string
  label: string
  resolve: (ctx: QuickReplyVariableContext) => string
}> = [
  {
    token: 'nome_cliente',
    label: 'Nome do cliente',
    resolve: (ctx) => ctx.contactName?.trim() || 'cliente',
  },
  {
    token: 'nome_usuario',
    label: 'Seu nome',
    resolve: (ctx) => ctx.userName?.trim() || 'atendente',
  },
  {
    token: 'workspace',
    label: 'Nome da empresa',
    resolve: (ctx) => ctx.workspaceName?.trim() || '',
  },
]

const QUICK_REPLY_TOKEN_PATTERN = /\{(\w+)\}/g

export function renderQuickReplyBody(
  body: string,
  context: QuickReplyVariableContext,
): string {
  return body.replace(QUICK_REPLY_TOKEN_PATTERN, (match, token) => {
    const variable = QUICK_REPLY_VARIABLES.find((v) => v.token === token)
    return variable ? variable.resolve(context) : match
  })
}

// ─── Meta template components ──────────────────────────────────────────────

export interface MetaTemplateHeaderComponent {
  type: 'HEADER'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
  text?: string
  // Media header sample: the Resumable Upload handle (on create) or a URL
  // Meta hosts (on read).
  example?: { header_handle: string[] }
}

export interface MetaTemplateBodyComponent {
  type: 'BODY'
  text: string
  // Meta exige um valor de exemplo por variável {{n}} — sem isso a
  // submissão de um novo template é rejeitada com INVALID_FORMAT.
  example?: { body_text: string[][] }
}

export interface MetaTemplateFooterComponent {
  type: 'FOOTER'
  text: string
}

export type MetaTemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }
  | { type: 'COPY_CODE'; text?: string }

export interface MetaTemplateButtonsComponent {
  type: 'BUTTONS'
  buttons: MetaTemplateButton[]
}

export type MetaTemplateComponent =
  | MetaTemplateHeaderComponent
  | MetaTemplateBodyComponent
  | MetaTemplateFooterComponent
  | MetaTemplateButtonsComponent

export function parseMetaTemplateComponents(
  raw: unknown[],
): MetaTemplateComponent[] {
  return raw as MetaTemplateComponent[]
}

const PLACEHOLDER_PATTERN = /\{\{(\d+)\}\}/g

export function countPlaceholders(text: string | undefined): number {
  if (!text) return 0
  const indexes = new Set<number>()
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    indexes.add(Number(match[1]))
  }
  return indexes.size
}

export interface TemplateFillableFields {
  header: {
    format?: MetaTemplateHeaderComponent['format']
    text?: string
    variableCount: number
  }
  body: { text: string; variableCount: number }
  footer?: { text: string }
  buttons: MetaTemplateButton[]
  // indexes into `buttons` that are URL buttons with a `{{1}}` dynamic suffix
  urlButtonVariables: number[]
}

export function extractTemplateFillableFields(
  components: MetaTemplateComponent[],
): TemplateFillableFields {
  const header = components.find(
    (c): c is MetaTemplateHeaderComponent => c.type === 'HEADER',
  )
  const body = components.find(
    (c): c is MetaTemplateBodyComponent => c.type === 'BODY',
  )
  const footer = components.find(
    (c): c is MetaTemplateFooterComponent => c.type === 'FOOTER',
  )
  const buttonsComponent = components.find(
    (c): c is MetaTemplateButtonsComponent => c.type === 'BUTTONS',
  )
  const buttons = buttonsComponent?.buttons ?? []

  const urlButtonVariables = buttons
    .map((button, index) => ({ button, index }))
    .filter(
      ({ button }) =>
        button.type === 'URL' && countPlaceholders(button.url) > 0,
    )
    .map(({ index }) => index)

  return {
    header: {
      format: header?.format,
      text: header?.text,
      variableCount:
        header?.format === 'TEXT' ? countPlaceholders(header.text) : 0,
    },
    body: {
      text: body?.text ?? '',
      variableCount: countPlaceholders(body?.text),
    },
    footer: footer ? { text: footer.text } : undefined,
    buttons,
    urlButtonVariables,
  }
}

export function hasFillableFields(fields: TemplateFillableFields): boolean {
  return (
    fields.header.variableCount > 0 ||
    fields.body.variableCount > 0 ||
    fields.urlButtonVariables.length > 0
  )
}

export function renderTemplateText(
  text: string,
  values: Record<number, string>,
): string {
  return text.replace(
    PLACEHOLDER_PATTERN,
    (match, index) => values[Number(index)] ?? match,
  )
}

interface TemplateFillValues {
  header: Record<number, string>
  body: Record<number, string>
  buttons: Record<number, string>
}

// Builds the `components` payload for a Meta Cloud API `type: "template"` send request.
export function buildMetaSendComponents(
  fields: TemplateFillableFields,
  values: TemplateFillValues,
): unknown[] {
  const components: unknown[] = []

  if (fields.header.variableCount > 0) {
    components.push({
      type: 'header',
      parameters: Array.from(
        { length: fields.header.variableCount },
        (_, i) => ({
          type: 'text',
          text: values.header[i + 1] ?? '',
        }),
      ),
    })
  }

  if (fields.body.variableCount > 0) {
    components.push({
      type: 'body',
      parameters: Array.from({ length: fields.body.variableCount }, (_, i) => ({
        type: 'text',
        text: values.body[i + 1] ?? '',
      })),
    })
  }

  for (const buttonIndex of fields.urlButtonVariables) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(buttonIndex),
      parameters: [{ type: 'text', text: values.buttons[buttonIndex] ?? '' }],
    })
  }

  return components
}
