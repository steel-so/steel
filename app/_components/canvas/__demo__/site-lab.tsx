'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { validateDocument } from '@/src/lib/canvas/ops'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { createSiteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_VIEWPORT_WIDTHS } from '@/src/lib/canvas-site/constants'
import type { SitePageLink } from '@/src/lib/canvas-site/context'
import {
  getSiteTemplate,
  SITE_PRESETS,
  SITE_TEMPLATES,
} from '@/src/lib/canvas-site/presets'
import {
  parseSiteTheme,
  type SiteTheme,
  siteColorTokens,
} from '@/src/lib/canvas-site/theme'
import { SiteFrameStyles } from '../../canvas-site/site-frame-styles'
import { CanvasEditor } from '../canvas-editor'

const STORAGE_KEY = 'steel.canvas-lab.site'
const DEFAULT_TEMPLATE = 'agencia'

/** Pages of the imaginary site (menus with `source: pages`). */
const LAB_PAGES: SitePageLink[] = [
  { id: 'home', title: 'Início', path: '/' },
  { id: 'sobre', title: 'Sobre', path: '/sobre' },
  { id: 'servicos', title: 'Serviços', path: '/servicos' },
  { id: 'contato', title: 'Contato', path: '/contato' },
]

const catalog = createSiteCatalog({
  pages: LAB_PAGES,
  currentPageId: 'home',
  canEmbed: true,
})

interface Stored {
  template: string
  theme: SiteTheme
  doc: CanvasDocument
}

function fromTemplate(id: string): Stored {
  const template = getSiteTemplate(id) ?? SITE_TEMPLATES[0]
  return {
    template: template.id,
    theme: template.theme(),
    doc: template.document(),
  }
}

function load(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>
      const valid = validateDocument(parsed.doc, catalog)
      if (valid.ok) {
        return {
          template: String(parsed.template ?? DEFAULT_TEMPLATE),
          theme: parseSiteTheme(parsed.theme),
          doc: valid.value,
        }
      }
    }
  } catch {
    // Storage blocked or stale data: start from a template.
  }
  return fromTemplate(DEFAULT_TEMPLATE)
}

function save(value: Stored): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** Site catalog in the playground: templates, sections and the theme. */
export function SiteLab({
  modeSwitch,
  onUploadImage,
}: {
  modeSwitch: ReactNode
  onUploadImage: (file: File) => Promise<string | null>
}) {
  const [state, setState] = useState<Stored | null>(null)
  // Bumped to remount the editor when a template replaces the document.
  const [version, setVersion] = useState(0)
  useEffect(() => setState(load()), [])
  const tokens = useMemo(
    () => (state ? siteColorTokens(state.theme) : []),
    [state],
  )
  if (!state) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        Abrindo o editor…
      </div>
    )
  }
  const applyTemplate = (id: string) => {
    const next = fromTemplate(id)
    save(next)
    setState(next)
    setVersion((value) => value + 1)
    notify.success('Modelo aplicado.')
  }
  return (
    <CanvasEditor
      key={version}
      catalog={catalog}
      initialDocument={state.doc}
      viewportWidths={SITE_VIEWPORT_WIDTHS}
      presets={SITE_PRESETS}
      colorTokens={tokens}
      frameHead={<SiteFrameStyles theme={state.theme} />}
      title={
        <>
          {modeSwitch}
          <span className='truncate text-sm text-muted-foreground'>
            Site de demonstração
          </span>
        </>
      }
      actions={() => (
        <Select
          value={state.template}
          onValueChange={(next) => {
            if (typeof next === 'string') applyTemplate(next)
          }}
        >
          <SelectTrigger
            size='sm'
            aria-label='Modelo de página'
            className='w-48 text-xs'
          >
            <SelectValue placeholder='Modelo'>
              {(current: string | null) =>
                getSiteTemplate(current ?? '')?.label ?? 'Modelo'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {SITE_TEMPLATES.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      onUploadImage={onUploadImage}
      onSave={async (doc) => {
        const next = { ...state, doc }
        return save(next)
      }}
    />
  )
}

/** Demo ↔ Site switch shown in the top bar of the playground. */
export function LabModeSwitch({
  mode,
  onChange,
}: {
  mode: 'demo' | 'site'
  onChange: (mode: 'demo' | 'site') => void
}) {
  return (
    <fieldset className='m-0 flex shrink-0 items-center gap-0.5 rounded-md border p-0.5'>
      <legend className='sr-only'>Catálogo</legend>
      {(
        [
          ['demo', 'Demonstração'],
          ['site', 'Site'],
        ] as const
      ).map(([value, label]) => (
        <Button
          key={value}
          size='xs'
          variant={mode === value ? 'secondary' : 'ghost'}
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {label}
        </Button>
      ))}
    </fieldset>
  )
}
