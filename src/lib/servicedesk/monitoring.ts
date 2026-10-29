import { createHash } from 'node:crypto'
import { escapeSdHtmlText as esc } from '@/src/lib/servicedesk/html'
import type { SdMonitorSeverityMapEntryDTO } from '@/src/schemas/sd-monitor-source.schema'

export {
  SD_GENERIC_PAYLOAD_EXAMPLE,
  SD_GRAFANA_SEVERITIES,
  SD_PRTG_PAYLOAD_EXAMPLE,
  SD_PRTG_SEVERITIES,
  SD_ZABBIX_MEDIA_TYPE_FIELDS,
  SD_ZABBIX_SEVERITIES,
  sdZabbixPayloadExample,
} from './monitor-fields'

/**
 * Leitura do alerta que chega na entrada pública de monitoramento.
 *
 * O mesmo parser atende as duas formas aceitas — o `kind` da origem só muda
 * o texto de ajuda e o snippet mostrado na tela, porque o script do tipo de
 * mídia do Zabbix é escrito pelo próprio cliente e costuma misturar os dois
 * jeitos de nomear os campos.
 *
 * **Zabbix** (tipo de mídia "Webhook", campos do script — veja
 * `SD_ZABBIX_MEDIA_TYPE_FIELDS`):
 *
 * | Campo          | Macro             | Uso |
 * | -------------- | ----------------- | --- |
 * | `eventId`      | `{EVENT.ID}`      | deduplicação `(origem, eventId)` |
 * | `eventValue`   | `{EVENT.VALUE}`   | `1` = problema, `0` = normalizado |
 * | `eventStatus`  | `{EVENT.STATUS}`  | `PROBLEM` / `RESOLVED` |
 * | `eventName`    | `{EVENT.NAME}`    | título do chamado |
 * | `eventSeverity`| `{EVENT.SEVERITY}`| mapa severidade → prioridade |
 * | `eventDate`    | `{EVENT.DATE}`    | início do alerta (`2026.10.01`) |
 * | `eventTime`    | `{EVENT.TIME}`    | início do alerta (`14:03:12`) |
 * | `eventTags`    | `{EVENT.TAGS}`    | tags, separadas por vírgula |
 * | `hostName`     | `{HOST.NAME}`     | vínculo com o item de configuração |
 * | `hostIp`       | `{HOST.IP}`       | vínculo com o item de configuração |
 * | `message`      | `{ALERT.MESSAGE}` | corpo do chamado |
 *
 * **Genérico**: `{ externalId, status, severity, host, subject, body, tags,
 * startedAt }` — `status` aceita `PROBLEM`/`FIRING`/`OK`/`RESOLVED`.
 */

export interface SdMonitorEvent {
  /** Chave de deduplicação dentro da origem. */
  externalId: string
  /** `true` quando o alerta normalizou (OK / RESOLVED / `value` 0). */
  resolved: boolean
  severity: string | null
  host: string | null
  subject: string
  body: string | null
  tags: string[]
  /** Início informado pela origem (`null` = usa a hora do recebimento). */
  startedAt: Date | null
  /**
   * Outros nomes da mesma máquina no alerta (IP, FQDN, nome do dispositivo),
   * tentados na CMDB depois do `host`.
   */
  hostAliases: string[]
  /** O pedaço do corpo que originou este evento (guardado no alerta). */
  raw: Record<string, unknown>
}

/** Teto de alertas aceitos num único envio (o Grafana agrupa vários). */
export const SD_MONITOR_MAX_EVENTS = 50

const MAX_SUBJECT = 200
const MAX_BODY = 8000
const MAX_TAGS = 20

