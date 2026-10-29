'use client'

import {
  Add01Icon,
  Delete02Icon,
  MagicWand01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateSteelAgentSimulation,
  useGenerateSteelAgentScenarios,
} from '@/src/hooks/use-steel-agent-simulations'
import {
  SIMULATION_DEFAULT_PASS_SCORE,
  SIMULATION_DEFAULT_TURNS,
  SIMULATION_MAX_CASES,
  SIMULATION_MAX_TURNS,
  SIMULATION_MIN_TURNS,
} from '@/src/lib/steel-agents/simulation/limits'
import {
  SIMULATION_CHANNEL_LABEL,
  SIMULATION_CHANNELS,
  SIMULATION_PERSONA_PRESETS,
  type SimulationChannel,
  type SimulationPersonaPreset,
} from '@/src/lib/steel-agents/simulation/personas'
import type { SteelAgentSimulationScenarioDraftDTO } from '@/types/steel-agent-simulation'
import { parseCriteriaLines } from './steel-agent-simulation-labels'

export interface ScenarioForm {
  uid: number
  label: string
  personaKey: string | null
  persona: string
  scenario: string
  channel: SimulationChannel
  openingMessage: string
  /** One criterion per line. */
  criteria: string
  maxTurns: number
}

let nextUid = 0

function fromPreset(preset: SimulationPersonaPreset): ScenarioForm {
  return {
    uid: nextUid++,
    label: preset.label,
    personaKey: preset.key,
    persona: preset.persona,
    scenario: preset.scenario,
    channel: preset.channel,
    openingMessage: preset.openingMessage,
    criteria: preset.criteria.join('\n'),
    maxTurns: SIMULATION_DEFAULT_TURNS,
  }
}

function fromDraft(draft: SteelAgentSimulationScenarioDraftDTO): ScenarioForm {
  return {
    uid: nextUid++,
    label: draft.label,
    personaKey: null,
    persona: draft.persona,
    scenario: draft.scenario,
    channel: draft.channel,
    openingMessage: draft.openingMessage,
    criteria: draft.criteria.join('\n'),
    maxTurns: SIMULATION_DEFAULT_TURNS,
  }
}

function blankScenario(): ScenarioForm {
  return {
    uid: nextUid++,
    label: '',
    personaKey: null,
    persona: '',
    scenario: '',
    channel: 'WHATSAPP',
    openingMessage: '',
    criteria: '',
    maxTurns: SIMULATION_DEFAULT_TURNS,
  }
}

/** Why the form cannot be submitted, or null. */
export function scenariosProblem(scenarios: ScenarioForm[]): string | null {
  if (scenarios.length === 0) return 'Adicione ao menos um cenário.'
  for (const [index, item] of scenarios.entries()) {
    const name = item.label.trim() || `Cenário ${index + 1}`
    if (
      !item.label.trim() ||
      !item.persona.trim() ||
      !item.scenario.trim() ||
      !item.openingMessage.trim()
    ) {
      return `Preencha nome, persona, situação e primeira mensagem de “${name}”.`
    }
    if (parseCriteriaLines(item.criteria).length === 0) {
      return `Informe ao menos um critério de sucesso em “${name}”.`
    }
  }
  return null
}

/**
 * Side panel to compose the scenarios of a persona simulation: presets,
 * "Gerar com IA" drafts and free editing. Submitting queues the simulation
 * and opens its page.
 */
