'use client'

import {
  AiMagicIcon,
  ArrowUp01Icon,
  Cancel01Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Per-field AI chat for the Ghost* text primitives. Under a
 * `GhostAiProvider`, every GhostInput/GhostTextarea gets a mini button at its
 * top-right corner (on hover or focus) that opens a small chat about that
 * field's text; a suggestion is applied to the field in one click.
 *
 * The button is a single floating element positioned over the hovered field
 * instead of a wrapper around each input — the templates are pixel-perfect
 * ports whose flex/grid classes sit on the inputs themselves, and a wrapper
 * would break them. Without a provider (or in `readOnly`) nothing renders.
 */

export type GhostAiTurn = { role: 'user' | 'assistant'; content: string }

export type GhostAiRequest = {
  text: string
  messages: GhostAiTurn[]
  field: { label?: string; multiline: boolean; maxLength?: number }
  section?: string
}

export type GhostAiReply = { reply: string; suggestion: string | null }

export type GhostAiAssist = (request: GhostAiRequest) => Promise<GhostAiReply>

type FieldMeta = {
  getValue: () => string
  apply: (value: string) => void
  label?: string
  multiline: boolean
  maxLength?: number
  section?: string
}

type ChatMessage = GhostAiTurn & { suggestion?: string | null }

type Target = {
  id: string
  el: HTMLElement
  meta: { current: FieldMeta }
}

type GhostAiContextValue = {
  show: (target: Target) => void
  scheduleHide: (id: string) => void
}

const GhostAiContext = createContext<GhostAiContextValue | null>(null)
const GhostAiSectionContext = createContext<string | undefined>(undefined)

/** Names the block the fields below belong to ("Destaque", "Rodapé"). */
export const GhostAiSection = GhostAiSectionContext.Provider

const HIDE_DELAY_MS = 250

const QUICK_ACTIONS = [
  'Melhore este texto',
  'Deixe mais curto',
  'Deixe mais persuasivo',
  'Corrija erros de português',
]

export function GhostAiProvider({
  assist,
  children,
}: {
  assist: GhostAiAssist
  children: ReactNode
}) {
  const [target, setTarget] = useState<Target | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const hoverButtonRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Chat history per field, kept while the builder is mounted.
  const histories = useRef(new Map<string, ChatMessage[]>())

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }, [])

  const show = useCallback(
    (next: Target) => {
      if (openRef.current) return
      cancelHide()
      setTarget(next)
      setRect(next.el.getBoundingClientRect())
    },
    [cancelHide],
  )

  const scheduleHide = useCallback(
    (id: string) => {
      cancelHide()
      hideTimer.current = setTimeout(() => {
        if (openRef.current || hoverButtonRef.current) return
        setTarget((cur) => {
          if (!cur || cur.id !== id) return cur
          // A focused field keeps its button while the pointer is elsewhere.
          return document.activeElement === cur.el ? cur : null
        })
      }, HIDE_DELAY_MS)
    },
    [cancelHide],
  )

  useEffect(() => cancelHide, [cancelHide])

  // Follow the field while the builder scrolls or the window resizes.
  useEffect(() => {
    if (!target) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!target.el.isConnected) {
          setTarget(null)
          return
        }
        setRect(target.el.getBoundingClientRect())
      })
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [target])

  function handleOpenChange(next: boolean) {
    openRef.current = next
    setOpen(next)
    if (!next && target) scheduleHide(target.id)
  }

  const value = useMemo(() => ({ show, scheduleHide }), [show, scheduleHide])

  return (
    <GhostAiContext.Provider value={value}>
      {children}
      {target && rect ? (
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger
            render={
              <button
                type='button'
                aria-label='Ajustar texto com IA'
                title='Ajustar texto com IA'
                // Keep the field focused until the popover takes focus.
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => {
                  hoverButtonRef.current = true
                  cancelHide()
                }}
                onPointerLeave={() => {
                  hoverButtonRef.current = false
                  scheduleHide(target.id)
                }}
                style={{
                  top: Math.max(4, rect.top - 10),
                  left: Math.max(4, rect.right - 14),
                }}
                className={cn(
                  'fixed z-40 flex size-6 items-center justify-center rounded-full border bg-background text-primary shadow-sm transition-transform hover:scale-110',
                  open && 'ring-2 ring-primary/40',
                )}
              >
                <SteelIcon icon={AiMagicIcon} strokeWidth={2} size={13} />
              </button>
            }
          />
          <PopoverContent align='end' className='w-80 gap-0 p-0'>
            <GhostAiChat
              key={target.id}
              assist={assist}
              meta={target.meta}
              history={histories.current.get(target.id) ?? []}
              onHistory={(messages) =>
                histories.current.set(target.id, messages)
              }
              onClose={() => handleOpenChange(false)}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </GhostAiContext.Provider>
  )
}

/**
 * Hooks a Ghost text field into the provider. Returns a ref callback for the
 * field element; a no-op when there is no provider or the field is read-only.
 */