const ID_KEYS = [
  'externalId',
  'external_id',
  'eventId',
  'event_id',
  'eventid',
  'alertId',
  'fingerprint',
  'ruleId',
  'id',
]
const STATUS_KEYS = [
  'status',
  'eventStatus',
  'event_status',
  'state',
  'alertStatus',
]
const VALUE_KEYS = ['value', 'eventValue', 'event_value']
const SEVERITY_KEYS = [
  'severity',
  'eventSeverity',
  'event_severity',
  'priority',
  'level',
]
const HOST_KEYS = [
  'host',
  'hostName',
  'host_name',
  'hostname',
  'hostIp',
  'host_ip',
  'ip',
]
const SUBJECT_KEYS = [
  'subject',
  'alertSubject',
  'alert_subject',
  'eventName',
  'event_name',
  'ruleName',
  'name',
  'title',
]
const BODY_KEYS = [
  'body',
  'message',
  'alertMessage',
  'alert_message',
  'description',
  'details',
  'text',
]
const STARTED_KEYS = ['startedAt', 'started_at', 'timestamp', 'time', 'clock']
const TAG_KEYS = ['tags', 'eventTags', 'event_tags']

const HOST_ALIAS_KEYS = [...HOST_KEYS]

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

const RESOLVED_WORDS = new Set([
  'ok',
  'okay',
  'resolved',
  'resolve',
  'recovery',
  'recovered',
  'normal',
  'up',
  'close',
  'closed',
  'cleared',
  'clear',
  'false',
  'resolvido',
  'normalizado',
])

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (Array.isArray(payload)) return null
  return payload as Record<string, unknown>
}

/** Primeiro valor escalar não vazio entre as chaves dadas. */
function pick(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
    if (typeof value === 'boolean') return String(value)
  }
  return undefined
}

function readTags(record: Record<string, unknown>): string[] {
  for (const key of TAG_KEYS) {
    const raw = record[key]
    let list: string[] | null = null
    if (Array.isArray(raw)) {
      list = raw.filter((t): t is string => typeof t === 'string')
    } else if (typeof raw === 'string') {
      list = raw.split(',')
    } else if (typeof raw === 'object' && raw !== null) {
      list = Object.entries(raw as Record<string, unknown>).map(
        ([name, value]) => `${name}: ${String(value)}`,
      )
    }
    if (!list) continue
    const cleaned = [
      ...new Set(list.map((t) => t.trim()).filter((t) => t !== '')),
    ]
    if (cleaned.length > 0) return cleaned.slice(0, MAX_TAGS)
  }
  return []
}