export function SteelAgentSimulationBuilder({
  workspaceId,
  slug,
  agentId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  slug: string
  agentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const create = useCreateSteelAgentSimulation(workspaceId, agentId)
  const generate = useGenerateSteelAgentScenarios(workspaceId, agentId)
  const [scenarios, setScenarios] = useState<ScenarioForm[]>([])
  const [passScore, setPassScore] = useState(SIMULATION_DEFAULT_PASS_SCORE)
  const [focus, setFocus] = useState('')

  const full = scenarios.length >= SIMULATION_MAX_CASES
  const problem = scenariosProblem(scenarios)
  const estimate = scenarios.reduce((sum, item) => sum + item.maxTurns, 0)

  const add = (items: ScenarioForm[]) =>
    setScenarios((current) =>
      [...current, ...items].slice(0, SIMULATION_MAX_CASES),
    )
  const patch = (uid: number, data: Partial<ScenarioForm>) =>
    setScenarios((current) =>
      current.map((item) => (item.uid === uid ? { ...item, ...data } : item)),
    )

  async function suggest() {
    try {
      const drafts = await generate.mutateAsync({
        count: Math.min(3, SIMULATION_MAX_CASES - scenarios.length),
        ...(focus.trim() && { focus: focus.trim() }),
      })
      add(drafts.map(fromDraft))
      notify.success('Cenários sugeridos. Revise antes de simular.')
    } catch (error) {
      notify.error(error)
    }
  }

  async function submit() {
    if (problem) {
      notify.error(problem)
      return
    }
    try {
      const created = await create.mutateAsync({
        passScore,
        scenarios: scenarios.map((item) => ({
          label: item.label.trim(),
          personaKey: item.personaKey,
          persona: item.persona.trim(),
          scenario: item.scenario.trim(),
          channel: item.channel,
          openingMessage: item.openingMessage.trim(),
          criteria: parseCriteriaLines(item.criteria),
          maxTurns: item.maxTurns,
        })),
      })
      notify.success('Simulação enfileirada. Nada será alterado de verdade.')
      onOpenChange(false)
      setScenarios([])
      router.push(`/${slug}/ai/agents/${agentId}/simulations/${created.id}`)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full gap-0 data-[side=right]:sm:max-w-2xl'>
        <SheetHeader className='border-b pr-12'>
          <SheetTitle>Nova simulação</SheetTitle>
          <SheetDescription>
            Monte os cenários: cada um vira uma conversa inteira entre um
            cliente fictício e o agente.
          </SheetDescription>
        </SheetHeader>

        <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4'>
          <section className='space-y-2' aria-label='Adicionar cenários'>
            <p className='font-medium text-sm'>Começar de um modelo</p>
            <div className='flex flex-wrap gap-1.5'>
              {SIMULATION_PERSONA_PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={full}
                  onClick={() => add([fromPreset(preset)])}
                >
                  <SteelIcon icon={Add01Icon} strokeWidth={2} />
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className='flex flex-col gap-2 pt-1 sm:flex-row'>
              <Input
                aria-label='Foco dos cenários gerados'
                value={focus}
                maxLength={500}
                placeholder='Foco opcional, ex.: cobrança e cancelamento'
                onChange={(event) => setFocus(event.target.value)}
              />
              <Button
                type='button'
                variant='secondary'
                disabled={full || generate.isPending}
                onClick={suggest}
                className='shrink-0'
              >
                <SteelIcon icon={MagicWand01Icon} strokeWidth={2} />
                {generate.isPending ? 'Gerando…' : 'Gerar com IA'}
              </Button>
            </div>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              disabled={full}
              onClick={() => add([blankScenario()])}
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Cenário em branco
            </Button>
          </section>

          {scenarios.length === 0 ? (
            <p className='rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
              Nenhum cenário ainda. Escolha um modelo ou gere sugestões com a
              IA.
            </p>
          ) : (
            <ul className='space-y-4'>
              {scenarios.map((item, index) => (
                <li
                  key={item.uid}
                  className='space-y-3 rounded-xl border bg-card p-4'
                >
                  <div className='flex items-center gap-2'>
                    <span className='font-medium text-muted-foreground text-xs'>
                      Cenário {index + 1}
                    </span>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      className='ml-auto'
                      aria-label={`Remover cenário ${index + 1}`}
                      onClick={() =>
                        setScenarios((current) =>
                          current.filter((other) => other.uid !== item.uid),
                        )
                      }
                    >
                      <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                    </Button>
                  </div>
                  <FieldGroup>
                    <div className='grid gap-3 sm:grid-cols-[1fr_12rem]'>
                      <Field>
                        <FieldLabel htmlFor={`sim-label-${item.uid}`}>
                          Nome
                        </FieldLabel>
                        <Input
                          id={`sim-label-${item.uid}`}
                          value={item.label}
                          maxLength={120}
                          onChange={(event) =>
                            patch(item.uid, { label: event.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Canal</FieldLabel>
                        <Select
                          items={SIMULATION_CHANNELS.map((value) => ({
                            value,
                            label: SIMULATION_CHANNEL_LABEL[value],
                          }))}
                          value={item.channel}
                          onValueChange={(next) =>
                            next &&
                            patch(item.uid, {
                              channel: next as SimulationChannel,
                            })
                          }
                        >
                          <SelectTrigger aria-label='Canal' className='w-full'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SIMULATION_CHANNELS.map((value) => (
                              <SelectItem key={value} value={value}>
                                {SIMULATION_CHANNEL_LABEL[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor={`sim-persona-${item.uid}`}>
                        Persona
                      </FieldLabel>
                      <Textarea
                        id={`sim-persona-${item.uid}`}
                        rows={3}
                        value={item.persona}
                        maxLength={1000}
                        onChange={(event) =>
                          patch(item.uid, { persona: event.target.value })
                        }
                      />
                      <FieldDescription>
                        Quem é o cliente e como ele se comporta.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`sim-scenario-${item.uid}`}>
                        Situação
                      </FieldLabel>
                      <Textarea
                        id={`sim-scenario-${item.uid}`}
                        rows={2}
                        value={item.scenario}
                        maxLength={2000}
                        onChange={(event) =>
                          patch(item.uid, { scenario: event.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`sim-opening-${item.uid}`}>
                        Primeira mensagem do cliente
                      </FieldLabel>
                      <Textarea
                        id={`sim-opening-${item.uid}`}
                        rows={2}
                        value={item.openingMessage}
                        maxLength={1000}
                        onChange={(event) =>
                          patch(item.uid, {
                            openingMessage: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`sim-criteria-${item.uid}`}>
                        Critérios de sucesso
                      </FieldLabel>
                      <Textarea
                        id={`sim-criteria-${item.uid}`}
                        rows={4}
                        value={item.criteria}
                        onChange={(event) =>
                          patch(item.uid, { criteria: event.target.value })
                        }
                      />
                      <FieldDescription>
                        Um por linha. O avaliador confere cada um com evidência
                        da conversa.
                      </FieldDescription>
                    </Field>
                    <Field className='sm:max-w-48'>
                      <FieldLabel htmlFor={`sim-turns-${item.uid}`}>
                        Mensagens do cliente (máx.)
                      </FieldLabel>
                      <Input
                        id={`sim-turns-${item.uid}`}
                        type='number'
                        inputMode='numeric'
                        min={SIMULATION_MIN_TURNS}
                        max={SIMULATION_MAX_TURNS}
                        value={item.maxTurns}
                        onChange={(event) =>
                          patch(item.uid, {
                            maxTurns: clampTurns(Number(event.target.value)),
                          })
                        }
                      />
                    </Field>
                  </FieldGroup>
                </li>
              ))}
            </ul>
          )}

          <Field className='sm:max-w-64'>
            <FieldLabel htmlFor='sim-pass-score'>
              Nota mínima (0–100)
            </FieldLabel>
            <Input
              id='sim-pass-score'
              type='number'
              inputMode='numeric'
              min={1}
              max={100}
              value={passScore}
              onChange={(event) =>
                setPassScore(
                  Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                )
              }
            />
            <FieldDescription>
              O cenário só passa com esta nota e todos os critérios atendidos.
            </FieldDescription>
          </Field>
        </div>

        <SheetFooter className='border-t sm:flex-row sm:items-center sm:justify-between'>
          <p className='text-muted-foreground text-xs'>
            {scenarios.length > 0
              ? `Até ${estimate} mensagens de clientes em ${scenarios.length} cenário${scenarios.length === 1 ? '' : 's'}; consome a cota de IA do workspace.`
              : 'Consome a cota de IA do workspace.'}
          </p>
          <Button
            type='button'
            disabled={create.isPending || scenarios.length === 0}
            onClick={submit}
          >
            {create.isPending ? 'Enfileirando…' : 'Simular conversas'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function clampTurns(value: number): number {
  if (!Number.isFinite(value)) return SIMULATION_DEFAULT_TURNS
  return Math.max(
    SIMULATION_MIN_TURNS,
    Math.min(SIMULATION_MAX_TURNS, Math.round(value)),
  )
}
