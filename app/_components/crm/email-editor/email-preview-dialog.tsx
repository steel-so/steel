'use client'

import {
  ComputerIcon,
  Moon02Icon,
  SmartPhone01Icon,
  Sun03Icon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { useCanvasStore } from '@/app/_components/canvas/use-canvas'
import {
  DESKTOP_WIDTH,
  EmailPreviewFrame,
  MOBILE_WIDTH,
} from '@/app/_components/crm/email-builder/email-preview-frame'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { getNode } from '@/src/lib/canvas/nodes'
import type { EmailBodyProps } from '@/src/lib/canvas-email/schemas'
import { personalizeEmail } from '@/src/lib/crm-email-builder/render'
import { contactToVariables } from '@/src/lib/crm-email-builder/variables'
import { ContactSelect } from './contact-select'
import { useEmailEditorData } from './editor-data'
import { useTemplateMeta } from './template-meta'
import { useRenderedEmail } from './use-email-render'
import { SAMPLE_KEY, usePreviewContacts } from './use-preview-contacts'

export const PREVIEW_CAMPAIGN_LINK =
  'https://exemplo.com.br/campanha?utm_source=email'

type Device = 'desktop' | 'mobile'

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string; icon: typeof ComputerIcon }>
}) {
  return (
    <div
      role='toolbar'
      aria-label={label}
      className='flex items-center gap-0.5 rounded-md bg-muted p-0.5'
    >
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            value === option.value && 'bg-background text-foreground shadow-xs',
          )}
        >
          <SteelIcon icon={option.icon} className='size-3.5' />
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** The preview body: rendered once the dialog is open. */
function PreviewBody() {
  const { workspaceId, brand, meta } = useEmailEditorData()
  const subject = useTemplateMeta(meta, (m) => m.subject)
  const doc = useCanvasStore((state) => state.doc)
  const rendered = useRenderedEmail(doc, subject, 0)
  const contacts = usePreviewContacts(workspaceId)
  const [contactKey, setContactKey] = useState(SAMPLE_KEY)
  const [device, setDevice] = useState<Device>('desktop')
  const [dark, setDark] = useState(false)

  const preheader =
    (getNode(doc, doc.rootId)?.props as EmailBodyProps | undefined)
      ?.preheader ?? ''

  const contact = contacts.resolve(contactKey)
  const email = useMemo(() => {
    if (!rendered) return null
    const withInbox = { ...rendered, text: preheader }
    return contact
      ? personalizeEmail(
          withInbox,
          contactToVariables(contact, {
            campaignLink: PREVIEW_CAMPAIGN_LINK,
            unsubscribeUrl: '#descadastro',
          }),
        )
      : withInbox
  }, [rendered, contact, preheader])

  return (
    <>
      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-3 pr-14'>
        <div className='mr-auto min-w-0'>
          <DialogTitle className='text-base'>Visualizar e-mail</DialogTitle>
          <DialogDescription className='text-xs'>
            Exatamente como sai no envio, com as variáveis de um contato.
          </DialogDescription>
        </div>
        <Segmented<Device>
          label='Dispositivo'
          value={device}
          onChange={setDevice}
          options={[
            { value: 'desktop', label: 'Computador', icon: ComputerIcon },
            { value: 'mobile', label: 'Celular', icon: SmartPhone01Icon },
          ]}
        />
        <Segmented<'light' | 'dark'>
          label='Tema do leitor'
          value={dark ? 'dark' : 'light'}
          onChange={(value) => setDark(value === 'dark')}
          options={[
            { value: 'light', label: 'Claro', icon: Sun03Icon },
            { value: 'dark', label: 'Escuro', icon: Moon02Icon },
          ]}
        />
        <ContactSelect
          value={contactKey}
          onChange={setContactKey}
          options={contacts.options}
          allowTokens
          className='w-56'
        />
      </div>

      <div className='min-h-0 overflow-y-auto bg-muted/40 px-4 py-5'>
        <div
          className='mx-auto mb-4 flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 shadow-xs transition-[max-width]'
          style={{
            maxWidth: device === 'mobile' ? MOBILE_WIDTH : DESKTOP_WIDTH,
          }}
          data-testid='inbox-preview'
        >
          <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-sm'>
            {(brand.companyName || 'E').slice(0, 1).toUpperCase()}
          </span>
          <div className='min-w-0 flex-1 text-xs'>
            <p className='truncate font-semibold text-foreground'>
              {brand.companyName || 'Sua empresa'}
            </p>
            <p className='truncate'>
              <span className='font-medium text-foreground'>
                {email?.subject || 'Sem assunto'}
              </span>
              {email?.text ? (
                <span className='text-muted-foreground'> — {email.text}</span>
              ) : null}
            </p>
          </div>
        </div>
        {email ? (
          <EmailPreviewFrame
            html={email.html}
            width={device === 'mobile' ? MOBILE_WIDTH : DESKTOP_WIDTH}
            zoom={1}
            dark={dark}
            selectedId={null}
            onSelect={() => {}}
          />
        ) : (
          <Skeleton
            className='mx-auto h-[60vh] w-full'
            style={{
              maxWidth: device === 'mobile' ? MOBILE_WIDTH : DESKTOP_WIDTH,
            }}
          />
        )}
      </div>
    </>
  )
}

/** Top-bar "Visualizar": the final e-mail on desktop/mobile, light/dark,
 * personalized with a real CRM contact. */
export function PreviewButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => setOpen(true)}
        data-testid='email-preview-trigger'
      >
        <SteelIcon icon={ViewIcon} strokeWidth={2} />
        Visualizar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='grid h-[92vh] w-[min(1100px,96vw)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none'>
          {open ? <PreviewBody /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
