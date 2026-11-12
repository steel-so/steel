'use client'

import type * as React from 'react'
import { Input } from '@/components/ui/input'
import { toDisplayPhone, toStoredPhone } from '@/src/lib/phone-br'

/**
 * Brazilian phone field: masks as `(11) 98888-7777` and never asks for the
 * country code (55 is added when the value is saved).
 */
export function PhoneInput({
  value,
  onValueChange,
  placeholder = '(11) 98888-7777',
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <Input
      {...props}
      type='tel'
      inputMode='tel'
      placeholder={placeholder}
      value={toDisplayPhone(value)}
      onChange={(event) => {
        const next = event.target.value
        const shown = toDisplayPhone(value)
        // Backspace over a mask character ("(", ")", " ", "-") removes no
        // digit; drop the previous digit so the field never gets stuck.
        if (
          next.length < shown.length &&
          next.replace(/\D/g, '') === shown.replace(/\D/g, '')
        ) {
          onValueChange(next.replace(/\D/g, '').slice(0, -1))
          return
        }
        // Emit the storable form (digits, 55 added once DDD + number is complete).
        onValueChange(toStoredPhone(next) ?? '')
      }}
    />
  )
}