export function useGhostAiField(
  meta: Omit<FieldMeta, 'section'>,
  readOnly?: boolean,
): (el: HTMLElement | null) => void {
  const ctx = useContext(GhostAiContext)
  const section = useContext(GhostAiSectionContext)
  const id = useId()
  const metaRef = useRef<FieldMeta>({ ...meta, section })
  metaRef.current = { ...meta, section }
  const cleanup = useRef<(() => void) | null>(null)

  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.()
      cleanup.current = null
      if (!el || !ctx || readOnly) return
      const target: Target = { id, el, meta: metaRef }
      const onEnter = () => ctx.show(target)
      const onLeave = () => ctx.scheduleHide(id)
      el.addEventListener('pointerenter', onEnter)
      el.addEventListener('focus', onEnter)
      el.addEventListener('pointerleave', onLeave)
      el.addEventListener('blur', onLeave)
      cleanup.current = () => {
        el.removeEventListener('pointerenter', onEnter)
        el.removeEventListener('focus', onEnter)
        el.removeEventListener('pointerleave', onLeave)
        el.removeEventListener('blur', onLeave)
      }
    },
    [ctx, id, readOnly],
  )
}

function GhostAiChat({
  assist,
  meta,
  history,
  onHistory,
  onClose,
}: {
  assist: GhostAiAssist
  meta: { current: FieldMeta }
  history: ChatMessage[]
  onHistory: (messages: ChatMessage[]) => void
  onClose: () => void
}) {
  // Read through the ref at call time: the field re-renders (new value,
  // new commit closure) while the chat stays open.
  const field = meta.current
  const [messages, setMessages] = useState<ChatMessage[]>(history)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    onHistory(messages)
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, onHistory])

  async function send(text: string) {
    const content = text.trim()
    if (!content || pending) return
    const next: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setDraft('')
    setError(null)
    setPending(true)
    try {
      const reply = await assist({
        text: meta.current.getValue(),
        // The API keeps the last turns only; the field text carries the rest.
        messages: next.slice(-11).map((turn) => ({
          role: turn.role,
          content: turn.suggestion
            ? `${turn.content}\n\n${turn.suggestion}`
            : turn.content,
        })),
        field: {
          label: meta.current.label,
          multiline: meta.current.multiline,
          maxLength: meta.current.maxLength,
        },
        section: meta.current.section,
      })
      setMessages((cur) => [
        ...cur,
        { role: 'assistant', content: reply.reply, suggestion: reply.suggestion },
      ])
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'A IA não conseguiu responder agora.',
      )
    } finally {
      setPending(false)
    }
  }

  function apply(index: number, suggestion: string) {
    meta.current.apply(suggestion)
    setApplied(index)
  }

  return (
    <div className='flex flex-col'>
      <div className='flex items-center gap-2 border-b px-3 py-2'>
        <SteelIcon
          icon={AiMagicIcon}
          strokeWidth={2}
          size={14}
          className='text-primary'
        />
        <div className='min-w-0 flex-1'>
          <p className='font-medium text-sm'>Ajustar com IA</p>
          {field.label ? (
            <p className='truncate text-muted-foreground text-xs'>
              {field.section ? `${field.section} · ` : ''}
              {field.label}
            </p>
          ) : null}
        </div>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label='Fechar'
          onClick={onClose}
        >
          <SteelIcon icon={Cancel01Icon} strokeWidth={2} size={14} />
        </Button>
      </div>

      <div
        ref={listRef}
        className='flex max-h-72 min-h-24 flex-col gap-2 overflow-y-auto px-3 py-3'
      >
        {messages.length === 0 ? (
          <div className='flex flex-col gap-2'>
            <p className='text-muted-foreground text-xs'>
              Peça um ajuste para o texto desta caixa ou escolha um atalho:
            </p>
            <div className='flex flex-wrap gap-1'>
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  type='button'
                  onClick={() => send(action)}
                  className='rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-muted'
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message, index) =>
          message.role === 'user' ? (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
              key={index}
              className='max-w-[85%] self-end whitespace-pre-wrap rounded-lg bg-primary px-2.5 py-1.5 text-primary-foreground text-xs'
            >
              {message.content}
            </p>
          ) : (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
              key={index}
              className='flex max-w-[95%] flex-col gap-1.5 self-start'
            >
              {message.suggestion ? (
                <>
                  <p className='whitespace-pre-wrap text-xs'>
                    {message.content}
                  </p>
                  <div className='flex flex-col gap-1.5 rounded-lg border bg-muted/50 p-2'>
                    <p className='whitespace-pre-wrap text-xs'>
                      {message.suggestion}
                    </p>
                    <Button
                      size='xs'
                      variant={applied === index ? 'secondary' : 'default'}
                      className='self-end'
                      onClick={() =>
                        apply(index, message.suggestion as string)
                      }
                    >
                      {applied === index ? (
                        <>
                          <SteelIcon
                            icon={Tick02Icon}
                            strokeWidth={2}
                            size={12}
                          />
                          Aplicado
                        </>
                      ) : (
                        'Aplicar no campo'
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <p className='whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-1.5 text-xs'>
                  {message.content}
                </p>
              )}
            </div>
          ),
        )}

        {pending ? (
          <p className='animate-pulse self-start text-muted-foreground text-xs'>
            Pensando…
          </p>
        ) : null}
        {error ? <p className='text-destructive text-xs'>{error}</p> : null}
      </div>

      <form
        className='flex items-end gap-2 border-t p-2'
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <textarea
          value={draft}
          rows={1}
          maxLength={1000}
          autoFocus
          placeholder='Ex.: deixe mais curto e direto'
          aria-label='Mensagem para a IA'
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(draft)
            }
          }}
          className='max-h-24 min-h-8 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        />
        <Button
          type='submit'
          size='icon-sm'
          aria-label='Enviar'
          disabled={pending || !draft.trim()}
        >
          <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} size={14} />
        </Button>
      </form>
    </div>
  )
}
