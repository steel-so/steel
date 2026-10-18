/**
 * Agrupamento de incidentes repetidos — **lib pura** (ADR 0016).
 *
 * A assinatura de um incidente é `categoria:subcategoria:serviço:termos`,
 * onde os termos são as palavras significativas do título, normalizadas
 * (sem acento, sem pontuação, sem palavra de ligação). Quando o título tem
 * mais termos do que cabem na assinatura, ficam os **mais relevantes** —
 * os que mais se repetem no título e nos incidentes da janela — e só então
 * os escolhidos são postos em ordem alfabética, para que "Servidor de e-mail
 * fora do ar" e "E-mail fora do ar no servidor" caiam no mesmo grupo.
 *
 * Nada de LLM e nada de banco: a detecção é determinística e auditável —
 * dá para explicar por que dois chamados foram agrupados lendo a
 * assinatura. Quem carrega e grava é o `SdRiskService`; abrir o problema é
 * sempre ação de um agente.
 */

/** Mínimo de incidentes para o grupo virar sugestão de problema. */
export const SD_CLUSTER_MIN_TICKETS = 3

/** Janela de observação (dias) do agrupamento. */
export const SD_CLUSTER_WINDOW_DAYS = 7

/** Quantos termos do título entram na assinatura. */
export const SD_CLUSTER_MAX_TERMS = 4

/** Tamanho mínimo de um termo significativo. */
const MIN_TERM_LENGTH = 3

/**
 * Palavras de ligação do português (e os verbos genéricos de chamado) que
 * não distinguem um incidente de outro.
 */
const SD_STOPWORDS = new Set([
  'ao',
  'aos',
  'com',
  'como',
  'da',
  'das',
  'de',
  'dela',
  'dele',
  'do',
  'dos',
  'em',
  'mais',
  'mas',
  'meu',
  'minha',
  'muito',
  'nao',
  'no',
  'nos',
  'num',
  'numa',
  'ou',
  'para',
  'pela',
  'pelo',
  'por',
  'que',
  'sem',
  'ser',
  'seu',
  'sua',
  'tem',
  'ter',
  'todo',
  'toda',
  'uma',
  'urgente',
  'favor',
  'chamado',
  'problema',
  'erro',
  'ajuda',
  'preciso',
  'esta',
  'estao',
  'esto',
  'sendo',
  'muita',
])

/** Minúsculas, sem acento e sem pontuação (mesma régua da busca da KB). */
export function sdNormalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Os termos significativos do título, na ordem em que aparecem. */
function significantWords(title: string): string[] {
  return sdNormalizeText(title)
    .split(' ')
    .filter(
      (word) =>
        word.length >= MIN_TERM_LENGTH &&
        !SD_STOPWORDS.has(word) &&
        !/^\d+$/.test(word),
    )
}

/**
 * Em quantos incidentes da janela cada termo aparece (frequência de
 * documento). É a régua de relevância do corte de termos: um termo que só
 * um chamado tem não agrupa nada, e um que se repete na janela é justamente
 * o sinal de incidente repetido.
 */
export function sdIncidentTermFrequencies(
  titles: readonly string[],
): Map<string, number> {
  const frequency = new Map<string, number>()
  for (const title of titles) {
    for (const term of new Set(significantWords(title))) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1)
    }
  }
  return frequency
}

/**
 * Termos significativos do título, sem repetição (limitados a
 * `SD_CLUSTER_MAX_TERMS`). Número puro é descartado: o que varia de chamado
 * para chamado (ramal, IP, protocolo) não agrupa nada.
 *
 * O corte é por **relevância**, não por ordem alfabética: primeiro o termo
 * que mais se repete no próprio título, depois o que aparece em mais
 * incidentes da janela (`documentFrequency`, de
 * `sdIncidentTermFrequencies`), e a ordem alfabética só desempata. Os termos
 * que sobram voltam em ordem alfabética — a assinatura não depende da ordem
 * das palavras no título.
 *
 * Frequência na janela, e não tf-idf: o idf premia o termo raro, que é
 * exatamente o que **não** se repete e portanto não forma grupo.
 */
