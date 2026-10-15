'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TEMPLATE_QUALITY } from '@/src/lib/whatsapp/button-editor'
import {
  buildMetaSendComponents,
  extractTemplateFillableFields,
  parseMetaTemplateComponents,
} from '@/src/lib/whatsapp/template-variables'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { TemplatePreview } from './template-preview'
import { TemplateQualityBadge } from './template-quality-badge'

export function TemplateVariablesDialog({
  template,
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: {
  template: WhatsAppTemplateDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (components: unknown[]) => void
  isSubmitting?: boolean
}) {
  const [headerValues, setHeaderValues] = useState<Record<number, string>>({})
  const [bodyValues, setBodyValues] = useState<Record<number, string>>({})
  const [buttonValues, setButtonValues] = useState<Record<number, string>>({})

  const fields = useMemo(() => {
    if (!template) return null
    return extractTemplateFillableFields(
      parseMetaTemplateComponents(template.components),
    )
  }, [template])

  if (!template || !fields) return null

  function reset() {
    setHeaderValues({})
    setBodyValues({})
    setButtonValues({})
  }

  function handleConfirm() {
    if (!fields) return
    onConfirm(
      buildMetaSendComponents(fields, {
        header: headerValues,
        body: bodyValues,
        buttons: buttonValues,
      }),
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex min-w-0 items-center gap-2'>
            <TemplateQualityBadge quality={template.quality} />
            <span className='truncate'>{template.name}</span>
          </DialogTitle>
          <DialogDescription>
            Preencha as variáveis do template antes de enviar
          </DialogDescription>
        </DialogHeader>
        {template.quality === 'RED' ? (
          <p
            role='alert'
            className='rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs'
          >
            {TEMPLATE_QUALITY.RED.description}
          </p>
        ) : null}

        <div className='grid gap-4 md:grid-cols-2'>
          <div className='space-y-3'>
            {Array.from({ length: fields.header.variableCount }, (_, i) => (
              <div key={`header-${i}`} className='space-y-1'>
                <Label>Cabeçalho — variável {i + 1}</Label>
                <Input
                  value={headerValues[i + 1] ?? ''}
                  onChange={(e) =>
                    setHeaderValues((v) => ({ ...v, [i + 1]: e.target.value }))
                  }
                />
              </div>
            ))}
            {Array.from({ length: fields.body.variableCount }, (_, i) => (
              <div key={`body-${i}`} className='space-y-1'>
                <Label>Variável {`{{${i + 1}}}`}</Label>
                <Input
                  value={bodyValues[i + 1] ?? ''}
                  onChange={(e) =>
                    setBodyValues((v) => ({ ...v, [i + 1]: e.target.value }))
                  }
                />
              </div>
            ))}
            {fields.urlButtonVariables.map((buttonIndex) => (
              <div key={`button-${buttonIndex}`} className='space-y-1'>
                <Label>
                  Botão "{fields.buttons[buttonIndex]?.text}" — parâmetro da URL
                </Label>
                <Input
                  value={buttonValues[buttonIndex] ?? ''}
                  onChange={(e) =>
                    setButtonValues((v) => ({
                      ...v,
                      [buttonIndex]: e.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <TemplatePreview
            fields={fields}
            headerMediaUrl={template.headerMediaUrl}
            values={{
              header: headerValues,
              body: bodyValues,
              buttons: buttonValues,
            }}
          />
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
