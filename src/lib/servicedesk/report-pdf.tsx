import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import { formatSdReportDateTime, formatSdReportRange } from './report-schedule'
import {
  formatSdReportMinutes,
  formatSdReportPercent,
  type SdReportBreakdown,
  type SdSlaReportSummary,
} from './report-sla'

/**
 * PDF do relatório de SLA, com `@react-pdf/renderer`, renderizado no servidor com `renderToBuffer`. Fonte Helvetica (embutida no
 * PDF), nada de rede: funciona igual no worker e numa rota.
 *
 * Toda data sai no **fuso do relatório**, não no do servidor.
 */

const styles = StyleSheet.create({
  page: {
    paddingVertical: 36,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#18181b',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#2893cc',
    paddingBottom: 8,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 10, color: '#52525b', marginTop: 3 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 16,
    marginBottom: 6,
  },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    width: '23%',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 4,
    padding: 8,
  },
  cardLabel: { fontSize: 7, color: '#71717a', textTransform: 'uppercase' },
  cardValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  cardHint: { fontSize: 7, color: '#71717a', marginTop: 2 },
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
  cellWide: { flex: 3 },
  cellMedium: { flex: 2 },
  cellNum: { flex: 1, textAlign: 'right' },
  empty: { fontSize: 8, color: '#71717a', fontStyle: 'italic' },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#a1a1aa',
  },
})

export interface SdReportPdfOptions {
  reportName: string
  workspaceName: string
  timezone: string
  /** Quando o relatório foi gerado (rodapé). */
  generatedAt: Date
}

function Card({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardValue}>{value}</Text>
      {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
    </View>
  )
}

function BreakdownTable({
  label,
  rows,
}: {
  label: string
  rows: SdReportBreakdown[]
}) {
  if (rows.length === 0) {
    return <Text style={styles.empty}>Sem chamados no período.</Text>
  }
  return (
    <View>
      <View style={styles.headRow}>
        <Text style={[styles.headText, styles.cellWide]}>{label}</Text>
        <Text style={[styles.headText, styles.cellNum]}>Abertos</Text>
        <Text style={[styles.headText, styles.cellNum]}>Resolvidos</Text>
        <Text style={[styles.headText, styles.cellNum]}>Violados</Text>
        <Text style={[styles.headText, styles.cellNum]}>SLA</Text>
        <Text style={[styles.headText, styles.cellNum]}>MTTR</Text>
      </View>
      {rows.map((row) => (
        <View key={`${row.id ?? 'none'}-${row.label}`} style={styles.row}>
          <Text style={styles.cellWide}>{row.label}</Text>
          <Text style={styles.cellNum}>{row.opened}</Text>
          <Text style={styles.cellNum}>{row.resolved}</Text>
          <Text style={styles.cellNum}>{row.breached}</Text>
          <Text style={styles.cellNum}>
            {formatSdReportPercent(row.compliance)}
          </Text>
          <Text style={styles.cellNum}>
            {formatSdReportMinutes(row.averageResolutionMinutes)}
          </Text>
        </View>
      ))}
    </View>
  )
}

