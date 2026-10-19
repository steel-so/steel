'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AiEvalCaseInput } from '@/src/hooks/use-ai-evals'
import { AI_EVAL_MAX_CHECKS } from '@/src/lib/ai/quality-labels'
import type { AiEvalCaseDTO } from '@/types/ai-quality'

/** One check per line, trimmed, no blanks, capped. */
function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, AI_EVAL_MAX_CHECKS)
}

/** Create/edit form of a test case. */
export function AiEvalCaseForm({
  testCase,
  pending,
  onSubmit,
  onCancel,
}: {
  testCase?: AiEvalCaseDTO
  pending: boolean
  onSubmit: (input: AiEvalCaseInput) => void
  onCancel: () => void
}) {
  const [input, setInput] = useState(testCase?.input ?? '')
  const [expected, setExpected] = useState(testCase?.expected ?? '')
  const [criteria, setCriteria] = useState(testCase?.criteria ?? '')
  const [mustContain, setMustContain] = useState(
    (testCase?.mustContain ?? []).join('\n'),
  )
  const [mustNotContain, setMustNotContain] = useState(
    (testCase?.mustNotContain ?? []).join('\n'),
  )
  const graded =
    expected.trim() ||
    criteria.trim() ||
    linesOf(mustContain).length > 0 ||
    linesOf(mustNotContain).length > 0

  return (
    <form
      className='space-y-4'
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          input: input.trim(),
          expected: expected.trim() || null,
          criteria: criteria.trim() || null,
          mustContain: linesOf(mustContain),
          mustNotContain: linesOf(mustNotContain),
        })
      }}
    >
      <div className='space-y-1.5'>
        <Label htmlFor='eval-case-input'>Pergunta</Label>
        <Textarea
          id='eval-case-input'
          value={input}
          required
          rows={3}
          maxLength={4000}
          placeholder='O que o usuário (ou o cliente) pergunta'
          onChange={(event) => setInput(event.target.value)}
        />
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='eval-case-expected'>Resposta esperada</Label>
        <Textarea
          id='eval-case-expected'
          value={expected}
          rows={4}
          maxLength={4000}
          placeholder='O conteúdo de uma boa resposta (não precisa ser literal)'
          onChange={(event) => setExpected(event.target.value)}
        />
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='eval-case-criteria'>Critérios</Label>
        <Textarea
          id='eval-case-criteria'
          value={criteria}
          rows={2}
          maxLength={2000}
          placeholder='Ex.: precisa pedir o número do pedido e não prometer prazo'
          onChange={(event) => setCriteria(event.target.value)}
        />
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label htmlFor='eval-case-contain'>Deve conter</Label>
          <Textarea
            id='eval-case-contain'
            value={mustContain}
            rows={3}
            placeholder='Um texto por linha'
            onChange={(event) => setMustContain(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='eval-case-not-contain'>Não pode conter</Label>
          <Textarea
            id='eval-case-not-contain'
            value={mustNotContain}
            rows={3}
            placeholder='Um texto por linha'
            onChange={(event) => setMustNotContain(event.target.value)}
          />
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>
        As verificações de texto ignoram maiúsculas e acentos. Com resposta
        esperada ou critério, um modelo juiz dá uma nota de 0 a 1; o caso passa
        com 0,7 ou mais e todas as verificações.
      </p>
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' onClick={onCancel}>
          Cancelar
        </Button>
        <Button type='submit' disabled={pending || !input.trim() || !graded}>
          {testCase ? 'Salvar caso' : 'Adicionar caso'}
        </Button>
      </div>
    </form>
  )
}
