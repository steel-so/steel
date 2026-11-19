'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCrmGoogleAttributes,
  useUpdateGoogleAttributes,
} from '@/src/hooks/use-crm-google-presence'
import type { GoogleAttributeDTO } from '@/src/schemas/crm-google-presence.schema'

/** Yes/no attributes of the location (Wi-Fi, parking, accessibility…) grouped by theme. */
export function GoogleAttributesPanel({
  workspaceId,
}: {
  workspaceId: string
}) {
  const attributes = useCrmGoogleAttributes(workspaceId, true)
  const update = useUpdateGoogleAttributes(workspaceId)
  const [changes, setChanges] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const byGroup = new Map<string, GoogleAttributeDTO[]>()
    for (const attribute of attributes.data ?? []) {
      const key = attribute.group ?? 'Outros'
      byGroup.set(key, [...(byGroup.get(key) ?? []), attribute])
    }
    return [...byGroup.entries()]
  }, [attributes.data])

  if (attributes.isLoading) return <Skeleton className='h-32 w-full' />
  if (attributes.error) {
    return (
      <p role='alert' className='text-destructive text-sm'>
        {attributes.error.message}
      </p>
    )
  }
  if (groups.length === 0) {
    return (
      <p className='rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm'>
        O Google não oferece atributos para a categoria deste local.
      </p>
    )
  }

  const dirty = Object.keys(changes).length > 0

  function save() {
    update.mutate(
      {
        attributes: Object.entries(changes).map(([name, value]) => ({
          name,
          value,
        })),
      },
      {
        onSuccess: () => {
          setChanges({})
          notify.success('Atributos salvos no Google.')
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <div className='space-y-4'>
      {groups.map(([group, items]) => (
        <fieldset key={group} className='space-y-2'>
          <legend className='mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
            {group}
          </legend>
          <div className='grid gap-2 sm:grid-cols-2'>
            {items.map((attribute) => {
              const checked =
                changes[attribute.name] ?? attribute.value === true
              return (
                <label
                  key={attribute.name}
                  htmlFor={`google-attr-${attribute.name}`}
                  className='flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2 text-sm hover:bg-muted/40'
                >
                  <Checkbox
                    id={`google-attr-${attribute.name}`}
                    checked={checked}
                    onCheckedChange={(next) => {
                      const value = next === true
                      setChanges((current) => {
                        const copy = { ...current }
                        if (value === (attribute.value === true)) {
                          delete copy[attribute.name]
                        } else copy[attribute.name] = value
                        return copy
                      })
                    }}
                  />
                  {attribute.displayName}
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
      <div className='flex justify-end gap-2'>
        {dirty ? (
          <Button variant='ghost' onClick={() => setChanges({})}>
            Descartar
          </Button>
        ) : null}
        <Button disabled={!dirty || update.isPending} onClick={save}>
          {update.isPending ? 'Salvando…' : 'Salvar atributos'}
        </Button>
      </div>
    </div>
  )
}
