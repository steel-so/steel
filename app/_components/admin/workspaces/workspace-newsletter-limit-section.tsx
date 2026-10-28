'use client'

import { type FormEvent, useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import {
  useAdminNewsletterSettings,
  useUpdateAdminNewsletterSettings,
} from '@/src/hooks/use-crm-newsletter-issues'
import { AdminPanel, ErrorState, TableSkeleton } from '../shell/admin-ui'

const count = (value: number) => value.toLocaleString('pt-BR')

/** "2026-10" → "10/2026". */
function monthLabel(month: string): string {
  const [year, mm] = month.split('-')
  return mm && year ? `${mm}/${year}` : month
}

/**
 * Monthly newsletter e-mail limit of a workspace (ADR 0054): usage of the
 * São Paulo month and the per-workspace override, which replaces the
 * plan's `newsletterEmailsPerMonth` (billing is off, so in practice this is
 * the limit that counts). Empty field = back to the plan.
 */
export function WorkspaceNewsletterLimitSection({
  workspaceId,
  disabled = false,
}: {
  workspaceId: string
  disabled?: boolean
}) {
  const settings = useAdminNewsletterSettings(workspaceId)
  const update = useUpdateAdminNewsletterSettings(workspaceId)
  const [value, setValue] = useState('')
  const fieldId = useId()

  const data = settings.data
  useEffect(() => {
    if (data) {
      setValue(
        data.limitSource === 'OVERRIDE' && data.limit !== null
          ? String(data.limit)
          : '',
      )
    }
  }, [data])

  const parsed = value.trim() === '' ? null : Number(value)
  const invalid =
    parsed !== null &&
    (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10_000_000)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (invalid) return
    update.mutate(parsed, {
      onSuccess: () =>
        notify.success(
          parsed === null
            ? 'Limite da newsletter voltou ao do plano'
            : 'Limite da newsletter ajustado',
        ),
      onError: (error) => notify.error(error),
    })
  }

  return (
    <AdminPanel
      title='Newsletter do CRM'
      description='E-mails de newsletter por mês (fuso de São Paulo). Testes não contam.'
    >
      {settings.isError ? (
        <ErrorState />
      ) : !data ? (
        <TableSkeleton rows={2} />
      ) : (
        <form
          onSubmit={handleSubmit}
          className='flex flex-col gap-3 p-4 text-sm'
        >
          <p>
            {monthLabel(data.month)}: <strong>{count(data.emailsSent)}</strong>{' '}
            enviados de{' '}
            <strong>
              {data.limit === null ? 'ilimitado' : count(data.limit)}
            </strong>{' '}
            <span className='text-muted-foreground'>
              ({data.limitSource === 'OVERRIDE' ? 'ajuste manual' : 'do plano'})
            </span>
          </p>
          <div className='grid gap-1.5'>
            <Label htmlFor={fieldId}>Limite mensal ajustado</Label>
            <div className='flex flex-wrap gap-2'>
              <Input
                id={fieldId}
                inputMode='numeric'
                className='w-48'
                placeholder='Usar o do plano'
                value={value}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                onChange={(event) =>
                  setValue(event.target.value.replace(/\D/g, ''))
                }
              />
              <Button
                type='submit'
                variant='outline'
                disabled={disabled || invalid || update.isPending}
              >
                Salvar
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>
              Deixe vazio para voltar ao limite do plano. Máximo de 10.000.000.
            </p>
          </div>
        </form>
      )}
    </AdminPanel>
  )
}
