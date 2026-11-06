import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import { toPdfSafeText } from '@/src/lib/whatsapp/archive/layout'
import {
  type ExportableWhatsAppMessage,
  fileSlug,
  formatDateTime,
  senderLabel,
  TYPE_PLACEHOLDER,
  type WhatsAppConversationExportFile,
  type WhatsAppConversationExportInput,
} from '@/src/lib/whatsapp/conversation-export'
import { formatWaId } from '@/src/lib/whatsapp/phone'

/**
 * Text-only PDF of a conversation: who said what and when. Media is never
 * embedded nor linked — it shows as a marker (`[imagem]`, `[áudio]`...) so the
 * reader knows something was sent. Same engine and font rules as the archive
 * PDF (`archive/pdf.tsx`): built-in Helvetica, text through `toPdfSafeText`.
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
  meta: { marginTop: 3, color: '#52525b' },
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
  time: { width: 78 },
  sender: { width: 110, paddingRight: 6 },
  senderContact: { fontFamily: 'Helvetica-Bold' },
  content: { flex: 1 },
  empty: { marginTop: 12, color: '#52525b' },
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

/** Text and media marker of a message, never a media URL. */
export function conversationPdfMessageText(
  message: ExportableWhatsAppMessage,
): string {
  const marker = message.type === 'TEXT' ? '' : TYPE_PLACEHOLDER[message.type]
  const text = message.text?.trim() ?? ''
  return toPdfSafeText([marker, text].filter(Boolean).join(' ') || '—')
}

/** Rows laid out per `<Page>`; one giant page flow is quadratic to render. */
const ROWS_PER_PAGE_GROUP = 40

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size))
  }
  return groups
}

function Footer({ generatedAt }: { generatedAt: Date }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        {`Gerado pelo Steel em ${formatDateTime(generatedAt)} (horário de Brasília)`}
      </Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Página ${pageNumber} de ${totalPages}`
        }
      />
    </View>
  )
}

function ColumnHeads() {
  return (
    <View style={styles.headRow}>
      <Text style={[styles.headText, styles.time]}>Data e hora</Text>
      <Text style={[styles.headText, styles.sender]}>Remetente</Text>
      <Text style={[styles.headText, styles.content]}>Mensagem</Text>
    </View>
  )
}

export function ConversationPdfDocument({
  input,
  generatedAt,
}: {
  input: WhatsAppConversationExportInput
  generatedAt: Date
}) {
  const contactLabel = input.contactName ?? formatWaId(input.contactWaId)
  const groups = chunk(input.messages, ROWS_PER_PAGE_GROUP)
  return (
    <Document
      title={toPdfSafeText(`Conversa com ${contactLabel}`)}
      author='Steel'
      creator='Steel'
      producer='Steel'
    >
      {(groups.length > 0 ? groups : [[]]).map((rows, groupIndex) => (
        <Page key={groupIndex} size='A4' style={styles.page}>
          {groupIndex === 0 ? (
            <View style={styles.header}>
              <Text style={styles.title}>Conversa de WhatsApp</Text>
              <Text style={styles.meta}>
                {toPdfSafeText(
                  `Contato: ${input.contactName ?? 'Sem nome'} (${formatWaId(input.contactWaId)})`,
                )}
              </Text>
              <Text style={styles.meta}>
                {`Mensagens: ${input.messages.length} (horário de Brasília)`}
              </Text>
            </View>
          ) : null}
          <ColumnHeads />
          {input.messages.length === 0 ? (
            <Text style={styles.empty}>Nenhuma mensagem nesta conversa.</Text>
          ) : (
            rows.map((message, index) => (
              <View key={index} style={styles.row} wrap={false}>
                <Text style={styles.time}>
                  {formatDateTime(message.createdAt)}
                </Text>
                <Text
                  style={[
                    styles.sender,
                    ...(message.direction === 'IN'
                      ? [styles.senderContact]
                      : []),
                  ]}
                >
                  {toPdfSafeText(senderLabel(message, contactLabel))}
                </Text>
                <Text style={styles.content}>
                  {conversationPdfMessageText(message)}
                </Text>
              </View>
            ))
          )}
          <Footer generatedAt={generatedAt} />
        </Page>
      ))}
    </Document>
  )
}

export async function buildWhatsAppConversationPdf(
  input: WhatsAppConversationExportInput,
  generatedAt: Date = new Date(),
): Promise<WhatsAppConversationExportFile> {
  const buffer = await renderToBuffer(
    <ConversationPdfDocument input={input} generatedAt={generatedAt} />,
  )
  return {
    fileName: `conversa-${fileSlug(input)}.pdf`,
    contentType: 'application/pdf',
    body: new Uint8Array(buffer),
  }
}
