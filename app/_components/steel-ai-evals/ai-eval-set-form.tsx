'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { AiEvalSetInput } from '@/src/hooks/use-ai-evals'
import { useAiSkills } from '@/src/hooks/use-ai-skills'
import {
  AI_EVAL_TARGET_LABELS,
  AI_EVAL_TARGETS,
  type AiEvalTargetKey,
} from '@/src/lib/ai/quality-labels'
import type { AiEvalSetDTO } from '@/types/ai-quality'

const NO_SKILL = '__none__'

/** Create/edit form of an eval set (the target is fixed after creation). */
export function AiEvalSetForm({
  workspaceId,
  set,
  pending,
  onSubmit,
  onCancel,
}: {
  workspaceId: string
  set?: AiEvalSetDTO
  pending: boolean
  onSubmit: (input: AiEvalSetInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(set?.name ?? '')
  const [description, setDescription] = useState(set?.description ?? '')
  const [target, setTarget] = useState<AiEvalTargetKey>(
    set?.target ?? 'STEEL_ASSISTANT',
  )
  const [skillId, setSkillId] = useState<string>(set?.skillId ?? NO_SKILL)
  const skills = useAiSkills(workspaceId)
  // Built-in skills have no row to point at; evaluate custom ones.
  const options = (skills.data?.skills ?? []).filter(
    (skill) => skill.kind !== 'BUILT_IN',
  )
  const skillNames = new Map(
    options.map((skill) => [skill.id, `/${skill.slug} — ${skill.name}`]),
  )

  return (
    <form
      className='space-y-4'
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          name: name.trim(),
          description: description.trim() || null,
          ...(set ? {} : { target }),
          skillId:
            target === 'STEEL_ASSISTANT' && skillId !== NO_SKILL
              ? skillId
              : null,
        })
      }}
    >
      <div className='space-y-1.5'>
        <Label htmlFor='eval-set-name'>Nome</Label>
        <Input
          id='eval-set-name'
          value={name}
          maxLength={120}
          required
          placeholder='Ex.: Perguntas frequentes do suporte'
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='eval-set-description'>Descrição (opcional)</Label>
        <Textarea
          id='eval-set-description'
          value={description}
          maxLength={500}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className='space-y-1.5'>
        <Label>O que avaliar</Label>
        <Select
          value={target}
          disabled={Boolean(set)}
          onValueChange={(value) => {
            if (typeof value === 'string' && value in AI_EVAL_TARGET_LABELS) {
              setTarget(value as AiEvalTargetKey)
            }
          }}
        >
          <SelectTrigger aria-label='O que avaliar' className='w-full'>
            <SelectValue>
              {(value: AiEvalTargetKey) => AI_EVAL_TARGET_LABELS[value]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {AI_EVAL_TARGETS.map((key) => (
                <SelectItem key={key} value={key}>
                  {AI_EVAL_TARGET_LABELS[key]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className='text-muted-foreground text-xs'>
          {target === 'STEEL_ASSISTANT'
            ? 'Responde com o prompt do Steel AI, sem consultar dados do workspace.'
            : target === 'STEEL_AGENT'
              ? 'Responde com as instruções da versão do agente em avaliação, sem ferramentas. Vincule o conjunto a um agente para travar a publicação das versões.'
              : 'Responde com o prompt e os documentos de conhecimento da IA do WhatsApp.'}
        </p>
      </div>
      {target === 'STEEL_ASSISTANT' ? (
        <div className='space-y-1.5'>
          <Label>Skill (opcional)</Label>
          <Select
            value={skillId}
            onValueChange={(value) =>
              setSkillId(typeof value === 'string' ? value : NO_SKILL)
            }
          >
            <SelectTrigger aria-label='Skill' className='w-full'>
              <SelectValue>
                {(value: string) =>
                  value === NO_SKILL
                    ? 'Nenhuma'
                    : (skillNames.get(value) ?? 'Skill removida')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value={NO_SKILL}>Nenhuma</SelectItem>
                {options.map((skill) => (
                  <SelectItem key={skill.id} value={skill.id}>
                    /{skill.slug} — {skill.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' onClick={onCancel}>
          Cancelar
        </Button>
        <Button type='submit' disabled={pending || !name.trim()}>
          {set ? 'Salvar' : 'Criar conjunto'}
        </Button>
      </div>
    </form>
  )
}
