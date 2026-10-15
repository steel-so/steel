'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { notify } from '@/lib/notify'
import { useUpdateWhatsAppTemplateButtons } from '@/src/hooks/use-whatsapp-templates'
import {
  normalizeButtons,
  validateButtons,
} from '@/src/lib/whatsapp/button-editor'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { WhatsappButtonsEditor } from './buttons/whatsapp-buttons-editor'
import { TemplateQualityBadge } from './template-quality-badge'

/** "Ações dos botões": what each reply button of an existing template does
 * when the contact clicks it. Labels and links come from the approved
 * template, so only the actions are editable. */
export function TemplateButtonsSheet({
  workspaceId,
  template,
  onOpenChange,
}: {
  workspaceId: string
  template: WhatsAppTemplateDTO | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={template !== null} onOpenChange={onOpenChange}>
      <SheetContent className='w-full gap-0 data-[side=right]:sm:max-w-lg'>
        {template ? (
          <TemplateButtonsForm
            // Fresh draft per template.
            key={template.id}
            workspaceId={workspaceId}
            template={template}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function TemplateButtonsForm({
  workspaceId,
  template,
  onDone,
}: {
  workspaceId: string
  template: WhatsAppTemplateDTO
  onDone: () => void
}) {
  const [buttons, setButtons] = useState<WhatsAppButtonDTO[]>(template.buttons)
  const updateButtons = useUpdateWhatsAppTemplateButtons(workspaceId)
  const hasReply = template.buttons.some((button) => button.type === 'REPLY')

  function handleSave() {
    const problem = validateButtons(buttons)
    if (problem) {
      notify.error(problem)
      return
    }
    updateButtons.mutate(
      { templateId: template.id, buttons: normalizeButtons(buttons) },
      {
        onSuccess: () => {
          notify.success('Ações dos botões salvas')
          onDone()
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível salvar as ações'),
      },
    )
  }

  return (
    <>
      <SheetHeader className='border-b pr-12'>
        <SheetTitle className='flex min-w-0 items-center gap-2'>
          <TemplateQualityBadge quality={template.quality} />
          <span className='truncate'>{template.name}</span>
        </SheetTitle>
        <SheetDescription>
          Escolha o que acontece quando o contato clica em cada botão de
          resposta. O texto dos botões vem do template aprovado pela Meta.
        </SheetDescription>
      </SheetHeader>
      <div className='min-h-0 flex-1 overflow-y-auto p-4'>
        <WhatsappButtonsEditor
          workspaceId={workspaceId}
          value={buttons}
          onChange={setButtons}
          lockStructure
        />
      </div>
      <SheetFooter className='flex-row justify-end border-t'>
        <Button variant='ghost' onClick={onDone}>
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasReply || updateButtons.isPending}
        >
          {updateButtons.isPending ? 'Salvando...' : 'Salvar ações'}
        </Button>
      </SheetFooter>
    </>
  )
}
