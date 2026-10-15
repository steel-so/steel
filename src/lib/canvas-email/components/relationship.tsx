import type { CSSProperties } from 'react'
import { Button, Heading, Img, Link, Text } from 'react-email'
import {
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import { spacing } from '@/src/lib/canvas/values'
import { readableTextOn } from '@/src/lib/crm-email-builder/brand'
import { CAMPAIGN_LINK } from '@/src/lib/crm-email-builder/variables'
import { BLOCK_LAYOUT_SECTION, colorField, linkField } from '../inspector'
import { BlockFrame, EditorHint, emailHref, SHOWN } from '../primitives'
import {
  type EmailEventProps,
  type EmailNpsProps,
  type EmailQuoteProps,
  type EmailVideoProps,
  eventSchema,
  npsSchema,
  quoteSchema,
  videoSchema,
} from '../schemas'
import { EMAIL_PALETTE, emailColor, useEmailContext } from '../theme'
import { useEmailBody } from './layout'

/** Readable text on `color` when it is a #RRGGBB; white otherwise. */
function onColor(color: string | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color)
    ? readableTextOn(color)
    : '#FFFFFF'
}

// ─── quote ────────────────────────────────────────────────────────────────

function QuoteView(props: CanvasRenderProps<EmailQuoteProps>) {
  const { node, editing } = props
  const { tokens } = useEmailContext()
  const body = useEmailBody()
  const p = node.props
  if (!p.text.trim() && !editing) return null
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  return (
    <BlockFrame {...props}>
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
      >
        <tbody>
          <tr>
            <td
              style={{
                borderLeft: `4px solid ${accent}`,
                padding: '4px 0 4px 20px',
              }}
            >
              <Text
                style={{
                  margin: 0,
                  fontSize: 18,
                  lineHeight: '28px',
                  fontStyle: 'italic',
                  fontFamily: body.fontStack,
                  color: emailColor(p.color, tokens) ?? EMAIL_PALETTE.fg,
                }}
              >
                {`“${p.text || 'Escreva o depoimento'}”`}
              </Text>
              {p.author ? (
                <Text
                  style={{
                    margin: '12px 0 0',
                    fontSize: 13,
                    lineHeight: '20px',
                    fontFamily: body.fontStack,
                    color: EMAIL_PALETTE.fg3,
                  }}
                >
                  <strong style={{ color: EMAIL_PALETTE.fg2 }}>
                    {p.author}
                  </strong>
                  {p.role ? ` — ${p.role}` : ''}
                </Text>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  )
}

export const quoteDefinition = defineComponent<EmailQuoteProps>({
  type: 'email.quote',
  label: 'Depoimento',
  icon: 'quote',
  category: 'Relacionamento',
  keywords: ['citação', 'cliente', 'prova social', 'review'],
  propsSchema: quoteSchema,
  defaultProps: () => ({
    text: 'Com o novo processo, ganhamos tempo e clareza em todo o time.',
    author: 'Nome do cliente',
    role: 'Cargo, empresa',
    accentColor: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inlineText: { path: 'text', rich: false },
  inspector: [
    {
      id: 'content',
      label: 'Depoimento',
      tab: 'content',
      fields: [
        {
          path: 'text',
          label: 'Texto',
          control: { kind: 'textarea', maxLength: 600, rows: 3 },
        },
        {
          path: 'author',
          label: 'Autor',
          control: { kind: 'text', maxLength: 120 },
        },
        {
          path: 'role',
          label: 'Cargo',
          control: { kind: 'text', maxLength: 120 },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        colorField('accentColor', 'Cor da barra'),
        colorField('color', 'Cor do texto'),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: (props) => <QuoteView {...props} />,
})

// ─── NPS ──────────────────────────────────────────────────────────────────

/** Link of one score: `?nota=<score>` appended before the hash. */
export function npsHref(url: string | undefined, score: number): string {
  if (!url) return ''
  const hash = url.indexOf('#')
  const base = hash === -1 ? url : url.slice(0, hash)
  const tail = hash === -1 ? '' : url.slice(hash)
  return `${base}${base.includes('?') ? '&' : '?'}nota=${score}${tail}`
}

function NpsView(props: CanvasRenderProps<EmailNpsProps>) {
  const { node } = props
  const { tokens } = useEmailContext()
  const body = useEmailBody()
  const p = node.props
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  const url = emailHref(p.link)
  const small: CSSProperties = {
    margin: '8px 0 0',
    fontSize: 13,
    lineHeight: '20px',
    fontFamily: body.fontStack,
    color: EMAIL_PALETTE.fg3,
  }
  return (
    <BlockFrame {...props}>
      {p.question ? (
        <Text
          style={{
            margin: '0 0 16px',
            fontSize: 17,
            fontWeight: 600,
            lineHeight: '26px',
            fontFamily: body.fontStack,
            color: EMAIL_PALETTE.fg,
          }}
        >
          {p.question}
        </Text>
      ) : null}
      {url ? (
        // Plain-text readers get one link instead of eleven score links.
        <div style={{ display: 'none', maxHeight: 0, overflow: 'hidden' }}>
          {`Responda com uma nota de 0 a 10: ${url}`}
        </div>
      ) : null}
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ tableLayout: 'fixed' }}
        data-skip-in-text='true'
      >
        <tbody>
          <tr>
            {Array.from({ length: 11 }, (_, score) => (
              <td key={score} align='center' style={{ padding: 2 }}>
                <Link
                  href={npsHref(url, score)}
                  style={{
                    display: 'block',
                    padding: '8px 0',
                    borderRadius: 6,
                    border: `1px solid ${EMAIL_PALETTE.stroke}`,
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: body.fontStack,
                    color: accent,
                    textDecoration: 'none',
                    textAlign: 'center',
                  }}
                >
                  {score}
                </Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
      >
        <tbody>
          <tr>
            <td>
              <Text style={{ ...small, textAlign: 'left' }}>{p.lowLabel}</Text>
            </td>
            <td>
              <Text style={{ ...small, textAlign: 'right' }}>
                {p.highLabel}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  )
}

export const npsDefinition = defineComponent<EmailNpsProps>({
  type: 'email.nps',
  label: 'Pesquisa NPS',
  icon: 'nps',
  category: 'Relacionamento',
  keywords: ['nota', 'satisfação', 'pesquisa', 'avaliação'],
  propsSchema: npsSchema,
  defaultProps: () => ({
    question: 'De 0 a 10, quanto você nos recomendaria a um amigo?',
    lowLabel: 'Pouco provável',
    highLabel: 'Muito provável',
    link: { type: 'url', value: CAMPAIGN_LINK },
    accentColor: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Pesquisa',
      tab: 'content',
      fields: [
        {
          path: 'question',
          label: 'Pergunta',
          control: { kind: 'text', maxLength: 200 },
        },
        {
          path: 'lowLabel',
          label: 'Legenda da nota 0',
          control: { kind: 'text', maxLength: 60 },
        },
        {
          path: 'highLabel',
          label: 'Legenda da nota 10',
          control: { kind: 'text', maxLength: 60 },
        },
        {
          ...linkField('link', 'Página de resposta'),
          help: 'Cada nota abre este link com ?nota=0 a 10.',
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [colorField('accentColor', 'Cor das notas')],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: (props) => <NpsView {...props} />,
})

// ─── event ────────────────────────────────────────────────────────────────

function EventView(props: CanvasRenderProps<EmailEventProps>) {
  const { node } = props
  const { tokens } = useEmailContext()
  const body = useEmailBody()
  const p = node.props
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  const rows = (
    [
      ['Data', p.date],
      ['Horário', p.time],
      ['Local', p.location],
    ] as const
  ).filter(([, value]) => value.trim())
  const href = emailHref(p.link)
  return (
    <BlockFrame {...props}>
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{
          backgroundColor: emailColor(p.backgroundColor, tokens),
          borderRadius: 12,
          borderCollapse: 'separate',
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: '20px 24px' }}>
              {p.heading ? (
                <Heading
                  as='h2'
                  style={{
                    margin: '0 0 12px',
                    fontSize: 18,
                    lineHeight: '28px',
                    fontWeight: 700,
                    fontFamily: body.fontStack,
                    color: EMAIL_PALETTE.fg,
                  }}
                >
                  {p.heading}
                </Heading>
              ) : null}
              {rows.map(([label, value]) => (
                <table
                  key={label}
                  role='presentation'
                  width='100%'
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                >
                  <tbody>
                    <tr>
                      <td width={88} valign='top' style={{ width: 88 }}>
                        <Text
                          style={{
                            margin: '4px 0',
                            fontSize: 14,
                            fontFamily: body.fontStack,
                            color: EMAIL_PALETTE.fg3,
                          }}
                        >
                          {label}
                        </Text>
                      </td>
                      <td valign='top'>
                        <Text
                          style={{
                            margin: '4px 0',
                            fontSize: 14,
                            fontWeight: 600,
                            fontFamily: body.fontStack,
                            color: EMAIL_PALETTE.fg,
                          }}
                        >
                          {value}
                        </Text>
                      </td>
                    </tr>
                  </tbody>
                </table>
              ))}
              {p.buttonLabel && href ? (
                <div style={{ padding: '12px 0 0' }}>
                  <Button
                    href={href}
                    style={{
                      backgroundColor: accent,
                      color: onColor(accent),
                      borderRadius: 8,
                      padding: '12px 24px',
                      fontSize: 15,
                      fontWeight: 600,
                      fontFamily: body.fontStack,
                      textDecoration: 'none',
                    }}
                  >
                    {p.buttonLabel}
                  </Button>
                </div>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  )
}

export const eventDefinition = defineComponent<EmailEventProps>({
  type: 'email.event',
  label: 'Evento',
  icon: 'event',
  category: 'Relacionamento',
  keywords: ['convite', 'data', 'webinar', 'agenda', 'encontro'],
  propsSchema: eventSchema,
  defaultProps: () => ({
    heading: 'Encontro de clientes',
    date: '25 de novembro',
    time: '19h',
    location: 'Online',
    buttonLabel: 'Confirmar presença',
    link: { type: 'url', value: CAMPAIGN_LINK },
    backgroundColor: 'token:primary-soft',
    accentColor: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Evento',
      tab: 'content',
      fields: [
        {
          path: 'heading',
          label: 'Nome',
          control: { kind: 'text', maxLength: 200 },
        },
        {
          path: 'date',
          label: 'Data',
          control: { kind: 'text', maxLength: 80 },
        },
        {
          path: 'time',
          label: 'Horário',
          control: { kind: 'text', maxLength: 80 },
        },
        {
          path: 'location',
          label: 'Local',
          control: { kind: 'text', maxLength: 200 },
        },
        {
          path: 'buttonLabel',
          label: 'Texto do botão',
          control: { kind: 'text', maxLength: 60 },
        },
        linkField(),
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        colorField('backgroundColor', 'Fundo'),
        colorField('accentColor', 'Cor do botão'),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: (props) => <EventView {...props} />,
})

// ─── video ────────────────────────────────────────────────────────────────

/**
 * E-mail clients do not play video: the block is the thumbnail linked to
 * the video page plus a play label under it.
 */
function VideoView(props: CanvasRenderProps<EmailVideoProps>) {
  const { node, editing } = props
  const { tokens } = useEmailContext()
  const body = useEmailBody()
  const p = node.props
  const href = emailHref(p.link)
  const src = p.thumbnail.src.trim()
  if (!src && !editing) return null
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  return (
    <BlockFrame {...props} align='center'>
      {src ? (
        <Link href={href}>
          <Img
            src={src}
            alt={p.thumbnail.alt || p.label}
            width={body.width}
            style={{
              display: 'block',
              width: '100%',
              maxWidth: '100%',
              height: 'auto',
              border: 0,
              borderRadius: p.radius || undefined,
            }}
          />
        </Link>
      ) : (
        <EditorHint
          editing={editing}
          label='Escolha a imagem de capa do vídeo'
          minHeight={160}
        />
      )}
      {p.label ? (
        <Text
          style={{
            margin: '12px 0 0',
            fontSize: 15,
            lineHeight: '22px',
            fontWeight: 600,
            fontFamily: body.fontStack,
            textAlign: 'center',
          }}
        >
          <Link href={href} style={{ color: accent, textDecoration: 'none' }}>
            {`▶ ${p.label}`}
          </Link>
        </Text>
      ) : null}
    </BlockFrame>
  )
}

export const videoDefinition = defineComponent<EmailVideoProps>({
  type: 'email.video',
  label: 'Vídeo',
  icon: 'video',
  category: 'Relacionamento',
  keywords: ['youtube', 'vimeo', 'assistir', 'play'],
  propsSchema: videoSchema,
  defaultProps: () => ({
    thumbnail: { src: '', alt: '' },
    link: { type: 'url', value: 'https://' },
    label: 'Assistir ao vídeo',
    accentColor: 'token:primary',
    radius: 12,
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Vídeo',
      tab: 'content',
      fields: [
        {
          path: 'thumbnail',
          label: 'Imagem de capa',
          control: { kind: 'image' },
          help: 'Leitores de e-mail não tocam vídeo: a capa leva para a página do vídeo.',
        },
        linkField('link', 'Link do vídeo'),
        {
          path: 'label',
          label: 'Texto do link',
          control: { kind: 'text', maxLength: 80 },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        colorField('accentColor', 'Cor do link'),
        {
          path: 'radius',
          label: 'Cantos',
          control: { kind: 'number', min: 0, max: 40, unit: 'px' },
        },
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: (props) => <VideoView {...props} />,
})
