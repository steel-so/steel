'use client'

import {
  ArrowLeft01Icon,
  ComputerIcon,
  MailSend01Icon,
  Moon02Icon,
  Redo02Icon,
  SmartPhone01Icon,
  Sun03Icon,
  Undo02Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSaveCrmEmailBrand,
  useSaveCrmEmailBuilderTemplate,
  useSendCrmEmailTest,
} from '@/src/hooks/use-crm-email-builder'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import { EMAIL_LAYOUTS, moveSection } from '@/src/lib/crm-email-builder/layouts'
import {
  personalizeEmail,
  renderBuilderEmail,
} from '@/src/lib/crm-email-builder/render'
import {
  contactToVariables,
  SAMPLE_CONTACT,
} from '@/src/lib/crm-email-builder/variables'
import {
  type EmailBuilderContact,
  type EmailBuilderDocument,
  EmailBuilderDocumentSchema,
  type EmailBuilderSection,
} from '@/src/schemas/crm-email-builder.schema'
import type {
  CrmEmailBrandDTO,
  CrmEmailTemplateDTO,
} from '@/types/crm-email-marketing'
import type { CrmPersonDTO } from '@/types/crm-person'
import { EmailBuilderPanel, type PanelTab } from './email-builder-panel'
import {
  DESKTOP_WIDTH,
  EmailPreviewFrame,
  MOBILE_WIDTH,
} from './email-preview-frame'
import { useBuilderHistory } from './use-builder-history'

export const AUTOSAVE_MS = 1000
const PREVIEW_LINK = 'https://exemplo.com.br/campanha?utm_source=email'
const ZOOMS = [0.5, 0.75, 1, 1.25]
const LOOKUPS: LookupKind[] = ['companies']

type Draft = { subject: string; document: EmailBuilderDocument }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'invalid'

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Salvo',
  dirty: 'Alterações não salvas',
  saving: 'Salvando…',
  error: 'Erro ao salvar',
  invalid: 'Corrija os campos destacados',
}

function toBrand(dto: CrmEmailBrandDTO): EmailBrand {
  const { companyName, logoUrl, primaryColor, address, website } = dto
  return { companyName, logoUrl, primaryColor, address, website }
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return Boolean(
    el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable),
  )
}

/**
 * Visual e-mail builder: the rendered e-mail on top (desktop/mobile, light/
 * dark simulation, zoom), the content controls in the bottom panel. Edits
 * have undo/redo and autosave; the structure of the layout is locked. Opens
 * v1 templates only; `EmailTemplateEditorPage` (crm/email-editor) loads the
 * template and picks this or the canvas editor.
 */
