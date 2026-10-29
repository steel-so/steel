'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  useCrmCadences,
  useEnrollCrmCadence,
} from '@/src/hooks/use-crm-cadences'
import { CadenceEnrollmentsList } from './cadence-enrollments-list'

/** "Cadências" block of the lead sheet: where the lead is running and a picker to enroll it. */
export function LeadCadencePanel({
  workspaceId,
  leadId,
  canEnroll,
}: {
  workspaceId: string
  leadId: string
  canEnroll: boolean
}) {
  const cadences = useCrmCadences(workspaceId)
  const enroll = useEnrollCrmCadence(workspaceId)
  const [cadenceId, setCadenceId] = useState<string | null>(null)

  const active = (cadences.data ?? []).filter(
    (cadence) => cadence.status === 'ACTIVE',
  )

  function submit() {
    if (!cadenceId) return
    enroll.mutate(
      { cadenceId, leadIds: [leadId] },
      {
        onSuccess: (result) => {
          if (result.enrolled.length > 0) {
            notify.success('Lead inscrito na cadência')
            setCadenceId(null)
          } else {
            notify.error(
              null,
              result.skipped[0]?.reason ?? 'Não foi possível inscrever',
            )
          }
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <section className='flex flex-col gap-2' aria-label='Cadências'>
      <h3 className='font-medium text-sm'>Cadências</h3>
      <CadenceEnrollmentsList
        workspaceId={workspaceId}
        leadId={leadId}
        showCadenceName
        emptyText='Este lead não está em nenhuma cadência.'
      />
      {canEnroll && active.length > 0 ? (
        <div className='flex items-center gap-2'>
          <Select
            items={active.map((cadence) => ({
              value: cadence.id,
              label: cadence.name,
            }))}
            value={cadenceId}
            onValueChange={(value) => setCadenceId(value as string)}
          >
            <SelectTrigger aria-label='Cadência' className='min-w-0 flex-1'>
              <SelectValue placeholder='Inscrever em uma cadência' />
            </SelectTrigger>
            <SelectContent>
              {active.map((cadence) => (
                <SelectItem key={cadence.id} value={cadence.id}>
                  {cadence.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size='sm'
            disabled={!cadenceId || enroll.isPending}
            onClick={submit}
          >
            Inscrever
          </Button>
        </div>
      ) : null}
    </section>
  )
}
