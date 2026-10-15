'use client'

import { ViewIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { validateDocument } from '@/src/lib/canvas/ops'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { CanvasEditor } from '../canvas-editor'
import {
  DEMO_TOKENS,
  demoCatalog,
  demoDocument,
  demoPresets,
} from './demo-catalog'
import { LabModeSwitch, SiteLab } from './site-lab'

const STORAGE_KEY = 'steel.canvas-lab.document'
const MODE_KEY = 'steel.canvas-lab.mode'

type LabMode = 'demo' | 'site'

function loadMode(): LabMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'site' ? 'site' : 'demo'
  } catch {
    return 'demo'
  }
}

function loadDocument(): CanvasDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const valid = validateDocument(JSON.parse(raw), demoCatalog)
      if (valid.ok) return valid.value
    }
  } catch {
    // Storage blocked or stale data: start from the sample document.
  }
  return demoDocument()
}

/** Reads a picked file as a data URL (the playground has no storage). */
function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (file.size > 2 * 1024 * 1024) {
      notify.error('Use uma imagem de até 2 MB no playground.')
      resolve(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** The playground: demo or site catalog, autosave to this browser's
 * storage. */
export function CanvasLab() {
  // Read storage after mount so the server and client renders match.
  const [mode, setMode] = useState<LabMode | null>(null)
  useEffect(() => setMode(loadMode()), [])
  if (!mode) return null
  const switchMode = (next: LabMode) => {
    try {
      window.localStorage.setItem(MODE_KEY, next)
    } catch {
      // Not persisted: the switch still applies to this visit.
    }
    setMode(next)
  }
  const modeSwitch = <LabModeSwitch mode={mode} onChange={switchMode} />
  return mode === 'site' ? (
    <SiteLab modeSwitch={modeSwitch} onUploadImage={readAsDataUrl} />
  ) : (
    <DemoLab modeSwitch={modeSwitch} />
  )
}

function DemoLab({ modeSwitch }: { modeSwitch: ReactNode }) {
  const [initial, setInitial] = useState<CanvasDocument | null>(null)
  useEffect(() => setInitial(loadDocument()), [])
  if (!initial) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        Abrindo o editor…
      </div>
    )
  }
  return (
    <CanvasEditor
      catalog={demoCatalog}
      initialDocument={initial}
      viewportWidths={{ base: 1200, tablet: 768, mobile: 375 }}
      presets={demoPresets}
      colorTokens={DEMO_TOKENS}
      darkPreview
      title={
        <>
          {modeSwitch}
          <span className='truncate'>Página de demonstração</span>
          <Badge variant='secondary' className='shrink-0'>
            Canvas Lab
          </Badge>
        </>
      }
      actions={({ store }) => (
        <>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              window.localStorage.removeItem(STORAGE_KEY)
              store.reset(demoDocument())
            }}
          >
            Restaurar exemplo
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() =>
              notify.info(
                'A visualização chega com os catálogos de e-mail e sites.',
              )
            }
          >
            <SteelIcon icon={ViewIcon} />
            Visualizar
          </Button>
        </>
      )}
      onUploadImage={readAsDataUrl}
      onSave={async (doc) => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
          return true
        } catch {
          return false
        }
      }}
    />
  )
}
