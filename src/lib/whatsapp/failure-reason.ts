export interface SendFailureExplanation {
  /** What happened, in plain pt-BR. */
  title: string
  /** What the agent should do next. */
  action: string
  /** The fix is sending an approved template instead of free text. */
  needsTemplate: boolean
}

const WINDOW_CODES = new Set([131047, 131051, 470])

const KNOWN: Record<number, Omit<SendFailureExplanation, 'needsTemplate'>> = {
  131026: {
    title: 'A mensagem não pôde ser entregue.',
    action:
      'Confira se o número tem WhatsApp e se o contato não bloqueou a empresa.',
  },
  131049: {
    title: 'A Meta não entregou para evitar excesso de mensagens de marketing.',
    action: 'Tente novamente mais tarde ou aguarde o contato responder.',
  },
  131056: {
    title: 'Muitas mensagens para o mesmo contato em pouco tempo.',
    action: 'Aguarde alguns minutos e reenvie.',
  },
  130429: {
    title: 'O limite de envios por segundo foi atingido.',
    action: 'Aguarde um instante e reenvie.',
  },
  131048: {
    title: 'A Meta limitou os envios deste número por suspeita de spam.',
    action: 'Avise o administrador para revisar a qualidade do número.',
  },
  131042: {
    title: 'A conta da Meta tem um problema de pagamento.',
    action: 'Avise o administrador para regularizar a forma de pagamento.',
  },
  131030: {
    title: 'O número do contato não está liberado para receber mensagens.',
    action: 'Avise o administrador: o número pode estar fora da lista de teste.',
  },
  131052: {
    title: 'Não foi possível baixar o arquivo enviado pelo contato.',
    action: 'Peça para o contato enviar o arquivo de novo.',
  },
  131053: {
    title: 'A Meta não aceitou o arquivo enviado.',
    action: 'Verifique o formato e o tamanho do arquivo e reenvie.',
  },
  132000: {
    title: 'O modelo (template) foi preenchido com variáveis a mais ou a menos.',
    action: 'Abra o modelo de novo e preencha todos os campos.',
  },
  132001: {
    title: 'O modelo (template) não existe ou não está aprovado nesse idioma.',
    action: 'Escolha outro modelo aprovado.',
  },
  132012: {
    title: 'Uma variável do modelo (template) está em formato inválido.',
    action: 'Revise os campos preenchidos e reenvie.',
  },
  132015: {
    title: 'O modelo (template) está pausado pela Meta.',
    action: 'Escolha outro modelo aprovado.',
  },
  132016: {
    title: 'O modelo (template) foi desativado pela Meta.',
    action: 'Escolha outro modelo aprovado.',
  },
}

/** Extracts the numeric provider code from "131047: text" (or null). */
export function failureCode(raw: string | null | undefined): number | null {
  const match = raw?.match(/^\s*(\d{3,6})\b/)
  return match ? Number(match[1]) : null
}

/**
 * Translates the provider detail stored on a FAILED message (Meta's
 * "code: text") into something an agent can act on.
 */
export function explainSendFailure(
  raw: string | null | undefined,
): SendFailureExplanation {
  const code = failureCode(raw)
  if (code !== null && WINDOW_CODES.has(code)) {
    return {
      title: 'Passaram mais de 24 horas desde a última mensagem do contato.',
      action: 'Envie um modelo (template) aprovado para retomar a conversa.',
      needsTemplate: true,
    }
  }
  if (code !== null && KNOWN[code]) {
    return {
      ...KNOWN[code],
      needsTemplate: false,
    }
  }
  return {
    title: 'A mensagem não foi entregue.',
    action: 'Tente reenviar. Se continuar falhando, avise o administrador.',
    needsTemplate: false,
  }
}