/** `2026.10.01` + `14:03:12` (Zabbix) ou qualquer data que o `Date` entenda. */
function readStartedAt(record: Record<string, unknown>): Date | null {
  const date = pick(record, ['eventDate', 'event_date'])
  const time = pick(record, ['eventTime', 'event_time'])
  if (date) {
    const iso = `${date.replace(/\./g, '-')}T${time ?? '00:00:00'}`
    const parsed = new Date(iso)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  const raw = pick(record, STARTED_KEYS)
  if (!raw) return null
  // Epoch em segundos (`{EVENT.TIMESTAMP}` do Zabbix) ou em milissegundos.
  if (/^\d{9,14}$/.test(raw)) {
    const n = Number(raw)
    const parsed = new Date(raw.length > 11 ? n : n * 1000)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function readResolved(record: Record<string, unknown>): boolean {
  const status = pick(record, STATUS_KEYS)
  if (status) return RESOLVED_WORDS.has(status.toLowerCase())
  const value = pick(record, VALUE_KEYS)
  // `{EVENT.VALUE}`: 1 = problema, 0 = normalizado.
  if (value) return value === '0' || RESOLVED_WORDS.has(value.toLowerCase())
  return false
}

/**
 * Normaliza o corpo recebido. Devolve `null` quando não dá para montar um
 * alerta (sem assunto reconhecível) — a rota responde
 * `SD_MONITOR_PAYLOAD_INVALID`.
 *
 * Sem `externalId` explícito, a chave de deduplicação vira o SHA-256 de
 * `host|assunto` (`auto:…`): o mesmo alerta reenviado continua caindo no
 * mesmo chamado.
 */
export function parseSdMonitorPayload(payload: unknown): SdMonitorEvent | null {
  const record = asRecord(payload)
  if (!record) return null

  const host = pick(record, HOST_KEYS) ?? null
  const bodyRaw = pick(record, BODY_KEYS) ?? null
  const subjectRaw = pick(record, SUBJECT_KEYS) ?? bodyRaw
  if (!subjectRaw) return null

  const subject = subjectRaw.split('\n')[0].trim().slice(0, MAX_SUBJECT)
  if (subject === '') return null

  const explicitId = pick(record, ID_KEYS)
  const externalId = explicitId
    ? explicitId.slice(0, 200)
    : `auto:${createHash('sha256')
        .update(`${host ?? ''}|${subject}`)
        .digest('hex')
        .slice(0, 32)}`

  return {
    externalId,
    resolved: readResolved(record),
    severity: pick(record, SEVERITY_KEYS)?.slice(0, 60) ?? null,
    host,
    subject,
    body: bodyRaw ? bodyRaw.slice(0, MAX_BODY) : null,
    tags: readTags(record),
    startedAt: readStartedAt(record),
    hostAliases: hostAliasesOf(record, host),
    raw: record,
  }
}

/** Todos os nomes de host do corpo (sem repetir o principal). */
function hostAliasesOf(
  record: Record<string, unknown>,
  main: string | null,
): string[] {
  const found = new Set<string>()
  for (const key of HOST_ALIAS_KEYS) {
    const value = pick(record, [key])
    if (value && value !== main) found.add(value.slice(0, 200))
  }
  return [...found]
}

function stringOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function stableHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}

/** `srv-02:9100` → `srv-02` (não mexe em IPv6). */
function stripPort(instance: string): string {
  const match = /^([^:]+):\d{1,5}$/.exec(instance)
  return match ? match[1] : instance
}

function recordOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const record = asRecord(value)
  if (!record) return out
  for (const [key, raw] of Object.entries(record)) {
    const text = stringOf(raw)
    if (text !== undefined) out[key] = text
  }
  return out
}

function validDate(value: string | undefined): Date | null {
  if (!value || value.startsWith('0001-')) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Um item de `alerts[]` do Grafana (alertas unificados) ou do Alertmanager. */
function parseGrafanaAlert(
  item: Record<string, unknown>,
  top: Record<string, unknown>,
): SdMonitorEvent | null {
  const labels = recordOf(item.labels)
  const annotations = recordOf(item.annotations)
  const alertname = labels.alertname ?? stringOf(top.title)
  const subjectRaw =
    annotations.summary ?? alertname ?? annotations.description ?? null
  if (!subjectRaw) return null
  const subject = subjectRaw.split('\n')[0].trim().slice(0, MAX_SUBJECT)
  if (subject === '') return null

  const hosts = [
    labels.host,
    labels.hostname,
    labels.nodename,
    labels.node,
    labels.instance ? stripPort(labels.instance) : undefined,
  ].filter((h): h is string => !!h)
  const unique = [...new Set(hosts.map((h) => h.slice(0, 200)))]

  const link = [item.panelURL, item.dashboardURL, item.generatorURL]
    .map(stringOf)
    .find((url) => url && /^https?:\/\//i.test(url))
  const description =
    annotations.description ?? annotations.message ?? stringOf(top.message)
  const bodyParts = [description, link ? `Painel: ${link}` : undefined].filter(
    (part): part is string => !!part,
  )

  const fingerprint = stringOf(item.fingerprint)
  const labelPairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
  const externalId = fingerprint
    ? fingerprint.slice(0, 200)
    : `auto:${stableHash([alertname ?? '', ...labelPairs])}`

  const tags = Object.entries(labels)
    .filter(([key]) => key !== 'alertname')
    .map(([key, value]) => `${key}: ${value}`)
    .slice(0, MAX_TAGS)

  return {
    externalId,
    resolved: stringOf(item.status)?.toLowerCase() === 'resolved',
    severity: (labels.severity ?? labels.priority)?.slice(0, 60) ?? null,
    host: unique[0] ?? null,
    subject,
    body: bodyParts.length > 0 ? bodyParts.join('\n').slice(0, MAX_BODY) : null,
    tags,
    startedAt: validDate(stringOf(item.startsAt)),
    hostAliases: unique.slice(1),
    raw: item,
  }
}

/** Sensor do PRTG, no corpo do exemplo `SD_PRTG_PAYLOAD_EXAMPLE`. */
function parsePrtgAlert(
  record: Record<string, unknown>,
): SdMonitorEvent | null {
  const sensorId = pick(record, ['sensorId', 'sensorid'])
  const device = pick(record, ['device', 'deviceName'])
  const hostField = pick(record, ['host', 'hostIp'])
  const sensor = pick(record, ['sensor', 'sensorName', 'name'])
  const status = pick(record, ['status', 'state']) ?? ''
  if (!sensor && !device) return null

  const subject = (
    sensor && device ? `${sensor} em ${device}` : (sensor ?? device ?? '')
  )
    .trim()
    .slice(0, MAX_SUBJECT)
  const resolved = /^(up|ok|normal)\b/i.test(status)
  const first = /^[A-Za-zÀ-ÿ]+/.exec(status)?.[0] ?? null

  const bodyLines = [
    pick(record, ['message']),
    status ? `Status: ${status}` : undefined,
    pick(record, ['lastValue', 'lastvalue'])
      ? `Último valor: ${pick(record, ['lastValue', 'lastvalue'])}`
      : undefined,
  ].filter((line): line is string => !!line)

  const tags = [
    pick(record, ['group']) ? `grupo: ${pick(record, ['group'])}` : undefined,
    pick(record, ['probe']) ? `probe: ${pick(record, ['probe'])}` : undefined,
  ].filter((tag): tag is string => !!tag)

  const externalId = sensorId
    ? `sensor-${sensorId}`.slice(0, 200)
    : `auto:${stableHash([device ?? '', sensor ?? ''])}`
  const aliases = [hostField].filter(
    (h): h is string => !!h && h !== (device ?? hostField),
  )

  return {
    externalId,
    resolved,
    severity: resolved ? null : (first?.slice(0, 60) ?? null),
    host: (device ?? hostField ?? null)?.slice(0, 200) ?? null,
    subject,
    body: bodyLines.length > 0 ? bodyLines.join('\n').slice(0, MAX_BODY) : null,
    tags,
    // O PRTG manda a hora no fuso do servidor dele: vale a do recebimento.
    startedAt: null,
    hostAliases: aliases,
    raw: record,
  }
}

/**
 * Lê o corpo recebido como uma lista de eventos.
 *
 * - **Grafana** (e Alertmanager): `alerts[]` — um envio traz vários alertas,
 *   cada um com `fingerprint`, `status` (`firing`/`resolved`), `labels` e
 *   `annotations`. A presença de `alerts[]` vale para qualquer tipo de
 *   origem, porque o webhook genérico costuma apontar para um Alertmanager.
 * - **PRTG**: um sensor por envio (campos do `SD_PRTG_PAYLOAD_EXAMPLE`).
 * - **Zabbix / genérico**: um alerta por envio (`parseSdMonitorPayload`).
 *
 * Lista vazia = corpo sem alerta reconhecível (`SD_MONITOR_PAYLOAD_INVALID`).
 * Passa de `SD_MONITOR_MAX_EVENTS`, o excedente é descartado.
 */
export function parseSdMonitorEvents(
  kind: string,
  payload: unknown,
): SdMonitorEvent[] {
  const record = asRecord(payload)
  if (!record) return []

  if (Array.isArray(record.alerts)) {
    return record.alerts
      .slice(0, SD_MONITOR_MAX_EVENTS)
      .map((item) => {
        const alert = asRecord(item)
        return alert ? parseGrafanaAlert(alert, record) : null
      })
      .filter((event): event is SdMonitorEvent => event !== null)
  }
  if (kind === 'PRTG') {
    const event = parsePrtgAlert(record)
    return event ? [event] : []
  }
  const event = parseSdMonitorPayload(record)
  return event ? [event] : []
}

/**
 * Nomes para procurar na CMDB, em ordem: os do alerta como vieram (em
 * minúsculas, sem repetir) e, por último, o primeiro rótulo de cada FQDN
 * (`srv-02.lan.exemplo` → `srv-02`; IPs ficam inteiros).
 */
export function sdMonitorHostCandidates(hosts: string[]): string[] {
  const full = [
    ...new Set(
      hosts.map((h) => h.trim().toLowerCase()).filter((h) => h !== ''),
    ),
  ]
  const short = full
    .filter((h) => h.includes('.') && !IPV4.test(h))
    .map((h) => h.split('.')[0])
    .filter((h) => h !== '' && !full.includes(h))
  return [...new Set([...full, ...short])]
}

/**
 * Chave que junta alertas da mesma máquina: o item da CMDB quando o host
 * casou, senão o nome do host (sem domínio, em minúsculas). `null` = o alerta
 * não diz de qual máquina veio, então nada se correlaciona.
 */
export function sdMonitorCorrelationKey(
  configItemId: string | null,
  host: string | null,
): string | null {
  if (configItemId) return `ci:${configItemId}`
  const name = host?.trim().toLowerCase() ?? ''
  if (name === '') return null
  const short = IPV4.test(name) ? name : name.split('.')[0]
  return short === '' ? null : `host:${short}`
}

/** Prioridade configurada para a severidade do alerta (sem diferenciar caixa). */
export function sdMonitorPriorityId(
  severityMap: SdMonitorSeverityMapEntryDTO[],
  severity: string | null,
): string | null {
  if (!severity) return null
  const wanted = severity.trim().toLowerCase()
  return (
    severityMap.find((entry) => entry.from.trim().toLowerCase() === wanted)
      ?.priorityId ?? null
  )
}

/** Lê o `severityMap` guardado como JSON, ignorando entradas inválidas. */
export function sdMonitorSeverityMap(
  raw: unknown,
): SdMonitorSeverityMapEntryDTO[] {
  if (!Array.isArray(raw)) return []
  const entries: SdMonitorSeverityMapEntryDTO[] = []
  for (const item of raw) {
    const record = asRecord(item)
    const from = record && pick(record, ['from'])
    const priorityId = record && pick(record, ['priorityId'])
    if (from && priorityId) entries.push({ from, priorityId })
  }
  return entries
}

/**
 * Descrição HTML do chamado aberto pelo alerta.
 *
 * O payload do webhook é dado de terceiro, então todo valor interpolado passa
 * por `esc()` antes de entrar no HTML — e só em conteúdo de elemento, nunca em
 * atributo. A troca `\n` -> `<br />` acontece **depois** do escape, então só
 * alcança quebras de linha reais. Além disso o resultado ainda atravessa
 * `sanitizeSdHtml` (allowlist de tags/atributos) em `SdTicketEngine.create`
 * antes de ser gravado, que é o mesmo caminho do HTML que vem do editor.
 *
 * O Semgrep marca as duas interpolações abaixo com `raw-html-format` por
 * reconhecer HTML montado à mão; é falso positivo por essas duas camadas, e
 * os `nosemgrep` registram isso em vez de só silenciar o alerta.
 */
export function sdMonitorTicketBody(
  event: SdMonitorEvent,
  sourceName: string,
): string {
  const rows: [string, string][] = [['Origem', sourceName]]
  if (event.host) rows.push(['Host', event.host])
  if (event.severity) rows.push(['Severidade', event.severity])
  rows.push(['Identificador', event.externalId])
  if (event.tags.length > 0) rows.push(['Tags', event.tags.join(', ')])

  const list = rows
    .map(
      ([label, value]) =>
        `<li><strong>${esc(label)}:</strong> ${esc(value)}</li>`,
    )
    .join('')
  const message = event.body
    ? // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
      `<p>${esc(event.body).replace(/\n/g, '<br />')}</p>`
    : ''
  // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
  return `<p>Chamado aberto automaticamente pelo monitoramento.</p><ul>${list}</ul>${message}`
}
