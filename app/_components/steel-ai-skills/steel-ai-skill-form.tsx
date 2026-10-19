'use client'

import { useMemo, useState } from 'react'
import { AiEvalGuard } from '@/app/_components/steel-ai-evals/ai-eval-guard'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { AiSkillInput } from '@/src/hooks/use-ai-skills'
import {
  AI_SKILL_SLUG_MAX,
  AI_SKILL_SLUG_PATTERN,
  normalizeSkillSlug,
} from '@/src/lib/ai/context/skill-command'
import type { AiSkillDTO } from '@/types/ai-skill'
import type { AiConversationModeDTO } from '@/types/steel-ai'

/** A tool the form may suggest (from the agents catalog). */
export interface SteelAiSkillToolOption {
  name: string
  label: string
}

const KEEP_MODE = 'KEEP'

const MODE_LABEL: Record<AiConversationModeDTO | typeof KEEP_MODE, string> = {
  KEEP: 'Manter o modo da conversa',
  EXPLORE: 'Ask — só consulta',
  AGENT: 'Build — propõe alterações',
  AUTOPILOT: 'Autopilot — executa sozinho',
  TEST: 'Teste — simula sem alterar nada',
}

/** Values of a new skill pre-filled from somewhere (e.g. a template). */
export type SteelAiSkillFormInitial = Omit<FormState, 'scope'> & {
  scope?: FormState['scope']
}

interface FormState {
  scope: 'PERSONAL' | 'WORKSPACE'
  name: string
  slug: string
  description: string
  instructions: string
  mode: AiConversationModeDTO | null
  toolNames: string[]
}

type Errors = Partial<
  Record<'name' | 'slug' | 'description' | 'instructions', string>
>

export function validateSkillForm(state: FormState): Errors {
  const errors: Errors = {}
  const slug = normalizeSkillSlug(state.slug)
  if (!state.name.trim()) errors.name = 'Informe o nome'
  if (!slug) errors.slug = 'Informe o comando'
  else if (!AI_SKILL_SLUG_PATTERN.test(slug)) {
    errors.slug = 'Use letras minúsculas, números e hífens (ex.: meu-trabalho)'
  }
  if (!state.description.trim()) errors.description = 'Descreva a skill'
  if (!state.instructions.trim()) errors.instructions = 'Escreva as instruções'
  return errors
}

/**
 * Create/edit form of a skill (also the read-only view of a built-in or of
 * a workspace skill a member cannot change).
 */
