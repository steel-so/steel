import { useNumberValidationAvailability } from '@/src/hooks/use-whatsapp-number-validation-availability'

const UNAVAILABLE_HINT =
  'A validação de números ainda não está disponível: falta a linha de verificação da Stratus ou uma conexão Z-API conectada neste workspace. Peça a um administrador para configurá-la.'

const CHECK_FAILED_HINT =
  'Não foi possível confirmar se a validação de números está disponível. Tente novamente em instantes.'

const PLATFORM_INFO =
  'Os números são conferidos por uma linha de verificação da Stratus, sem precisar da sua própria Z-API; só o número é enviado, nunca o nome.'

const WORKSPACE_INFO =
  'Os números são conferidos pela sua conexão Z-API; só o número é enviado, nunca o nome.'

/**
 * Single source of truth for the UI of the "tem WhatsApp?" check: whether the
 * action may be used and the pt-BR copy for each case.
 */
export function useNumberValidationState(workspaceId: string) {
  const query = useNumberValidationAvailability(workspaceId)
  const loaded = query.data !== undefined || query.isError
  const available = query.data?.available === true
  const source = query.data?.source ?? null

  const unavailableHint = !loaded
    ? null
    : available
      ? null
      : query.isError
        ? CHECK_FAILED_HINT
        : UNAVAILABLE_HINT

  const info = available
    ? source === 'PLATFORM'
      ? PLATFORM_INFO
      : WORKSPACE_INFO
    : null

  return {
    /** False while the first answer has not arrived yet. */
    loaded,
    available,
    /** Explains why the action is disabled; null while loading or available. */
    unavailableHint,
    /** One-line note on how the numbers are checked; null when unavailable. */
    info,
  }
}
