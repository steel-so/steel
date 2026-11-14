'use client'

import {
  Airplane01Icon,
  Compass01Icon,
  TestTube01Icon,
  Wrench01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AiConversationModeDTO } from '@/types/steel-ai'

export const AGENT_MODE_DISABLED_HINT =
  'O modo Build foi desativado por um administrador em Ajustes > Steel IA.'
export const AUTOPILOT_DISABLED_HINT =
  'O Autopilot está desligado neste workspace. Um administrador pode ativá-lo em Ajustes > Steel IA.'

/** UI names of the conversation modes (EXPLORE / AGENT / AUTOPILOT / TEST). */
export const STEEL_AI_MODE_LABEL: Record<AiConversationModeDTO, string> = {
  EXPLORE: 'Ask',
  AGENT: 'Build',
  AUTOPILOT: 'Autopilot',
  TEST: 'Teste',
}

export const TEST_MODE_HINT =
  'Mostra o que faria sem alterar nada: consulta os dados de verdade, mas criar, alterar, excluir, enviar mensagens e salvar na memória só são simulados. Use para conferir o plano antes de executar no Build.'

const MODES: {
  value: AiConversationModeDTO
  hint: string
  icon: typeof Compass01Icon
}[] = [
  {
    value: 'EXPLORE',
    hint: 'Só responde e consulta dados — não altera nada.',
    icon: Compass01Icon,
  },
  {
    value: 'AGENT',
    hint: 'Propõe criar, alterar ou excluir registros. Nada é feito sem a sua confirmação.',
    icon: Wrench01Icon,
  },
  {
    value: 'AUTOPILOT',
    hint: 'Executa as alterações sozinho, sem pedir confirmação — inclusive exclusões e mensagens a clientes. Tudo fica registrado.',
    icon: Airplane01Icon,
  },
  {
    value: 'TEST',
    hint: TEST_MODE_HINT,
    icon: TestTube01Icon,
  },
]

/**
 * Ask | Build | Autopilot | Teste. A mode the workspace switched off stays
 * visible but disabled, with the reason in the tooltip (Teste never is: it
 * changes nothing). Under `sm` only the labels show (no icons) so the four
 * fit next to the model picker at 390 px.
 */
export function SteelAiModeSwitch({
  value,
  onChange,
  agentModeEnabled,
  autopilotEnabled = false,
  disabled,
  className,
}: {
  value: AiConversationModeDTO
  onChange: (mode: AiConversationModeDTO) => void
  agentModeEnabled: boolean
  autopilotEnabled?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <fieldset
      aria-label='Modo do Steel AI'
      data-tour='ai-modes'
      className={cn(
        'm-0 inline-flex h-7 min-w-0 shrink-0 items-center gap-0.5 rounded-md border-0 bg-muted p-0.5',
        className,
      )}
    >
      {MODES.map((mode) => {
        const locked =
          (mode.value === 'AGENT' && !agentModeEnabled) ||
          (mode.value === 'AUTOPILOT' &&
            (!agentModeEnabled || !autopilotEnabled))
        const checked = value === mode.value
        const button = (
          <button
            type='button'
            aria-pressed={checked}
            data-mode={mode.value}
            disabled={disabled || locked}
            onClick={() => onChange(mode.value)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-[5px] px-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 sm:px-2',
              checked && 'bg-background text-foreground shadow-xs',
              checked &&
                (mode.value === 'AUTOPILOT' || mode.value === 'TEST') &&
                'text-primary',
            )}
          >
            <SteelIcon
              icon={mode.icon}
              strokeWidth={2}
              className='hidden size-3.5 sm:block'
            />
            {STEEL_AI_MODE_LABEL[mode.value]}
          </button>
        )
        const hint = !locked
          ? mode.hint
          : mode.value === 'AUTOPILOT' && agentModeEnabled
            ? AUTOPILOT_DISABLED_HINT
            : AGENT_MODE_DISABLED_HINT
        return (
          <Tooltip key={mode.value}>
            <TooltipTrigger
              render={
                <span className='inline-flex' tabIndex={locked ? 0 : -1} />
              }
            >
              {button}
            </TooltipTrigger>
            <TooltipContent side='top' className='max-w-64'>
              {hint}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </fieldset>
  )
}

/**
 * Effective mode under the workspace switches: a mode that was switched off
 * falls back to the closest one still allowed (Autopilot → Build → Ask).
 * Teste is always allowed (it never writes).
 */
export function allowedSteelAiMode(
  mode: AiConversationModeDTO,
  switches: { agentModeEnabled: boolean; autopilotEnabled: boolean } | null,
): AiConversationModeDTO {
  if (!switches) return mode
  if (mode === 'AUTOPILOT' && !switches.autopilotEnabled) {
    return switches.agentModeEnabled ? 'AGENT' : 'EXPLORE'
  }
  if (mode === 'AGENT' && !switches.agentModeEnabled) return 'EXPLORE'
  return mode
}