export function SteelAiSkillForm({
  workspaceId,
  skill,
  initial,
  canManageWorkspace,
  tools,
  readOnly = false,
  pending = false,
  error,
  onSubmit,
  onCancel,
}: {
  /** Enables "rodar avaliação antes de alterar" on an existing skill. */
  workspaceId?: string
  skill?: AiSkillDTO
  /** New skill only: pre-filled values. */
  initial?: SteelAiSkillFormInitial
  canManageWorkspace: boolean
  tools: SteelAiSkillToolOption[]
  readOnly?: boolean
  pending?: boolean
  error?: string | null
  onSubmit: (input: AiSkillInput) => void
  onCancel: () => void
}) {
  const [state, setState] = useState<FormState>(() =>
    !skill && initial
      ? {
          ...initial,
          scope:
            initial.scope === 'WORKSPACE' && canManageWorkspace
              ? 'WORKSPACE'
              : 'PERSONAL',
        }
      : {
          scope: skill?.kind === 'WORKSPACE' ? 'WORKSPACE' : 'PERSONAL',
          name: skill?.name ?? '',
          slug: skill?.slug ?? '',
          description: skill?.description ?? '',
          instructions: skill?.instructions ?? '',
          mode: skill?.mode ?? null,
          toolNames: skill?.toolNames ?? [],
        },
  )
  const [errors, setErrors] = useState<Errors>({})
  const [toolQuery, setToolQuery] = useState('')
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }))

  const visibleTools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase()
    return tools.filter(
      (tool) =>
        !q || tool.name.includes(q) || tool.label.toLowerCase().includes(q),
    )
  }, [tools, toolQuery])

  function submit() {
    const found = validateSkillForm(state)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    onSubmit({
      ...(!skill && { scope: state.scope }),
      name: state.name.trim(),
      slug: normalizeSkillSlug(state.slug),
      description: state.description.trim(),
      instructions: state.instructions.trim(),
      mode: state.mode,
      toolNames: state.toolNames,
    })
  }

  return (
    <form
      noValidate
      className='space-y-5'
      onSubmit={(event) => {
        event.preventDefault()
        if (!readOnly) submit()
      }}
    >
      <FieldGroup>
        {!skill && canManageWorkspace ? (
          <Field>
            <FieldLabel>Quem pode usar</FieldLabel>
            <RadioGroup
              value={state.scope}
              onValueChange={(value) =>
                set('scope', value as FormState['scope'])
              }
              className='grid gap-2 sm:grid-cols-2'
            >
              <FieldLabel className='flex items-center gap-2 rounded-lg border px-3 py-2 font-normal'>
                <RadioGroupItem value='PERSONAL' />
                Só eu (pessoal)
              </FieldLabel>
              <FieldLabel className='flex items-center gap-2 rounded-lg border px-3 py-2 font-normal'>
                <RadioGroupItem value='WORKSPACE' />
                Todo o workspace
              </FieldLabel>
            </RadioGroup>
          </Field>
        ) : null}
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor='skill-name'>Nome</FieldLabel>
          <Input
            id='skill-name'
            value={state.name}
            maxLength={80}
            readOnly={readOnly}
            aria-invalid={Boolean(errors.name)}
            onChange={(e) => set('name', e.target.value)}
            placeholder='Resumo do cliente'
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.slug)}>
          <FieldLabel htmlFor='skill-slug'>Comando</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>/</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id='skill-slug'
              value={state.slug}
              maxLength={AI_SKILL_SLUG_MAX + 1}
              readOnly={readOnly}
              aria-invalid={Boolean(errors.slug)}
              onChange={(e) => set('slug', e.target.value)}
              placeholder='resumo-cliente'
              autoCapitalize='none'
              spellCheck={false}
            />
          </InputGroup>
          <FieldDescription>
            É o que se digita no chat. Letras minúsculas, números e hífens.
          </FieldDescription>
          <FieldError>{errors.slug}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.description)}>
          <FieldLabel htmlFor='skill-description'>Descrição</FieldLabel>
          <Input
            id='skill-description'
            value={state.description}
            maxLength={300}
            readOnly={readOnly}
            aria-invalid={Boolean(errors.description)}
            onChange={(e) => set('description', e.target.value)}
            placeholder='Chamados e oportunidades de um cliente, em uma tela'
          />
          <FieldDescription>
            O Steel AI usa a descrição para escolher a skill sozinho quando o
            pedido combina com ela.
          </FieldDescription>
          <FieldError>{errors.description}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.instructions)}>
          <FieldLabel htmlFor='skill-instructions'>Instruções</FieldLabel>
          <Textarea
            id='skill-instructions'
            value={state.instructions}
            rows={8}
            maxLength={8000}
            readOnly={readOnly}
            aria-invalid={Boolean(errors.instructions)}
            onChange={(e) => set('instructions', e.target.value)}
            placeholder='O que o Steel AI deve consultar, como organizar a resposta e o que evitar.'
          />
          <FieldError>{errors.instructions}</FieldError>
        </Field>
        {workspaceId && skill && skill.kind !== 'BUILT_IN' && !readOnly ? (
          <AiEvalGuard
            workspaceId={workspaceId}
            target='STEEL_ASSISTANT'
            candidate={{ skillId: skill.id }}
            reason='skill_change'
            changed={state.instructions.trim() !== skill.instructions.trim()}
          />
        ) : null}
        <Field>
          <FieldLabel>Modo ao usar</FieldLabel>
          <Select
            items={Object.entries(MODE_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
            value={state.mode ?? KEEP_MODE}
            disabled={readOnly}
            onValueChange={(value) =>
              set(
                'mode',
                !value || value === KEEP_MODE
                  ? null
                  : (value as AiConversationModeDTO),
              )
            }
          >
            <SelectTrigger aria-label='Modo ao usar' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MODE_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor='skill-tools-search'>
            Ferramentas sugeridas
          </FieldLabel>
          {readOnly ? (
            <p className='text-muted-foreground text-sm'>
              {state.toolNames.length > 0
                ? state.toolNames.join(', ')
                : 'Qualquer ferramenta disponível'}
            </p>
          ) : (
            <div className='rounded-lg border'>
              <Input
                id='skill-tools-search'
                value={toolQuery}
                onChange={(e) => setToolQuery(e.target.value)}
                placeholder='Buscar ferramenta'
                className='rounded-b-none border-0 border-b shadow-none focus-visible:ring-0'
              />
              <div className='max-h-44 space-y-0.5 overflow-y-auto p-1.5'>
                {visibleTools.map((tool) => {
                  const checked = state.toolNames.includes(tool.name)
                  return (
                    <FieldLabel
                      key={tool.name}
                      className='flex items-center gap-2 rounded-md px-1.5 py-1 font-normal hover:bg-muted'
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          set(
                            'toolNames',
                            next
                              ? [...state.toolNames, tool.name]
                              : state.toolNames.filter((n) => n !== tool.name),
                          )
                        }
                      />
                      <span className='min-w-0 truncate'>{tool.label}</span>
                      <span className='ml-auto hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline'>
                        {tool.name}
                      </span>
                    </FieldLabel>
                  )
                })}
                {visibleTools.length === 0 ? (
                  <p className='px-1.5 py-1 text-muted-foreground text-xs'>
                    Nenhuma ferramenta encontrada.
                  </p>
                ) : null}
              </div>
            </div>
          )}
          <FieldDescription>
            Opcional ({state.toolNames.length} selecionadas). Só uma dica para o
            modelo; vazio = qualquer ferramenta disponível.
          </FieldDescription>
        </Field>
      </FieldGroup>

      {error ? (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      ) : null}

      <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
        <Button type='button' variant='outline' onClick={onCancel}>
          {readOnly ? 'Fechar' : 'Cancelar'}
        </Button>
        {readOnly ? null : (
          <Button type='submit' disabled={pending}>
            {skill ? 'Salvar' : 'Criar skill'}
          </Button>
        )}
      </div>
    </form>
  )
}
