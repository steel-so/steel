'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useUpdateGoogleSettings } from '@/src/hooks/use-crm-google-presence'

const EXAMPLES = [
  'Cordial e próximo, tratando o cliente por você, sem emojis.',
  'Formal e objetivo, com linguagem corporativa.',
  'Descontraído e simpático, com uma ou duas frases curtas.',
]

/** Tone of voice the AI follows when drafting replies and the profile description. */
export function GoogleReplyToneDialog({
  workspaceId,
  currentTone,
  open,
  onOpenChange,
}: {
  workspaceId: string
  currentTone: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateGoogleSettings(workspaceId)
  const [tone, setTone] = useState(currentTone ?? '')

  function save() {
    update.mutate(
      { replyTone: tone.trim() || null },
      {
        onSuccess: () => {
          notify.success('Tom de voz salvo.')
          onOpenChange(false)
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tom de voz da marca</DialogTitle>
          <DialogDescription>
            A IA segue este tom ao sugerir respostas às avaliações e a descrição
            do perfil. Nada é publicado sem você revisar.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='google-reply-tone'>Como a marca fala</Label>
          <Textarea
            id='google-reply-tone'
            rows={4}
            maxLength={500}
            value={tone}
            placeholder={EXAMPLES[0]}
            onChange={(event) => setTone(event.target.value)}
          />
          <div className='flex flex-wrap gap-1.5'>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type='button'
                onClick={() => setTone(example)}
                className='rounded-full border border-border/70 px-2.5 py-1 text-muted-foreground text-xs hover:bg-muted'
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={update.isPending} onClick={save}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
