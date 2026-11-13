'use client'

import { useSyncExternalStore } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ZapContextPanel } from './zap-context-panel'

const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function snapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia(DESKTOP_QUERY).matches
}

/**
 * Where the customer context lives next to a conversation: a column beside
 * the chat from `lg` up, a sheet below it (the chat needs the whole width on a
 * phone). Mounts nothing while closed, so no request is made until opened.
 */
export function ZapContextSlot({
  workspaceId,
  slug,
  conversation,
  open,
  onOpenChange,
}: {
  workspaceId: string
  slug: string
  conversation: {
    id: string
    contactName: string | null
    contactWaId: string
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isDesktop = useSyncExternalStore(subscribe, snapshot, () => true)
  if (!open) return null

  const panel = (
    <ZapContextPanel
      key={conversation.id}
      workspaceId={workspaceId}
      slug={slug}
      conversation={conversation}
    />
  )

  if (isDesktop) {
    return (
      <aside className='h-full w-80 shrink-0 overflow-y-auto border-l'>
        {panel}
      </aside>
    )
  }
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className='overflow-y-auto'>
        <SheetHeader className='sr-only'>
          <SheetTitle>Contexto do cliente</SheetTitle>
          <SheetDescription>
            CRM, oportunidades e chamados deste contato.
          </SheetDescription>
        </SheetHeader>
        {panel}
      </SheetContent>
    </Sheet>
  )
}