export function SdSlaReportDocument({
  summary,
  options,
}: {
  summary: SdSlaReportSummary
  options: SdReportPdfOptions
}) {
  const { timezone } = options
  const range = formatSdReportRange(
    { start: summary.periodStart, end: summary.periodEnd },
    timezone,
  )

  return (
    <Document
      title={`${options.reportName} — ${range}`}
      author='Steel ServiceDesk'
    >
      <Page size='A4' style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{options.reportName}</Text>
          <Text style={styles.subtitle}>
            {options.workspaceName} · {range} · fuso {timezone}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Volume</Text>
        <View style={styles.cards}>
          <Card label='Abertos' value={String(summary.volume.opened)} />
          <Card label='Resolvidos' value={String(summary.volume.resolved)} />
          <Card label='Fechados' value={String(summary.volume.closed)} />
          <Card
            label='Em aberto'
            value={String(summary.volume.openAtEnd)}
            hint='no fim do período'
          />
        </View>

        <Text style={styles.sectionTitle}>Cumprimento de SLA</Text>
        <View style={styles.cards}>
          <Card
            label='1ª resposta'
            value={formatSdReportPercent(summary.firstResponse.compliance)}
            hint={`${summary.firstResponse.met}/${summary.firstResponse.measured} no prazo`}
          />
          <Card
            label='Resolução'
            value={formatSdReportPercent(summary.resolution.compliance)}
            hint={`${summary.resolution.met}/${summary.resolution.measured} no prazo`}
          />
          <Card
            label='Violações'
            value={String(summary.violationCount)}
            hint='no período'
          />
          <Card
            label='CSAT'
            value={
              summary.csat.average === null
                ? '—'
                : summary.csat.average.toFixed(1).replace('.', ',')
            }
            hint={`${summary.csat.answered} avaliação(ões)`}
          />
        </View>

        <Text style={styles.sectionTitle}>Tempos (horário útil)</Text>
        <View style={styles.cards}>
          <Card
            label='Tempo médio de 1ª resposta'
            value={formatSdReportMinutes(summary.firstResponse.averageMinutes)}
          />
          <Card
            label='MTTR'
            value={formatSdReportMinutes(summary.resolution.averageMinutes)}
            hint='tempo médio de resolução'
          />
        </View>

        <Text style={styles.sectionTitle}>Por departamento</Text>
        <BreakdownTable label='Departamento' rows={summary.byDepartment} />

        <Text style={styles.sectionTitle}>Por cliente</Text>
        <BreakdownTable label='Cliente' rows={summary.byCustomer} />

        <Text style={styles.sectionTitle}>Por prioridade</Text>
        <BreakdownTable label='Prioridade' rows={summary.byPriority} />

        <View style={styles.footer} fixed>
          <Text>
            Gerado em {formatSdReportDateTime(options.generatedAt, timezone)}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber}/${totalPages}`
            }
          />
        </View>
      </Page>

      <Page size='A4' style={styles.page}>
        <Text style={styles.sectionTitle}>
          Violações de SLA ({summary.violationCount})
        </Text>
        {summary.violations.length === 0 ? (
          <Text style={styles.empty}>
            Nenhuma violação no período — todos os prazos foram cumpridos.
          </Text>
        ) : (
          <View>
            <View style={styles.headRow}>
              <Text style={[styles.headText, styles.cellMedium]}>Chamado</Text>
              <Text style={[styles.headText, styles.cellWide]}>Título</Text>
              <Text style={[styles.headText, styles.cellMedium]}>Cliente</Text>
              <Text style={[styles.headText, styles.cellMedium]}>Prazo</Text>
              <Text style={[styles.headText, styles.cellMedium]}>
                Vencimento
              </Text>
              <Text style={[styles.headText, styles.cellNum]}>Atraso</Text>
            </View>
            {summary.violations.map((violation) => (
              <View
                key={`${violation.ticketId}-${violation.kind}`}
                style={styles.row}
                wrap={false}
              >
                <Text style={styles.cellMedium}>{violation.code}</Text>
                <Text style={styles.cellWide}>{violation.title}</Text>
                <Text style={styles.cellMedium}>
                  {violation.customer ?? '—'}
                </Text>
                <Text style={styles.cellMedium}>
                  {violation.kind === 'FIRST_RESPONSE'
                    ? '1ª resposta'
                    : 'Resolução'}
                </Text>
                <Text style={styles.cellMedium}>
                  {formatSdReportDateTime(violation.dueAt, timezone)}
                </Text>
                <Text style={styles.cellNum}>
                  {formatSdReportMinutes(violation.delayMinutes)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {summary.violations.length < summary.violationCount ? (
          <Text style={styles.cardHint}>
            Lista limitada às {summary.violations.length} violações com maior
            atraso; o CSV traz as demais.
          </Text>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            Gerado em {formatSdReportDateTime(options.generatedAt, timezone)}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber}/${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}

/** PDF pronto para gravar no MinIO ou anexar no e-mail. */
export async function renderSdSlaReportPdf(
  summary: SdSlaReportSummary,
  options: SdReportPdfOptions,
): Promise<Buffer> {
  return renderToBuffer(
    <SdSlaReportDocument summary={summary} options={options} />,
  )
}
