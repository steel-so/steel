/**
 * pt-BR, actionable messages for WhatsApp provider failures (Meta Cloud API
 * and Z-API). The raw provider text stays in the logs; the user reads what
 * happened and what to do. Duck-typed on purpose (no import of the clients)
 * so it works with mocked modules.
 */

export const WHATSAPP_WINDOW_CLOSED_MESSAGE =
  'A janela de 24 horas expirou. Envie um modelo (template) aprovado.'

const META_MESSAGES: Record<number, string> = {
  // Outside the 24h customer-service window.
  131047: WHATSAPP_WINDOW_CLOSED_MESSAGE,
  131026:
    'Não foi possível entregar: o número não tem WhatsApp ou não aceitou a mensagem. Confira o número do contato.',
  131021:
    'O número do contato é o mesmo da conexão. Escolha outro destinatário.',
  131030:
    'Este número não está na lista de destinatários permitidos da conta de teste da Meta.',
  131042:
    'A conta do WhatsApp Business tem um problema de pagamento. Regularize a forma de pagamento no Gerenciador da Meta.',
  131048:
    'A Meta limitou os envios deste número por spam. Aguarde e revise o conteúdo das mensagens.',
  131049:
    'A Meta não entregou para evitar conversas de baixa qualidade. Tente de novo mais tarde.',
  131056:
    'Muitos envios para o mesmo contato em pouco tempo. Aguarde alguns instantes e tente de novo.',
  131051: 'Este tipo de mensagem não é aceito pelo WhatsApp.',
  131052:
    'Não foi possível baixar a mídia enviada pelo contato. Peça para ele reenviar.',
  131053:
    'O arquivo enviado não é aceito pelo WhatsApp. Confira o formato e o tamanho.',
  132000:
    'O número de variáveis do modelo não confere com o que foi enviado. Revise o modelo.',
  132001:
    'O modelo não existe ou não está aprovado no idioma escolhido. Escolha outro modelo.',
  132005:
    'O texto do modelo ficou grande demais depois de preencher as variáveis. Encurte os valores.',
  132007:
    'O modelo foi bloqueado por violar as políticas do WhatsApp. Crie um novo modelo.',
  132012:
    'Os valores das variáveis não seguem o formato do modelo. Revise o preenchimento.',
  132015: 'O modelo está pausado pela Meta por baixa qualidade. Use outro modelo.',
  132016: 'O modelo foi desativado pela Meta. Crie um novo modelo.',
  130429:
    'Limite de envios por segundo da Meta atingido. Aguarde alguns instantes e tente de novo.',
  130472:
    'Este contato faz parte de um teste da Meta e não recebe esta mensagem agora.',
  133010:
    'O número do WhatsApp não está registrado na Meta. Reconecte o número nas configurações.',
  80007: 'Limite de requisições da Meta atingido. Aguarde um pouco e tente de novo.',
  613: 'Limite de requisições da Meta atingido. Aguarde um pouco e tente de novo.',
  190: 'O acesso da conexão à Meta expirou. Reconecte o número nas configurações do WhatsApp.',
  100: 'A Meta recusou os dados enviados. Confira número, texto e modelo e tente de novo.',
  10: 'A conexão não tem permissão para enviar esta mensagem. Reconecte o número nas configurações do WhatsApp.',
}

const GENERIC_MESSAGE =
  'Não foi possível enviar a mensagem pelo WhatsApp. Tente de novo; se continuar, avise o administrador.'

function metaCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const { name, code } = error as { name?: unknown; code?: unknown }
  return name === 'MetaApiError' && typeof code === 'number' ? code : undefined
}

/** Message already written for the user (pt-BR, accents) — keep as is. */
function looksPortuguese(message: string): boolean {
  return /[ãõáéíóúâêôçà]/i.test(message) || /\b(não|nao|falha|erro)\b/i.test(message)
}

/** Maps any error thrown by a provider client to a pt-BR message. */
export function whatsappProviderMessage(error: unknown): string {
  const code = metaCode(error)
  if (code !== undefined && META_MESSAGES[code]) return META_MESSAGES[code]

  const message = error instanceof Error ? error.message : ''
  if (!message) return GENERIC_MESSAGE
  if (/\b(rate limit|too many requests)\b/i.test(message)) {
    return 'Muitos envios em pouco tempo. Aguarde alguns instantes e tente de novo.'
  }
  if (/invalid (phone|number)|not a valid whatsapp|not on whatsapp/i.test(message)) {
    return META_MESSAGES[131026]
  }
  if (/instance not found|not connected|disconnected|you are not connected/i.test(message)) {
    return 'O número da Z-API está desconectado. Reconecte lendo o QR Code nas configurações do WhatsApp.'
  }
  if (/(fetch failed|network|timeout|timed out|ECONN|ENOTFOUND)/i.test(message)) {
    return 'Não foi possível falar com o WhatsApp agora. Verifique a conexão e tente de novo.'
  }
  return looksPortuguese(message) || /Z-API/.test(message)
    ? message
    : GENERIC_MESSAGE
}
