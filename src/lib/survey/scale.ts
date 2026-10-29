/**
 * Scales, default copy and the WhatsApp payload of the satisfaction surveys
 * (NPS 0–10, CSAT 1–5, CES 1–7). Pure: no I/O, shared by the service, the
 * public page and the tests.
 */
export type SurveyKind = 'NPS' | 'CSAT' | 'CES'

export interface SurveyScale {
  min: number
  max: number
}

export const SURVEY_SCALES: Record<SurveyKind, SurveyScale> = {
  NPS: { min: 0, max: 10 },
  CSAT: { min: 1, max: 5 },
  CES: { min: 1, max: 7 },
}

export const SURVEY_KIND_LABELS: Record<SurveyKind, string> = {
  NPS: 'NPS',
  CSAT: 'CSAT',
  CES: 'CES',
}

export function isScoreInScale(kind: SurveyKind, score: number): boolean {
  const scale = SURVEY_SCALES[kind]
  return Number.isInteger(score) && score >= scale.min && score <= scale.max
}

export interface SurveyButtonOption {
  score: number
  /** Up to 20 characters: the WhatsApp reply-button limit. */
  label: string
}

/**
 * WhatsApp allows 3 reply buttons, so CSAT and CES use a 3-level answer
 * (low / middle / high of the scale). NPS has 11 values and is answered by
 * typing a number, which every kind also accepts.
 */
export const SURVEY_BUTTONS: Record<SurveyKind, SurveyButtonOption[]> = {
  CSAT: [
    { score: 1, label: '😞 Ruim' },
    { score: 3, label: '😐 Regular' },
    { score: 5, label: '😀 Ótimo' },
  ],
  CES: [
    { score: 2, label: 'Difícil' },
    { score: 4, label: 'Normal' },
    { score: 6, label: 'Fácil' },
  ],
  NPS: [],
}

export const DEFAULT_SURVEY_QUESTIONS: Record<SurveyKind, string> = {
  CSAT: 'Como você avalia o atendimento que recebeu? Toque em uma das opções ou responda com um número de 1 a 5.',
  CES: 'O quanto foi fácil resolver o que você precisava? Toque em uma das opções ou responda com um número de 1 (muito difícil) a 7 (muito fácil).',
  NPS: 'De 0 a 10, qual a chance de você recomendar a nossa empresa a um amigo ou colega? Responda com um número.',
}

export const DEFAULT_SURVEY_THANK_YOU =
  'Obrigado pela sua avaliação! Se quiser, conte em uma mensagem o que podemos melhorar.'

export const SURVEY_COMMENT_WINDOW_MINUTES = 30
export const SURVEY_COMMENT_MAX = 2000

/** Prefix of the button payload that carries the answer: `stl:s:<id>:<score>`. */
const PAYLOAD_PREFIX = 'stl'
const PAYLOAD_CODE = 's'

export function buildSurveyPayload(surveyId: string, score: number): string {
  return [PAYLOAD_PREFIX, PAYLOAD_CODE, surveyId, String(score)].join(':')
}

export interface SurveyPayload {
  surveyId: string
  score: number
}

/** `null` for anything that is not a survey button (template/quick-reply). */
export function parseSurveyPayload(
  raw: string | null | undefined,
): SurveyPayload | null {
  if (!raw || raw.length > 256) return null
  const parts = raw.split(':')
  if (parts.length !== 4) return null
  const [prefix, code, surveyId, scoreText] = parts
  if (prefix !== PAYLOAD_PREFIX || code !== PAYLOAD_CODE || !surveyId) {
    return null
  }
  if (!/^\d{1,2}$/.test(scoreText)) return null
  return { surveyId, score: Number(scoreText) }
}

/** A typed answer: just a number (`"9"`, `" 10 "`, `"nota 8"` is not one). */
export function parseTypedScore(
  text: string | null | undefined,
): number | null {
  const trimmed = text?.trim()
  if (!trimmed || !/^\d{1,2}$/.test(trimmed)) return null
  return Number(trimmed)
}

/** The body of the WhatsApp invitation (question; buttons travel apart). */
export function surveyQuestion(
  kind: SurveyKind,
  custom: string | null | undefined,
): string {
  const text = custom?.trim()
  return text ? text : DEFAULT_SURVEY_QUESTIONS[kind]
}

export const EMAIL_SURVEY_QUESTIONS: Record<SurveyKind, string> = {
  CSAT: 'Como você avalia o atendimento que recebeu? Escolha uma nota de 1 (muito ruim) a 5 (ótimo).',
  CES: 'O quanto foi fácil resolver o que você precisava? Escolha uma nota de 1 (muito difícil) a 7 (muito fácil).',
  NPS: 'De 0 a 10, qual a chance de você recomendar a nossa empresa a um amigo ou colega?',
}

/** Question of the e-mail invitation (the scale is explained in the text). */
export function surveyEmailQuestion(
  kind: SurveyKind,
  custom: string | null | undefined,
): string {
  const text = custom?.trim()
  return text ? text : EMAIL_SURVEY_QUESTIONS[kind]
}