export function sdIncidentTerms(
  title: string,
  documentFrequency?: ReadonlyMap<string, number>,
): string[] {
  const inTitle = new Map<string, number>()
  for (const word of significantWords(title)) {
    inTitle.set(word, (inTitle.get(word) ?? 0) + 1)
  }
  const inWindow = (term: string) => documentFrequency?.get(term) ?? 0
  return [...inTitle.keys()]
    .sort(
      (a, b) =>
        (inTitle.get(b) ?? 0) - (inTitle.get(a) ?? 0) ||
        inWindow(b) - inWindow(a) ||
        (a < b ? -1 : 1),
    )
    .slice(0, SD_CLUSTER_MAX_TERMS)
    .sort()
}

export interface SdClusterTicketInput {
  id: string
  title: string
  categoryId: string | null
  subcategoryId: string | null
  serviceId: string | null
  createdAt: Date
}

/**
 * Assinatura do incidente, ou `null` quando o título não tem nenhum termo
 * significativo — agrupar "urgente!!!" com "preciso de ajuda" juntaria
 * chamados que não têm nada a ver.
 */
export function sdIncidentSignature(
  ticket: Pick<
    SdClusterTicketInput,
    'title' | 'categoryId' | 'subcategoryId' | 'serviceId'
  >,
  documentFrequency?: ReadonlyMap<string, number>,
): string | null {
  const terms = sdIncidentTerms(ticket.title, documentFrequency)
  if (terms.length === 0) return null
  const catalog = [
    ticket.categoryId ?? '-',
    ticket.subcategoryId ?? '-',
    ticket.serviceId ?? '-',
  ].join(':')
  return `${catalog}:${terms.join('-')}`
}

export interface SdIncidentGroup {
  signature: string
  /** Título do incidente mais recente do grupo. */
  title: string
  /** Ids dos incidentes, do mais antigo para o mais recente. */
  ticketIds: string[]
  /** Os incidentes do grupo, na mesma ordem de `ticketIds`. */
  tickets: SdClusterTicketInput[]
  firstSeenAt: Date
  lastSeenAt: Date
}

/** Quantos incidentes do grupo entraram depois de `at`. */
export function sdIncidentsSince(
  group: Pick<SdIncidentGroup, 'tickets'>,
  at: Date,
): number {
  return group.tickets.filter((t) => t.createdAt.getTime() > at.getTime())
    .length
}

/**
 * Agrupa os incidentes da janela por assinatura e devolve só os grupos que
 * passaram do corte (`minTickets`), do mais recente para o mais antigo. A
 * relevância dos termos é medida na própria janela.
 */
export function sdGroupIncidents(
  tickets: SdClusterTicketInput[],
  minTickets: number = SD_CLUSTER_MIN_TICKETS,
): SdIncidentGroup[] {
  const frequency = sdIncidentTermFrequencies(tickets.map((t) => t.title))
  const groups = new Map<string, SdClusterTicketInput[]>()
  for (const ticket of tickets) {
    const signature = sdIncidentSignature(ticket, frequency)
    if (!signature) continue
    const bucket = groups.get(signature)
    if (bucket) bucket.push(ticket)
    else groups.set(signature, [ticket])
  }

  const out: SdIncidentGroup[] = []
  for (const [signature, bucket] of groups) {
    if (bucket.length < minTickets) continue
    const ordered = [...bucket].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
    const newest = ordered[ordered.length - 1]
    out.push({
      signature,
      title: newest.title,
      ticketIds: ordered.map((t) => t.id),
      tickets: ordered,
      firstSeenAt: ordered[0].createdAt,
      lastSeenAt: newest.createdAt,
    })
  }
  return out.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
}

/**
 * Descrição do problema sugerido, já com a lista dos incidentes — o agente
 * abre o chamado com o porquê escrito, não com uma tela em branco.
 */
export function sdClusterProblemDescription(
  group: Pick<SdIncidentGroup, 'ticketIds' | 'firstSeenAt' | 'lastSeenAt'>,
  codes: string[],
): string {
  const list = codes.length > 0 ? codes.join(', ') : group.ticketIds.join(', ')
  return [
    `<p>Problema aberto a partir de ${group.ticketIds.length} incidentes parecidos detectados pela análise preditiva.</p>`,
    `<p><strong>Incidentes:</strong> ${list}</p>`,
  ].join('')
}
