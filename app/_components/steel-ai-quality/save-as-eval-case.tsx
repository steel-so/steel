'use client'

import { ClipboardPlusIcon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { useOptionalSteelAiWorkspace } from '@/app/_components/steel-ai/steel-ai-context'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useAiEvalSets,
  useSaveAiEvalCaseFromMessage,
} from '@/src/hooks/use-ai-evals'

/**
 * "Salvar como caso de teste" (admins): turns a Steel AI answer and the
 * question before it into a case of a Steel AI eval set.
 */
export function SaveAsEvalCaseButton({
  workspaceId,
  messageId,
}: {
  workspaceId: string
  messageId: string
}) {
  const slug = useOptionalSteelAiWorkspace()?.slug
  const [open, setOpen] = useState(false)
  const [setId, setSetId] = useState<string | null>(null)
  const [criteria, setCriteria] = useState('')
  const sets = useAiEvalSets(workspaceId, open)
  const save = useSaveAiEvalCaseFromMessage(workspaceId)
  const options = (sets.data ?? []).filter(
    (set) => set.target === 'STEEL_ASSISTANT',
  )
  const selected = setId ?? options[0]?.id ?? null
  const names = new Map(options.map((set) => [set.id, set.name]))

  function submit() {
    if (!selected) return
    save.mutate(
      { setId: selected, messageId, criteria: criteria.trim() || null },
      {
        onSuccess: () => {
          setOpen(false)
          setCriteria('')
          notify.success('Caso de teste salvo. Revise a resposta esperada.')
        },
        onError: notify.error,
      },
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='icon-xs'
            aria-label='Salvar como caso de teste'
            title='Salvar como caso de teste'
            className='text-muted-foreground'
          />
        }
      >
        <SteelIcon
          icon={ClipboardPlusIcon}
          strokeWidth={2}
          className='size-3.5'
        />
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 gap-3'>
        <PopoverHeader>
          <PopoverTitle>Salvar como caso de teste</PopoverTitle>
          <PopoverDescription>
            A pergunta anterior vira o caso e esta resposta, a resposta
            esperada.
          </PopoverDescription>
        </PopoverHeader>
        {sets.isLoading ? (
          <p className='text-muted-foreground text-sm'>Carregando conjuntos…</p>
        ) : options.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhum conjunto do Steel AI ainda.{' '}
            {slug ? (
              <Link
                href={`/${slug}/ai/evals`}
                className='font-medium text-foreground underline underline-offset-4'
              >
                Criar conjunto
              </Link>
            ) : null}
          </p>
        ) : (
          <>
            <div className='space-y-1.5'>
              <Label>Conjunto</Label>
              <Select
                value={selected}
                onValueChange={(value) =>
                  setSetId(typeof value === 'string' ? value : null)
                }
              >
                <SelectTrigger aria-label='Conjunto' className='w-full'>
                  <SelectValue>
                    {(value: string | null) =>
                      (value && names.get(value)) ?? 'Escolha um conjunto'
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {options.map((set) => (
                      <SelectItem key={set.id} value={set.id}>
                        {set.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor={`eval-criteria-${messageId}`}>
                Critério (opcional)
              </Label>
              <Textarea
                id={`eval-criteria-${messageId}`}
                rows={2}
                maxLength={2000}
                value={criteria}
                placeholder='Ex.: precisa citar o prazo de SLA'
                onChange={(event) => setCriteria(event.target.value)}
              />
            </div>
            <div className='flex justify-end'>
              <Button
                type='button'
                size='sm'
                disabled={!selected || save.isPending}
                onClick={submit}
              >
                Salvar caso
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
