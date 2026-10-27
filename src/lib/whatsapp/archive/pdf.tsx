import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import {
  type ExportableWhatsAppMessage,
  senderLabel,
  TYPE_PLACEHOLDER,
} from '@/src/lib/whatsapp/conversation-export'
import { formatWaId } from '@/src/lib/whatsapp/phone'
import {
  ARCHIVE_TIME_ZONE,
  archiveClock,
  formatDayKey,
  mediaFileName,
  toPdfSafeText,
} from './layout'

/**
 * PDF of one atendimento (one conversation, one São Paulo day) for the bank
 * archive (ADR 0052). Same engine as the SLA report
 * (`src/lib/servicedesk/report-pdf.tsx`): `@react-pdf/renderer` with the
 * built-in Helvetica, no network, so it renders the same in the worker.
 * Text goes through `toPdfSafeText` (the font is Windows-1252 only).
 */

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#18181b',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#2893cc',
    paddingBottom: 8,
    marginBottom: 12,
  },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  metaRow: { flexDirection: 'row', marginTop: 3 },
  metaLabel: { width: 90, color: '#52525b' },
  metaValue: { flex: 1 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f5',
    paddingVertical: 4,
  },
  headRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#a1a1aa',
    paddingBottom: 3,
  },
  headText: { fontSize: 7, color: '#52525b', fontFamily: 'Helvetica-Bold' },
  time: { width: 52 },
  sender: { width: 120, paddingRight: 6 },
  senderContact: { fontFamily: 'Helvetica-Bold' },
  content: { flex: 1 },
  deleted: { color: '#b91c1c' },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#71717a',
  },
})

export interface AtendimentoPdfMessage extends ExportableWhatsAppMessage {
  id: string
  deletedAt: Date | null
}

export interface AtendimentoPdfInput {
  workspaceName: string
  connectionLabel: string
  connectionPhone: string
  contactName: string | null
  contactWaId: string
  /** Attendant names for the header (`IA`, `Sem atendente` included). */
  attendants: string[]
  /** `YYYY-MM-DD`, São Paulo. */
  dayKey: string
  /** Attendance protocol number, when the conversation has one. */
  protocol: string | null
  conversationId: string
  messages: AtendimentoPdfMessage[]
  generatedAt: Date
}

const generatedFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: ARCHIVE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** `[mensagem apagada] [imagem] foto.jpg legenda`, never empty. */
export function atendimentoMessageText(message: AtendimentoPdfMessage): string {
  const parts: string[] = []
  if (message.deletedAt) parts.push('[mensagem apagada]')
  if (message.type !== 'TEXT') {
    const fileName = mediaFileName(message.mediaUrl)
    parts.push(
      [TYPE_PLACEHOLDER[message.type], fileName].filter(Boolean).join(' '),
    )
  }
  const text = message.text?.trim()
  if (text) parts.push(text)
  return toPdfSafeText(parts.join(' ') || '—')
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{toPdfSafeText(value)}</Text>
    </View>
  )
}

export function AtendimentoDocument({ input }: { input: AtendimentoPdfInput }) {
  const contactLabel = input.contactName ?? formatWaId(input.contactWaId)
  const day = formatDayKey(input.dayKey)

  return (
    <Document
      title={toPdfSafeText(`Atendimento ${contactLabel} ${day}`)}
      author='Steel'
      creator='Steel'
      producer='Steel'
    >
      <Page size='A4' style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Atendimento via WhatsApp</Text>
          <MetaRow label='Workspace' value={input.workspaceName} />
          <MetaRow
            label='Conexão'
            value={`${input.connectionLabel} (${formatWaId(input.connectionPhone)})`}
          />
          <MetaRow
            label='Contato'
            value={`${input.contactName ?? 'Sem nome'} (${formatWaId(input.contactWaId)})`}
          />
          <MetaRow
            label={input.attendants.length > 1 ? 'Atendentes' : 'Atendente'}
            value={input.attendants.join(', ')}
          />
          <MetaRow label='Dia' value={`${day} (horário de Brasília)`} />
          {input.protocol ? (
            <MetaRow label='Protocolo' value={input.protocol} />
          ) : null}
          <MetaRow label='Conversa' value={input.conversationId} />
          <MetaRow label='Mensagens' value={String(input.messages.length)} />
        </View>

        <View style={styles.headRow} fixed>
          <Text style={[styles.headText, styles.time]}>Hora</Text>
          <Text style={[styles.headText, styles.sender]}>Remetente</Text>
          <Text style={[styles.headText, styles.content]}>Mensagem</Text>
        </View>
        {input.messages.map((message) => (
          <View key={message.id} style={styles.row}>
            <Text style={styles.time}>{archiveClock(message.createdAt)}</Text>
            <Text
              style={[
                styles.sender,
                ...(message.direction === 'IN' ? [styles.senderContact] : []),
              ]}
            >
              {toPdfSafeText(senderLabel(message, contactLabel))}
            </Text>
            <Text
              style={[
                styles.content,
                ...(message.deletedAt ? [styles.deleted] : []),
              ]}
            >
              {atendimentoMessageText(message)}
            </Text>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>
            Gerado pelo Steel em{' '}
            {generatedFormatter.format(input.generatedAt).replace(',', '')}{' '}
            (horário de Brasília)
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Página ${pageNumber} de ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}

/** The PDF bytes of one atendimento. */
export async function renderAtendimentoPdf(
  input: AtendimentoPdfInput,
): Promise<Buffer> {
  return renderToBuffer(<AtendimentoDocument input={input} />)
}
