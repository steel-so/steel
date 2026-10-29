import { Link, Text } from 'react-email'
import { z } from 'zod'
import { defineComponent } from '@/src/lib/canvas/registry'
import { canvasColorSchema, spacing } from '@/src/lib/canvas/values'
import { readableTextOn } from '@/src/lib/crm-email-builder/brand'
import {
  POLL_BLOCK,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  pollMarkerHref,
} from '@/src/lib/newsletter/poll-links'
import { BLOCK_LAYOUT_SECTION, colorField } from '../inspector'
import { BlockFrame, SHOWN } from '../primitives'
import { blockBase } from '../schemas'
import { EMAIL_PALETTE, type EmailViewProps, emailColor } from '../theme'
import { emailBody, emailView } from './layout'

/**
 * "Enquete" (slice nl2-engage): a question and 2–5 options rendered as
 * stacked buttons. Each option links to a placeholder that the newsletter
 * send turns into the recipient's signed vote link
 * (`src/lib/newsletter/poll-links.ts`); everywhere else the options are
 * static. Only offered in the newsletter issue editor (`allowPoll`).
 */

export const pollSchema = z.object({
  ...blockBase,
  question: z
    .string()
    .trim()
    .min(1, 'Escreva a pergunta da enquete')
    .max(200, 'Máximo de 200 caracteres'),
  options: z
    .array(
      z.object({
        label: z
          .string()
          .trim()
          .min(1, 'Preencha o texto de cada opção')
          .max(80, 'Máximo de 80 caracteres'),
      }),
    )
    .min(POLL_MIN_OPTIONS, `A enquete precisa de ${POLL_MIN_OPTIONS} opções`)
    .max(POLL_MAX_OPTIONS, `No máximo ${POLL_MAX_OPTIONS} opções`),
  /** Thank-you page shows the current results to who voted. */
  showResults: z.boolean(),
  accentColor: canvasColorSchema,
})
export type EmailPollProps = z.infer<typeof pollSchema>

function PollView(props: EmailViewProps<EmailPollProps>) {
  const { node } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  const onAccent = /^#[0-9a-fA-F]{6}$/.test(accent)
    ? readableTextOn(accent)
    : '#FFFFFF'
  return (
    <BlockFrame {...props}>
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
        {p.question || 'Escreva a pergunta da enquete'}
      </Text>
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
      >
        <tbody>
          {p.options.map((option, index) => (
            <tr key={index}>
              <td style={{ padding: '0 0 8px' }}>
                <Link
                  href={pollMarkerHref(node.id, index)}
                  style={{
                    display: 'block',
                    padding: '12px 16px',
                    borderRadius: 8,
                    backgroundColor: index === 0 ? accent : undefined,
                    border: `1px solid ${index === 0 ? accent : EMAIL_PALETTE.stroke}`,
                    fontSize: 15,
                    fontWeight: 600,
                    lineHeight: '22px',
                    fontFamily: body.fontStack,
                    color: index === 0 ? onAccent : accent,
                    textDecoration: 'none',
                    textAlign: 'center',
                  }}
                >
                  {option.label || `Opção ${index + 1}`}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Text
        style={{
          margin: '4px 0 0',
          fontSize: 13,
          lineHeight: '20px',
          fontFamily: body.fontStack,
          color: EMAIL_PALETTE.fg3,
          textAlign: 'center',
        }}
      >
        Um clique registra o seu voto.
      </Text>
    </BlockFrame>
  )
}

export const pollDefinition = defineComponent<EmailPollProps>({
  type: POLL_BLOCK,
  label: 'Enquete',
  icon: 'poll',
  category: 'Relacionamento',
  keywords: ['votação', 'pergunta', 'opinião', 'pesquisa', 'enquete'],
  propsSchema: pollSchema,
  defaultProps: () => ({
    question: 'Qual assunto você quer ver na próxima edição?',
    options: [
      { label: 'Novidades do produto' },
      { label: 'Dicas e boas práticas' },
      { label: 'Histórias de clientes' },
    ],
    showResults: true,
    accentColor: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Enquete',
      tab: 'content',
      fields: [
        {
          path: 'question',
          label: 'Pergunta',
          control: { kind: 'text', maxLength: 200 },
        },
        {
          path: 'options',
          label: 'Opções',
          help: `De ${POLL_MIN_OPTIONS} a ${POLL_MAX_OPTIONS} opções. Cada assinante vota uma vez; votar de novo troca o voto.`,
          control: {
            kind: 'list',
            itemLabel: 'Opção',
            max: POLL_MAX_OPTIONS,
            fields: [
              {
                path: 'label',
                label: 'Texto',
                control: { kind: 'text', maxLength: 80 },
              },
            ],
          },
        },
        {
          path: 'showResults',
          label: 'Mostrar o resultado parcial depois do voto',
          control: { kind: 'toggle' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [colorField('accentColor', 'Cor das opções')],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(PollView),
})
