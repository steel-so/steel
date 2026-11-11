import {
  Attachment01Icon,
  BarCode01Icon,
  Calendar03Icon,
  Clock01Icon,
  Download01Icon,
  QrCodeIcon,
  Wallet01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import {
  type CanvasComponentDefinition,
  defineComponent,
  type InspectorField,
} from '@/src/lib/canvas/registry'
import { IconSvg } from '@/src/lib/canvas-site/icons'
import { safeHref } from '@/src/lib/canvas-site/sanitize'
import {
  DOCUMENT_FIELD_TYPES,
  DOCUMENT_VARIABLES,
  type DocumentFieldType,
} from '../constants'
import type { DocumentPricingItem } from '../context'
import { LinesControl, PricingItemsControl } from '../controls'
import { formatDocumentDate } from '../format'
import { section, textField, toggleField, VARIABLES_HELP } from '../inspector'
import {
  type DocumentAcceptProps,
  type DocumentAttachmentsProps,
  type DocumentFieldSchemaProps,
  type DocumentMeetingProps,
  type DocumentPaymentProps,
  type DocumentPricingTableProps,
  type DocumentValidityProps,
  documentAcceptSchema,
  documentAttachmentsSchema,
  documentFieldSchema,
  documentMeetingSchema,
  documentPaymentSchema,
  documentPricingTableSchema,
  documentValiditySchema,
} from '../schemas'
import {
  actionLabel,
  LiveAccept,
  LiveField,
  LivePayment,
  LivePricing,
  LiveValidity,
  StatusBox,
} from './live'
import {
  type DocCtx,
  Placeholder,
  renderVars,
  trackProps,
  varsText,
} from './shared'
import { FieldPreview, FieldPrinted, PricingTableView } from './views'

/**
 * Functional elements: accept, pricing table, payment, attachments,
 * validity, meeting and the form fields. Each renders a visual preview in
 * the editor, a static version in print (with the recipient's answers when
 * given) and, on the public link, a live element that reads and writes the
 * runtime.
 */

export const DEFAULT_AGREE_LABEL =
  'Li e concordo com os termos e condições deste documento.'

const FIELD_LABELS: Record<DocumentFieldType, string> = {
  'field-text': 'Texto curto',
  'field-textarea': 'Texto longo',
  'field-email': 'E-mail',
  'field-phone': 'Telefone',
  'field-number': 'Número',
  'field-date': 'Data',
  'field-select': 'Seleção',
  'field-checkbox': 'Caixa de confirmação',
  'field-cpf': 'CPF',
  'field-cnpj': 'CNPJ',
}

const FIELD_ICONS: Record<DocumentFieldType, string> = {
  'field-text': 'field-text',
  'field-textarea': 'field-textarea',
  'field-email': 'field-email',
  'field-phone': 'field-phone',
  'field-number': 'field-number',
  'field-date': 'field-date',
  'field-select': 'field-select',
  'field-checkbox': 'field-checkbox',
  'field-cpf': 'field-id',
  'field-cnpj': 'field-company',
}

const FIELD_DEFAULT_LABELS: Record<DocumentFieldType, string> = {
  'field-text': 'Nome completo',
  'field-textarea': 'Observações',
  'field-email': 'E-mail',
  'field-phone': 'Telefone',
  'field-number': 'Quantidade',
  'field-date': 'Data de início',
  'field-select': 'Escolha uma opção',
  'field-checkbox': 'Autorizo o contato por e-mail e WhatsApp.',
  'field-cpf': 'CPF',
  'field-cnpj': 'CNPJ',
}

const CRM_FIELD_OPTIONS = [
  { value: '', label: 'Não salvar no CRM' },
  { value: 'person.name', label: 'Pessoa: nome' },
  { value: 'person.email', label: 'Pessoa: e-mail' },
  { value: 'person.phone', label: 'Pessoa: telefone' },
  { value: 'person.cpf', label: 'Pessoa: CPF' },
  { value: 'company.name', label: 'Empresa: nome' },
  { value: 'company.cnpj', label: 'Empresa: CNPJ' },
  { value: 'company.phone', label: 'Empresa: telefone' },
]

const SAMPLE_VALIDITY = DOCUMENT_VARIABLES.find(
  (variable) => variable.key === 'documento.validade',
)?.sample

function fieldInspector(type: DocumentFieldType): InspectorField[] {
  const labelText =
    type === 'field-checkbox' ? 'Texto da confirmação' : 'Rótulo'
  const fields: InspectorField[] = [
    textField('label', labelText, { rows: 2, maxLength: 500 }),
    toggleField('required', 'Obrigatório'),
  ]
  if (type !== 'field-checkbox') {
    fields.push(
      textField('placeholder', 'Texto de exemplo', { maxLength: 500 }),
    )
  }
  if (type === 'field-select') {
    fields.push(
      {
        path: 'options',
        label: 'Opções',
        help: 'Uma opção por linha.',
        control: { kind: 'custom', component: LinesControl },
      },
      toggleField('multiple', 'Permitir mais de uma'),
    )
  }
  fields.push(
    textField('helpText', 'Ajuda abaixo do campo', { maxLength: 500 }),
    {
      path: 'crmField',
      label: 'Salvar no CRM',
      help: 'Ao aceitar, a resposta atualiza o contato ou a empresa vinculada.',
      control: { kind: 'select', options: CRM_FIELD_OPTIONS },
    },
  )
  return fields
}

function defaultFieldProps(type: DocumentFieldType): DocumentFieldSchemaProps {
  const label = FIELD_DEFAULT_LABELS[type]
  if (type !== 'field-select') return { label }
  return { label, options: ['Opção 1', 'Opção 2', 'Opção 3'] }
}

function fieldDefinition(type: DocumentFieldType, ctx: DocCtx) {
  return defineComponent<DocumentFieldSchemaProps>({
    type,
    label: FIELD_LABELS[type],
    icon: FIELD_ICONS[type],
    category: 'Campos',
    keywords: ['campo', 'formulário', 'formulario', FIELD_LABELS[type]],
    propsSchema: documentFieldSchema,
    defaultProps: () => defaultFieldProps(type),
    accepts: false,
    inlineText: { path: 'label', rich: false },
    inspector: [section('field', FIELD_LABELS[type], fieldInspector(type))],
    render: ({ node, attributes }) => {
      const props = node.props
      const label = renderVars(props.label, ctx)
      if (ctx.mode === 'public') {
        return (
          <LiveField id={node.id} type={type} props={props} label={label} />
        )
      }
      if (ctx.mode === 'print') {
        return (
          <FieldPrinted
            id={node.id}
            type={type}
            props={props}
            label={label}
            value={ctx.fieldValues?.[node.id]}
          />
        )
      }
      return (
        <FieldPreview
          id={node.id}
          type={type}
          props={props}
          label={label}
          attributes={attributes}
        />
      )
    },
  })
}

/** Items with their texts' merge tags resolved. */
function resolvedItems(
  items: DocumentPricingItem[],
  ctx: DocCtx,
): DocumentPricingItem[] {
  return items.map((item) => ({
    ...item,
    name: varsText(item.name, ctx) || 'Item',
    description: item.description ? varsText(item.description, ctx) : undefined,
  }))
}

export function functionalDefinitions(
  ctx: DocCtx,
): CanvasComponentDefinition[] {
  const editing = ctx.mode === 'editor'
  const agreeLabel = ctx.settings.acceptTerms?.trim() || DEFAULT_AGREE_LABEL

  const accept = defineComponent<DocumentAcceptProps>({
    type: 'accept',
    label: 'Aceite',
    icon: 'accept',
    category: 'Vendas',
    keywords: ['aceite', 'aceitar', 'aprovar', 'concordo', 'fechar'],
    propsSchema: documentAcceptSchema,
    defaultProps: () => ({
      title: 'Aceite da proposta',
      buttonLabel: 'Aceitar proposta',
      allowDecline: true,
    }),
    accepts: false,
    unique: true,
    inspector: [
      section('accept', 'Aceite', [
        {
          path: 'action',
          label: 'Ação',
          help: 'Enviar respostas só envia os campos, sem aceitar o documento.',
          control: {
            kind: 'segmented',
            options: [
              { value: 'accept', label: 'Aceitar' },
              { value: 'submit', label: 'Enviar respostas' },
            ],
          },
        },
        textField('title', 'Título', { maxLength: 500 }),
        textField('terms', 'Texto acima do formulário', {
          rows: 4,
          maxLength: 2000,
          help: VARIABLES_HELP,
        }),
        textField('buttonLabel', 'Texto do botão', { maxLength: 500 }),
        toggleField('askEmail', 'Pedir e-mail', 'Ligado por padrão.'),
        toggleField('allowDecline', 'Permitir recusar'),
        textField('declineLabel', 'Texto do botão de recusa', {
          maxLength: 500,
        }),
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const submitOnly = p.action === 'submit'
      const fallback = submitOnly ? 'Enviar respostas' : 'Aceite do documento'
      const title = renderVars(p.title || fallback, ctx)
      const terms = renderVars(p.terms, ctx)
      if (ctx.mode === 'public') {
        return (
          <LiveAccept
            props={p}
            title={title}
            terms={terms}
            agreeLabel={agreeLabel}
            timeZone={ctx.timeZone}
          />
        )
      }
      if (ctx.mode === 'print' && ctx.acceptedByName && !submitOnly) {
        const when = formatDocumentDate(ctx.acceptedAt, {
          timeZone: ctx.timeZone,
          withTime: true,
        })
        const text = when
          ? `Aceito por ${ctx.acceptedByName} em ${when}.`
          : `Aceito por ${ctx.acceptedByName}.`
        return <StatusBox tone='accepted'>{text}</StatusBox>
      }
      if (ctx.mode === 'print') {
        const printNote = submitOnly
          ? 'As respostas são enviadas pelo link do documento.'
          : 'O aceite é feito eletronicamente pelo link do documento e fica registrado com nome, e-mail, data e versão.'
        return (
          <div className='d-card'>
            <h3 className='d-card-title'>{title}</h3>
            {terms ? <p className='d-card-text'>{terms}</p> : null}
            <p className='d-note'>{printNote}</p>
          </div>
        )
      }
      return (
        <div {...attributes} className='d-card'>
          <h3 className='d-card-title'>{title}</h3>
          {terms ? <p className='d-card-text'>{terms}</p> : null}
          {submitOnly ? null : (
            <div className='d-grid'>
              <div className='d-field'>
                <span className='d-label'>
                  Nome completo<span className='d-req'>*</span>
                </span>
                <span className='d-input d-input--fake'>Seu nome completo</span>
              </div>
              {p.askEmail === false ? null : (
                <div className='d-field'>
                  <span className='d-label'>E-mail</span>
                  <span className='d-input d-input--fake'>
                    voce@empresa.com.br
                  </span>
                </div>
              )}
            </div>
          )}
          {submitOnly ? null : (
            <span className='d-check'>
              <span className='d-check-box' />
              <span>{agreeLabel}</span>
            </span>
          )}
          <div className='d-actions'>
            <span className='d-btn d-btn--primary'>{actionLabel(p)}</span>
            {p.allowDecline && !submitOnly ? (
              <span className='d-btn d-btn--ghost'>
                {p.declineLabel || 'Recusar'}
              </span>
            ) : null}
          </div>
          <p className='d-note'>
            O aceite registra nome, e-mail, data e a versão do documento.
          </p>
        </div>
      )
    },
  })

  const pricing = defineComponent<DocumentPricingTableProps>({
    type: 'pricing-table',
    label: 'Tabela de preços',
    icon: 'pricing',
    category: 'Vendas',
    keywords: ['preços', 'precos', 'investimento', 'orçamento', 'itens'],
    propsSchema: documentPricingTableSchema,
    defaultProps: () => ({
      title: 'Investimento',
      showTotals: true,
      showDescriptions: true,
      items: [
        {
          id: 'item-1',
          name: 'Implantação',
          description: 'Configuração, migração de dados e treinamento.',
          unitPrice: 4800,
          quantity: 1,
          unit: 'projeto',
        },
        {
          id: 'item-2',
          name: 'Licença mensal',
          description: 'Por usuário, com suporte incluído.',
          unitPrice: 89,
          quantity: 10,
          unit: 'usuários',
          recurrence: 'monthly',
          quantityEditable: true,
        },
        {
          id: 'item-3',
          name: 'Treinamento avançado',
          unitPrice: 1200,
          quantity: 1,
          optional: true,
        },
      ],
    }),
    accepts: false,
    inspector: [
      section('pricing', 'Tabela de preços', [
        textField('title', 'Título', { maxLength: 500 }),
        {
          path: 'items',
          label: 'Itens',
          control: { kind: 'custom', component: PricingItemsControl },
        },
        toggleField('showTotals', 'Mostrar totais'),
        toggleField('showDescriptions', 'Mostrar descrições'),
        textField('note', 'Observação abaixo da tabela', {
          rows: 3,
          maxLength: 5000,
        }),
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const items = resolvedItems(p.items, ctx)
      const title = p.title ? renderVars(p.title, ctx) : undefined
      const note = p.note ? renderVars(p.note, ctx) : undefined
      const showTotals = p.showTotals !== false
      const showDescriptions = p.showDescriptions !== false
      if (items.length === 0) {
        return editing ? (
          <Placeholder
            attributes={attributes}
            icon={Wallet01Icon}
            title='Tabela de preços'
            hint='Adicione os itens no painel ao lado.'
          />
        ) : null
      }
      if (ctx.mode === 'public') {
        return (
          <LivePricing
            title={title}
            items={items}
            showTotals={showTotals}
            showDescriptions={showDescriptions}
            note={note}
          />
        )
      }
      return (
        <PricingTableView
          attributes={attributes}
          title={title}
          items={items}
          selection={ctx.mode === 'print' ? ctx.selection : undefined}
          showTotals={showTotals}
          showDescriptions={showDescriptions}
          note={note}
        />
      )
    },
  })

  const payment = defineComponent<DocumentPaymentProps>({
    type: 'payment',
    label: 'Pagamento',
    icon: 'payment',
    category: 'Vendas',
    keywords: ['pagamento', 'pix', 'boleto', 'pagar', 'cobrança'],
    propsSchema: documentPaymentSchema,
    defaultProps: () => ({
      title: 'Pagamento',
      description: 'Pague com segurança direto por aqui.',
      pix: true,
      boleto: true,
    }),
    accepts: false,
    unique: true,
    dependsOn: (doc) => {
      ctx.remember(doc)
      return [doc]
    },
    inspector: [
      section('payment', 'Pagamento', [
        textField('title', 'Título', { maxLength: 500 }),
        textField('description', 'Descrição', { rows: 2, maxLength: 2000 }),
        toggleField('pix', 'Pix'),
        toggleField('boleto', 'Boleto'),
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const title = renderVars(p.title || 'Pagamento', ctx)
      const description = renderVars(p.description, ctx)
      if (!ctx.paymentEnabled) {
        return editing ? (
          <Placeholder
            attributes={attributes}
            icon={Wallet01Icon}
            title='Pagamento por Pix ou boleto'
            hint='Aparece no link quando o Pix estiver ativo no workspace.'
          />
        ) : null
      }
      if (ctx.mode === 'public') {
        return (
          <LivePayment
            doc={ctx.getDocument()}
            title={title}
            description={description}
            pix={p.pix !== false}
            boleto={p.boleto !== false}
          />
        )
      }
      return (
        <div {...attributes} className='d-card'>
          <h3 className='d-card-title'>{title}</h3>
          {description ? <p className='d-card-text'>{description}</p> : null}
          <div className='d-actions'>
            {p.pix === false ? null : (
              <span className='d-btn d-btn--primary'>
                <IconSvg icon={QrCodeIcon} />
                Pagar com Pix
              </span>
            )}
            {p.boleto === false ? null : (
              <span className='d-btn d-btn--outline'>
                <IconSvg icon={BarCode01Icon} />
                Gerar boleto
              </span>
            )}
          </div>
          {ctx.mode === 'print' ? (
            <p className='d-note'>
              O pagamento é feito pelo link do documento.
            </p>
          ) : null}
        </div>
      )
    },
  })

  const attachments = defineComponent<DocumentAttachmentsProps>({
    type: 'attachments',
    label: 'Anexos',
    icon: 'attachments',
    category: 'Vendas',
    keywords: ['anexos', 'arquivos', 'download', 'pdf', 'documentos'],
    propsSchema: documentAttachmentsSchema,
    defaultProps: () => ({ title: 'Anexos', files: [] }),
    accepts: false,
    inspector: [
      section('attachments', 'Anexos', [
        textField('title', 'Título', { maxLength: 500 }),
        {
          path: 'files',
          label: 'Arquivos',
          control: {
            kind: 'list',
            itemLabel: 'Arquivo',
            max: 20,
            fields: [
              textField('name', 'Nome do arquivo', { maxLength: 500 }),
              {
                path: 'url',
                label: 'Link do arquivo',
                help: 'Envie o arquivo para a biblioteca de mídia e cole o link.',
                control: { kind: 'text', maxLength: 2000 },
              },
              textField('size', 'Tamanho (ex.: 2,4 MB)', { maxLength: 40 }),
            ],
          },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const files = p.files.filter((file) => safeHref(file.url))
      if (files.length === 0) {
        return editing ? (
          <Placeholder
            attributes={attributes}
            icon={Attachment01Icon}
            title={p.title || 'Anexos'}
            hint='Adicione os arquivos no painel ao lado.'
          />
        ) : null
      }
      return (
        <div {...attributes} className='d-pricing'>
          {p.title ? (
            <h3 className='d-pricing-title'>{renderVars(p.title, ctx)}</h3>
          ) : null}
          <ul className='d-files'>
            {files.map((file, index) => {
              const name = varsText(file.name, ctx) || `Arquivo ${index + 1}`
              return (
                <li key={index}>
                  <a
                    className='d-file'
                    href={safeHref(file.url)}
                    target='_blank'
                    rel='noopener noreferrer'
                    {...trackProps(ctx, 'attachment')}
                  >
                    <span className='d-badge-icon'>
                      <IconSvg icon={Attachment01Icon} />
                    </span>
                    <span className='d-file-name'>{name}</span>
                    {file.size ? (
                      <span className='d-file-meta'>{file.size}</span>
                    ) : null}
                    <span className='d-badge-icon'>
                      <IconSvg icon={Download01Icon} />
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )
    },
  })

  const validity = defineComponent<DocumentValidityProps>({
    type: 'validity',
    label: 'Validade',
    icon: 'validity',
    category: 'Vendas',
    keywords: ['validade', 'prazo', 'vencimento', 'expira', 'contagem'],
    propsSchema: documentValiditySchema,
    defaultProps: () => ({ showCountdown: true, style: 'badge' }),
    accepts: false,
    inspector: [
      section('validity', 'Validade', [
        textField('label', 'Texto', {
          maxLength: 500,
          help: 'A data vem da validade do documento (Enviar → Validade).',
        }),
        toggleField('showCountdown', 'Mostrar quanto tempo falta'),
        {
          path: 'style',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'badge', label: 'Selo' },
              { value: 'banner', label: 'Faixa' },
            ],
          },
        },
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const label = varsText(p.label, ctx) || 'Proposta válida até'
      const className = `d-validity d-validity--${p.style ?? 'badge'}`
      const showCountdown = p.showCountdown !== false
      if (editing) {
        const day = ctx.validUntil
          ? formatDocumentDate(ctx.validUntil, { timeZone: ctx.timeZone })
          : SAMPLE_VALIDITY
        return (
          <div {...attributes} className={className}>
            <IconSvg icon={Clock01Icon} />
            <span>
              {label} {day}
            </span>
            {showCountdown ? (
              <span className='d-validity-count'>· faltam 19 dias</span>
            ) : null}
          </div>
        )
      }
      if (!ctx.validUntil) return null
      if (ctx.mode === 'public') {
        return (
          <LiveValidity
            validUntil={ctx.validUntil}
            label={label}
            showCountdown={showCountdown}
            className={className}
            timeZone={ctx.timeZone}
          />
        )
      }
      const day = formatDocumentDate(ctx.validUntil, { timeZone: ctx.timeZone })
      return (
        <div className={className}>
          <IconSvg icon={Clock01Icon} />
          <span>
            {label} {day}
          </span>
        </div>
      )
    },
  })

  const meeting = defineComponent<DocumentMeetingProps>({
    type: 'meeting',
    label: 'Agendar reunião',
    icon: 'meeting',
    category: 'Vendas',
    keywords: ['reunião', 'reuniao', 'agenda', 'agendar', 'conversa'],
    propsSchema: documentMeetingSchema,
    defaultProps: () => ({
      title: 'Vamos conversar?',
      description: 'Escolha o melhor horário para tirarmos suas dúvidas.',
      buttonLabel: 'Agendar reunião',
      duration: '30 min',
    }),
    accepts: false,
    inspector: [
      section('meeting', 'Reunião', [
        textField('title', 'Título', { maxLength: 500 }),
        textField('description', 'Descrição', { rows: 2, maxLength: 2000 }),
        {
          path: 'url',
          label: 'Link de agendamento',
          help: 'Google Agenda, Calendly, Microsoft Bookings ou outro.',
          control: { kind: 'text', placeholder: 'https://…', maxLength: 2000 },
        },
        textField('buttonLabel', 'Texto do botão', { maxLength: 500 }),
        textField('duration', 'Duração', { maxLength: 60 }),
      ]),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      const href = safeHref(varsText(p.url, ctx).trim())
      const label = renderVars(p.buttonLabel || 'Agendar reunião', ctx)
      let action: ReactNode = null
      if (href) {
        action = (
          <a
            className='d-btn d-btn--primary'
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            {...trackProps(ctx, 'link')}
          >
            {label}
          </a>
        )
      } else if (editing) {
        action = <span className='d-note'>Cole o link de agendamento.</span>
      }
      return (
        <div {...attributes} className='d-band'>
          <span className='d-badge-icon d-badge-icon--lg'>
            <IconSvg icon={Calendar03Icon} />
          </span>
          <div className='d-band-body'>
            <p className='d-band-title'>
              {renderVars(p.title || 'Vamos conversar?', ctx)}
              {p.duration ? (
                <span className='d-tag'>{renderVars(p.duration, ctx)}</span>
              ) : null}
            </p>
            {p.description ? (
              <p className='d-band-text'>{renderVars(p.description, ctx)}</p>
            ) : null}
          </div>
          {action}
        </div>
      )
    },
  })

  return [
    accept,
    pricing,
    payment,
    attachments,
    validity,
    meeting,
    ...DOCUMENT_FIELD_TYPES.map((type) => fieldDefinition(type, ctx)),
  ]
}