export function EmailBuilderEditor({
  workspaceId,
  slug,
  template,
  brand: savedBrand,
  topBarExtra,
}: {
  workspaceId: string
  slug: string
  template: CrmEmailTemplateDTO
  brand: CrmEmailBrandDTO
  /** Extra top-bar content (the "Abrir no novo editor" action). */
  topBarExtra?: ReactNode
}) {
  const initial = useMemo<Draft>(
    () => ({
      subject: template.subject,
      document: template.builderDocument as EmailBuilderDocument,
    }),
    [template],
  )
  const history = useBuilderHistory<Draft>(initial)
  const draft = history.value
  const [name, setName] = useState(template.name)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('content')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [dark, setDark] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [contactKey, setContactKey] = useState('sample')
  const [brand, setBrand] = useState<EmailBrand>(() => toBrand(savedBrand))
  const [html, setHtml] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')

  const save = useSaveCrmEmailBuilderTemplate(workspaceId, template.id)
  const saveBrand = useSaveCrmEmailBrand(workspaceId)
  const sendTest = useSendCrmEmailTest(workspaceId, template.id)
  const { items: people } = useCrmResourceList<CrmPersonDTO>(
    workspaceId,
    'people',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUPS)

  const layout = EMAIL_LAYOUTS[draft.document.layout]

  const contact = useMemo<EmailBuilderContact | null>(() => {
    if (contactKey === 'tokens') return null
    if (contactKey === 'sample') return SAMPLE_CONTACT
    const person = people.find((p) => `person:${p.id}` === contactKey)
    if (!person) return SAMPLE_CONTACT
    return {
      email: person.emails[0] ?? '',
      name: person.name,
      company: person.companyId
        ? lookups.maps.companies[person.companyId]
        : undefined,
      jobTitle: person.jobTitle ?? undefined,
      phone: person.phones[0],
      city: person.city ?? undefined,
    }
  }, [contactKey, people, lookups])

  // Live preview: same renderer as the send path, plus click targets.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(async () => {
      const rendered = await renderBuilderEmail(draft.document, brand, {
        subject: draft.subject,
        preview: true,
      })
      const email = contact
        ? personalizeEmail(
            rendered,
            contactToVariables(contact, {
              campaignLink: PREVIEW_LINK,
              unsubscribeUrl: '#descadastro',
            }),
          )
        : rendered
      if (!cancelled) setHtml(email.html)
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [draft, brand, contact])

  // Autosave (debounced). Invalid drafts are kept locally until fixed.
  const lastSaved = useRef(JSON.stringify({ name: template.name, ...initial }))
  const pending = useRef<Promise<unknown> | null>(null)
  const persist = useCallback(async () => {
    const snapshot = JSON.stringify({ name, ...draft })
    if (snapshot === lastSaved.current) return
    if (!EmailBuilderDocumentSchema.safeParse(draft.document).success) {
      setSaveState('invalid')
      return
    }
    if (!name.trim() || !draft.subject.trim()) {
      setSaveState('invalid')
      return
    }
    setSaveState('saving')
    const request = save.mutateAsync({
      name: name.trim(),
      subject: draft.subject.trim(),
      builderDocument: draft.document,
    })
    pending.current = request
    try {
      await request
      lastSaved.current = snapshot
      setSaveState('saved')
    } catch (error) {
      setSaveState('error')
      notify.error(error)
    } finally {
      pending.current = null
    }
  }, [draft, name, save])

  useEffect(() => {
    const snapshot = JSON.stringify({ name, ...draft })
    if (snapshot === lastSaved.current) return
    setSaveState('dirty')
    const handle = setTimeout(persist, AUTOSAVE_MS)
    return () => clearTimeout(handle)
  }, [draft, name, persist])

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z outside text fields (they have their own).
  const { undo, redo } = history
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isTypingTarget(event.target)) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const setDocument = (document: EmailBuilderDocument, group?: string) =>
    history.set({ ...draft, document }, group)

  const updateSection = (
    id: string,
    props: Record<string, unknown>,
    group: string,
  ) =>
    setDocument(
      {
        ...draft.document,
        sections: draft.document.sections.map((s) =>
          s.id === id ? ({ ...s, props } as EmailBuilderSection) : s,
        ),
      },
      group,
    )

  const toggleHidden = (id: string) =>
    setDocument({
      ...draft.document,
      sections: draft.document.sections.map((s) =>
        s.id === id ? { ...s, hidden: !s.hidden } : s,
      ),
    })

  const selectSection = (id: string) => {
    setSelectedId(id)
    setTab('content')
  }

  async function handleTestSend() {
    await persist()
    if (pending.current) await pending.current
    try {
      const personId = contactKey.startsWith('person:')
        ? contactKey.slice('person:'.length)
        : undefined
      const result = await sendTest.mutateAsync(
        personId ? { personId } : { sample: SAMPLE_CONTACT },
      )
      notify.success(`Teste enviado para ${result.to}`)
    } catch (error) {
      notify.error(error)
    }
  }

  async function handleBrandSave(next: EmailBrand) {
    try {
      const saved = await saveBrand.mutateAsync(next)
      setBrand(toBrand(saved))
      notify.success('Marca salva para todos os templates')
    } catch (error) {
      notify.error(error)
    }
  }

  const width = device === 'mobile' ? MOBILE_WIDTH : DESKTOP_WIDTH
  const zoomIndex = ZOOMS.indexOf(zoom)

  return (
    // Phones: the page scrolls (preview, then panel); md+: fixed split.
    <div className='flex h-full min-h-0 w-full flex-col overflow-y-auto md:overflow-hidden'>
      {/* Top bar */}
      <div className='flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Voltar para os templates'
          nativeButton={false}
          render={<Link href={`/${slug}/crm/email-templates`} />}
        >
          <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <Input
          aria-label='Nome do template'
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          className='h-8 w-full min-w-0 font-medium sm:w-56'
        />
        <span
          className={cn(
            'text-xs',
            saveState === 'error' || saveState === 'invalid'
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
          role='status'
        >
          {SAVE_LABEL[saveState]}
        </span>
        {topBarExtra}

        <div className='ml-auto flex flex-wrap items-center gap-1'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Desfazer'
            title='Desfazer (Ctrl+Z)'
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <SteelIcon icon={Undo02Icon} strokeWidth={2} />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Refazer'
            title='Refazer (Ctrl+Shift+Z)'
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <SteelIcon icon={Redo02Icon} strokeWidth={2} />
          </Button>
          <div className='mx-1 h-5 w-px bg-border' />
          <Button
            variant={device === 'desktop' ? 'secondary' : 'ghost'}
            size='icon-sm'
            aria-label='Visualizar no computador'
            aria-pressed={device === 'desktop'}
            onClick={() => setDevice('desktop')}
          >
            <SteelIcon icon={ComputerIcon} strokeWidth={2} />
          </Button>
          <Button
            variant={device === 'mobile' ? 'secondary' : 'ghost'}
            size='icon-sm'
            aria-label='Visualizar no celular'
            aria-pressed={device === 'mobile'}
            onClick={() => setDevice('mobile')}
          >
            <SteelIcon icon={SmartPhone01Icon} strokeWidth={2} />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={
              dark ? 'Ver como cliente claro' : 'Simular cliente em modo escuro'
            }
            aria-pressed={dark}
            onClick={() => setDark((d) => !d)}
          >
            <SteelIcon icon={dark ? Sun03Icon : Moon02Icon} strokeWidth={2} />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Diminuir zoom'
            disabled={zoomIndex <= 0}
            onClick={() => setZoom(ZOOMS[zoomIndex - 1])}
          >
            <SteelIcon icon={ZoomOutAreaIcon} strokeWidth={2} />
          </Button>
          <span className='w-10 text-center text-muted-foreground text-xs tabular-nums'>
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Aumentar zoom'
            disabled={zoomIndex >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[zoomIndex + 1])}
          >
            <SteelIcon icon={ZoomInAreaIcon} strokeWidth={2} />
          </Button>
          <Button
            size='sm'
            onClick={handleTestSend}
            disabled={sendTest.isPending}
          >
            <SteelIcon icon={MailSend01Icon} strokeWidth={2} />
            {sendTest.isPending ? 'Enviando…' : 'Enviar teste'}
          </Button>
        </div>
      </div>

      {/* Subject / preview text / sample contact */}
      <div className='grid shrink-0 gap-2 border-b px-3 py-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_14rem]'>
        <div className='grid min-w-0 gap-1'>
          <Label
            htmlFor='builder-subject'
            className='text-muted-foreground text-xs'
          >
            Assunto
          </Label>
          <Input
            id='builder-subject'
            value={draft.subject}
            maxLength={300}
            onChange={(e) =>
              history.set({ ...draft, subject: e.target.value }, 'subject')
            }
          />
        </div>
        <div className='grid min-w-0 gap-1'>
          <Label
            htmlFor='builder-preheader'
            className='text-muted-foreground text-xs'
          >
            Texto de pré-visualização
          </Label>
          <Input
            id='builder-preheader'
            value={draft.document.previewText}
            maxLength={150}
            onChange={(e) =>
              setDocument(
                { ...draft.document, previewText: e.target.value },
                'previewText',
              )
            }
          />
        </div>
        <div className='grid min-w-0 gap-1'>
          <Label
            htmlFor='builder-contact'
            className='text-muted-foreground text-xs'
          >
            Visualizar como
          </Label>
          <select
            id='builder-contact'
            value={contactKey}
            onChange={(e) => setContactKey(e.target.value)}
            className='h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm'
          >
            <option value='sample'>Contato de exemplo</option>
            <option value='tokens'>Mostrar variáveis</option>
            {people.slice(0, 50).map((person) => (
              <option key={person.id} value={`person:${person.id}`}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preview */}
      <div className='min-h-[60vh] shrink-0 overflow-auto bg-muted/40 px-2 py-4 sm:px-4 md:min-h-0 md:flex-1 md:shrink'>
        <p className='mb-2 text-center text-muted-foreground text-xs'>
          {layout.label} · clique em um bloco para editar
        </p>
        <EmailPreviewFrame
          html={html}
          width={width}
          zoom={zoom}
          dark={dark}
          selectedId={selectedId}
          onSelect={selectSection}
        />
      </div>

      {/* Bottom panel */}
      <div className='h-[70vh] shrink-0 border-t bg-background md:h-[42%] md:min-h-56'>
        <EmailBuilderPanel
          workspaceId={workspaceId}
          document={draft.document}
          selectedId={selectedId}
          tab={tab}
          onTabChange={setTab}
          onSelect={selectSection}
          onSectionChange={updateSection}
          onToggleHidden={toggleHidden}
          onMove={(id, direction) =>
            setDocument(moveSection(draft.document, id, direction))
          }
          brand={brand}
          brandSaving={saveBrand.isPending}
          onBrandPreview={setBrand}
          onBrandSave={handleBrandSave}
        />
      </div>
    </div>
  )
}
