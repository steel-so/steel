'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { usePreviewAiProcedure } from '@/src/hooks/use-ai-procedures'
import { STEP_KIND_LABEL } from './ai-procedure-labels'

/**
 * Preview: which steps would run for the variables you assume known. No AI
 * and no side effects; shows the saved procedure, not unsaved edits.
 */
export function AiProcedurePreview({
  workspaceId,
  procedureId,
}: {
  workspaceId: string
  procedureId: string
}) {
  const preview = usePreviewAiProcedure(workspaceId, procedureId)
  const [raw, setRaw] = useState('')

  const run = () => {
    const variables: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const [name, ...rest] = line.split('=')
      if (name?.trim() && rest.length > 0) {
        variables[name.trim()] = rest.join('=').trim()
      }
    }
    preview.mutate(variables, { onError: notify.error })
  }

  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-sm'>
        Informe valores já conhecidos (uma linha por variável, no formato
        nome=valor) e veja quais passos rodariam. Para testar a conversa
        inteira, vincule o procedimento a um agente e use as simulações.
      </p>
      <Textarea
        aria-label='Variáveis conhecidas'
        rows={3}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={'plano=premium\nstatus=vencido'}
      />
      <Button type='button' variant='outline' onClick={run}>
        Pré-visualizar
      </Button>
      {preview.data ? (
        <div className='space-y-2'>
          {preview.data.problems.length > 0 ? (
            <ul className='list-disc space-y-1 pl-5 text-destructive text-sm'>
              {preview.data.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <ol className='space-y-1.5'>
            {preview.data.plan.map((item, index) => (
              <li
                key={item.key}
                className='flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'
              >
                <span className='text-muted-foreground'>{index + 1}.</span>
                <span className='font-medium'>{item.title}</span>
                <Badge variant='secondary'>{STEP_KIND_LABEL[item.kind]}</Badge>
                {item.applies ? (
                  <Badge variant='outline'>
                    {item.required ? 'Roda (obrigatório)' : 'Roda'}
                  </Badge>
                ) : (
                  <Badge variant='outline'>Dispensado pela condição</Badge>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

