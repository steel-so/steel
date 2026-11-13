'use client'

import { Link04Icon, UnlinkIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useChangeCustomerLink,
  useCustomerLink,
} from '@/src/hooks/use-customer-link'
import type { CustomerLinkKind } from '@/types/customer-link'

const TARGET_LABEL: Record<CustomerLinkKind, string> = {
  'sd-customer': 'empresa',
  'sd-contact': 'pessoa',
  'whatsapp-contact': 'pessoa',
}

/**
 * Cadastro único (ADR 0066): shows which CRM company/person a ServiceDesk or
 * WhatsApp record is linked to, suggests matches and lets the user fix it.
 * Renders nothing when the user cannot see the CRM side (403/404).
 */
export function CustomerLinkPanel({
  workspaceId,
  kind,
  id,
}: {
  workspaceId: string
  kind: CustomerLinkKind
  id: string
}) {
  const { data, isLoading, isError } = useCustomerLink(workspaceId, kind, id)
  const change = useChangeCustomerLink(workspaceId, kind, id)
  const label = TARGET_LABEL[kind]

  if (isError) return null
  if (isLoading || !data) return <Skeleton className='h-16 w-full' />

  const apply = (targetId: string | null, done: string) =>
    change.mutate(targetId, {
      onSuccess: () => notify.success(done),
      onError: (error) => notify.error(error, 'Não foi possível salvar o vínculo'),
    })

  return (
    <section
      aria-label='Vínculo com o CRM'
      className='flex flex-col gap-3 rounded-lg border p-3'
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='font-medium text-sm'>Cadastro no CRM</p>
          {data.linked ? (
            <p className='truncate text-sm'>
              {data.linked.name}
              {data.linked.detail ? (
                <span className='text-muted-foreground'>
                  {' '}
                  · {data.linked.detail}
                </span>
              ) : null}
            </p>
          ) : (
            <p className='text-muted-foreground text-sm'>
              Sem vínculo. Vincule a {label} do CRM para ver tudo do cliente em
              um só lugar.
            </p>
          )}
        </div>
        {data.linked ? (
          <ConfirmAction
            trigger={
              <Button variant='outline' size='sm' disabled={change.isPending}>
                <SteelIcon icon={UnlinkIcon} strokeWidth={2} />
                Desvincular
              </Button>
            }
            title='Desfazer o vínculo com o CRM?'
            description='Os dois cadastros continuam existindo. Se o CNPJ, e-mail ou telefone coincidirem, o Steel ainda poderá relacioná-los automaticamente.'
            confirmLabel='Desvincular'
            pending={change.isPending}
            onConfirm={() => apply(null, 'Vínculo desfeito')}
          />
        ) : null}
      </div>

      {data.suggestions.length > 0 ? (
        <div className='flex flex-col gap-2'>
          <p className='text-muted-foreground text-xs'>
            {data.linked ? 'Outras opções' : 'Sugestões'}
          </p>
          <ul className='divide-y rounded-md border'>
            {data.suggestions.map((s) => (
              <li
                key={s.id}
                className='flex items-center gap-3 px-3 py-2 text-sm'
              >
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-medium'>{s.name}</p>
                  <p className='truncate text-muted-foreground text-xs'>
                    {s.detail ?? 'Sem detalhes'}
                  </p>
                </div>
                <Badge variant='secondary'>{s.reason}</Badge>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={change.isPending}
                  onClick={() => apply(s.id, 'Vinculado ao CRM')}
                >
                  <SteelIcon icon={Link04Icon} strokeWidth={2} />
                  Vincular
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : data.linked ? null : (
        <p className='text-muted-foreground text-xs'>
          Nenhuma {label} do CRM combina por CNPJ, nome, e-mail ou telefone.
        </p>
      )}
    </section>
  )
}
