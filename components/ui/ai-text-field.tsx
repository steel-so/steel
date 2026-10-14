'use client'

import { type ComponentProps, type Ref, useCallback, useRef } from 'react'
import { useGhostAiField } from '@/components/ui/ghost-ai'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * Drop-in `Input`/`Textarea` with the per-field AI chat: under a
 * `GhostAiProvider` they get the same top-right AI button as the
 * landing-page builder. Work controlled or uncontrolled — a suggestion is
 * written through the native value setter plus an `input` event, so React's
 * `onChange` fires exactly as if the user had typed it.
 */

type AiFieldProps = {
  /** Field name shown to the AI and in the chat header (defaults to the placeholder). */
  aiLabel?: string
}

function writeValue(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  if (!el) return
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function useAiFieldRef<T extends HTMLInputElement | HTMLTextAreaElement>(
  props: {
    placeholder?: string
    maxLength?: number
    readOnly?: boolean
    disabled?: boolean
  },
  aiLabel: string | undefined,
  multiline: boolean,
  forwarded: Ref<T> | undefined,
) {
  const current = useRef<T | null>(null)
  const forwardedRef = useRef(forwarded)
  forwardedRef.current = forwarded
  const aiRef = useGhostAiField(
    {
      getValue: () => current.current?.value ?? '',
      apply: (next) => writeValue(current.current, next),
      label: aiLabel ?? props.placeholder,
      multiline,
      maxLength: props.maxLength,
    },
    props.readOnly || props.disabled,
  )
  return useCallback(
    (el: T | null) => {
      current.current = el
      aiRef(el)
      const ref = forwardedRef.current
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [aiRef],
  )
}

export function AiInput({
  aiLabel,
  ref,
  ...props
}: ComponentProps<typeof Input> & AiFieldProps) {
  const setRef = useAiFieldRef<HTMLInputElement>(props, aiLabel, false, ref)
  return <Input {...props} ref={setRef} />
}

export function AiTextarea({
  aiLabel,
  ref,
  ...props
}: ComponentProps<typeof Textarea> & AiFieldProps) {
  const setRef = useAiFieldRef<HTMLTextAreaElement>(props, aiLabel, true, ref)
  return <Textarea {...props} ref={setRef} />
}
