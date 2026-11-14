/**
 * Meta explains a rejection with a code ("INVALID_FORMAT") or an English
 * sentence. This turns the known ones into a pt-BR reason and a next step the
 * user can act on; anything else is shown as Meta wrote it.
 */
const KNOWN_REASONS: { pattern: RegExp; message: string }[] = [
  {
    pattern: /INVALID_FORMAT|format/i,
    message:
      'O formato do texto não foi aceito. Confira as variáveis ({{1}}, {{2}}...): elas precisam estar em ordem, não podem ficar coladas nem no começo ou no fim da mensagem.',
  },
  {
    pattern: /ABUSIVE|HARASS|THREAT/i,
    message:
      'A Meta considerou o texto abusivo ou ameaçador. Reescreva com um tom neutro e educado.',
  },
  {
    pattern: /SCAM|FRAUD|PHISH/i,
    message:
      'A Meta suspeitou de golpe. Evite pedir senhas, dados de cartão ou pagamentos por link no texto.',
  },
  {
    pattern: /TAG_CONTENT_MISMATCH|CATEGORY|PROMOTIONAL|MARKETING/i,
    message:
      'O conteúdo não combina com a categoria escolhida (por exemplo, texto de promoção em "Utilidade"). Troque a categoria para Marketing ou tire o apelo comercial.',
  },
  {
    pattern: /NONE|UNKNOWN/i,
    message:
      'A Meta não informou o motivo. Revise o texto, remova links encurtados e envie de novo.',
  },
]

export function translateTemplateRejection(
  reason: string | null | undefined,
): string | null {
  const text = reason?.trim()
  if (!text) return null
  return (
    KNOWN_REASONS.find((entry) => entry.pattern.test(text))?.message ?? text
  )
}
