'use client'

import {
  Cancel01Icon,
  CloudUploadIcon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type ChangeEvent, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useUploadWhatsAppMedia } from '@/src/hooks/use-whatsapp-media-upload'
import { useCreateWhatsAppTemplate } from '@/src/hooks/use-whatsapp-templates'
import {
  headerMediaProblem,
  normalizeButtons,
  TEMPLATE_HEADER_MEDIA,
  TEMPLATE_HEADER_OPTIONS,
  type TemplateHeaderChoice,
  validateButtons,
} from '@/src/lib/whatsapp/button-editor'
import {
  countPlaceholders,
  renderTemplateText,
} from '@/src/lib/whatsapp/template-variables'
import {
  WHATSAPP_TEMPLATE_CATEGORIES,
  type WhatsAppTemplateCategory,
} from '@/src/schemas/whatsapp-template.schema'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import { WhatsappButtonsEditor } from './buttons/whatsapp-buttons-editor'
import {
  type PreviewHeader,
  WhatsappBubblePreview,
} from './whatsapp-bubble-preview'

const CATEGORY_LABEL: Record<WhatsAppTemplateCategory, string> = {
  UTILITY: 'Utilidade (lembretes, confirmações)',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticação',
}

const MEDIA_ACTION_LABEL = {
  IMAGE: 'Enviar imagem',
  VIDEO: 'Enviar vídeo',
  DOCUMENT: 'Enviar PDF',
} as const

type MediaFormat = keyof typeof MEDIA_ACTION_LABEL

interface HeaderMedia {
  name: string
  url: string
}

export function CreateTemplateDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [language, setLanguage] = useState('pt_BR')
  const [category, setCategory] = useState<WhatsAppTemplateCategory>('UTILITY')
  const [headerChoice, setHeaderChoice] = useState<TemplateHeaderChoice>('NONE')
  const [headerText, setHeaderText] = useState('')
  const [headerMedia, setHeaderMedia] = useState<HeaderMedia | null>(null)
  const [body, setBody] = useState('')
  const [bodyExample, setBodyExample] = useState<Record<number, string>>({})
  const [footer, setFooter] = useState('')
  const [buttons, setButtons] = useState<WhatsAppButtonDTO[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const bodyVariableCount = countPlaceholders(body)

  const connections = useWhatsAppConnections(workspaceId)
  const metaConnections = (connections.data ?? []).filter(
    (connection) => connection.provider === 'META',
  )
  const createTemplate = useCreateWhatsAppTemplate(workspaceId)
  const uploadMedia = useUploadWhatsAppMedia(workspaceId)

  const mediaFormat: MediaFormat | null =
    headerChoice === 'NONE' || headerChoice === 'TEXT' ? null : headerChoice

  function reset() {
    setName('')
    setConnectionId(undefined)
    setLanguage('pt_BR')
    setCategory('UTILITY')
    setHeaderChoice('NONE')
    setHeaderText('')
    setHeaderMedia(null)
    setBody('')
    setBodyExample({})
    setFooter('')
    setButtons([])
  }

  function chooseHeader(choice: TemplateHeaderChoice) {
    if (choice === headerChoice) return
    setHeaderChoice(choice)
    // A sample uploaded for another format no longer fits.
    setHeaderMedia(null)
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !mediaFormat) return
    const problem = headerMediaProblem(mediaFormat, file)
    if (problem) {
      notify.error(problem)
      return
    }
    uploadMedia.mutate(file, {
      onSuccess: (uploaded) =>
        setHeaderMedia({ name: file.name, url: uploaded.url }),
      onError: (error) => notify.error(error, 'Erro ao enviar o arquivo'),
    })
  }

  async function handleCreate() {
    if (!connectionId) {
      notify.error('Selecione a conexão Meta.')
      return
    }
    if (!name.trim() || !body.trim()) {
      notify.error('Informe o nome e o corpo da mensagem.')
      return
    }
    if (headerChoice === 'TEXT' && !headerText.trim()) {
      notify.error('Escreva o texto do cabeçalho ou escolha "Nenhum".')
      return
    }
    if (mediaFormat && !headerMedia) {
      notify.error('Envie o arquivo de exemplo do cabeçalho.')
      return
    }
    const missingExample = Array.from(
      { length: bodyVariableCount },
      (_, i) => i + 1,
    ).some((i) => !bodyExample[i]?.trim())
    if (missingExample) {
      notify.error('Preencha um valor de exemplo para cada variável do corpo.')
      return
    }
    const buttonsProblem = validateButtons(buttons)
    if (buttonsProblem) {
      notify.error(buttonsProblem)
      return
    }

    try {
      await createTemplate.mutateAsync({
        connectionId,
        name: name.trim(),
        language,
        category,
        ...(headerChoice === 'TEXT'
          ? { headerFormat: 'TEXT' as const, headerText: headerText.trim() }
          : {}),
        ...(mediaFormat && headerMedia
          ? { headerFormat: mediaFormat, headerMediaUrl: headerMedia.url }
          : {}),
        body: body.trim(),
        bodyExample:
          bodyVariableCount > 0
            ? Array.from(
                { length: bodyVariableCount },
                (_, i) => bodyExample[i + 1]?.trim() ?? '',
              )
            : undefined,
        footer: footer.trim() || undefined,
        buttons: buttons.length > 0 ? normalizeButtons(buttons) : undefined,
      })
      notify.success('Template enviado para aprovação da Meta')
      setOpen(false)
      reset()
    } catch (err) {
      notify.error(err, 'Não foi possível criar o template.')
    }
  }

  let previewHeader: PreviewHeader | null = null
  if (headerChoice === 'TEXT' && headerText.trim()) {
    previewHeader = { format: 'TEXT', text: headerText }
  } else if (mediaFormat) {
    previewHeader = {
      format: mediaFormat,
      url: headerMedia?.url,
      fileName: headerMedia?.name,
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        setOpen(next)
      }}
    >
      <DialogTrigger
        render={
          <Button size='sm'>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
            Novo template
          </Button>
        }
      />
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>Novo template</DialogTitle>
          <DialogDescription>
            Enviado para aprovação da Meta — normalmente leva algumas horas
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]'>
          <div className='min-w-0 space-y-4'>
            <div className='space-y-1.5'>
              <Label>Conexão Meta</Label>
              <Select
                value={connectionId ?? null}
                onValueChange={(value) => setConnectionId(value ?? undefined)}
              >
                <SelectTrigger className='w-full' aria-label='Conexão Meta'>
                  <SelectValue>
                    {(value: string | null) =>
                      metaConnections.find((c) => c.id === value)?.label ?? (
                        <span className='text-muted-foreground'>
                          Selecione a conexão
                        </span>
                      )
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {metaConnections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]'>
              <div className='space-y-1.5'>
                <Label htmlFor='template-name'>Nome (snake_case)</Label>
                <Input
                  id='template-name'
                  value={name}
                  onChange={(e) =>
                    setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))
                  }
                  placeholder='confirmacao_exame'
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='template-language'>Idioma</Label>
                <Input
                  id='template-language'
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder='pt_BR'
                />
              </div>
            </div>

            <div className='space-y-1.5'>
              <Label>Categoria</Label>
              <Select
                value={category}
                onValueChange={(value) =>
                  value && setCategory(value as WhatsAppTemplateCategory)
                }
              >
                <SelectTrigger className='w-full' aria-label='Categoria'>
                  <SelectValue>
                    {(value: WhatsAppTemplateCategory) => CATEGORY_LABEL[value]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {WHATSAPP_TEMPLATE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <fieldset className='space-y-2'>
              <legend className='mb-1.5 font-medium text-sm'>Cabeçalho</legend>
              <div className='flex flex-wrap gap-1 rounded-lg bg-muted p-1'>
                {TEMPLATE_HEADER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    aria-pressed={headerChoice === option.value}
                    onClick={() => chooseHeader(option.value)}
                    className={cn(
                      'flex-1 rounded-md px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground',
                      headerChoice === option.value &&
                        'bg-background text-foreground shadow-sm',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {headerChoice === 'TEXT' ? (
                <Input
                  value={headerText}
                  maxLength={60}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder='Confirmação de exame'
                  aria-label='Texto do cabeçalho'
                />
              ) : null}
              {mediaFormat ? (
                <div className='space-y-1.5'>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept={TEMPLATE_HEADER_MEDIA[mediaFormat].accept}
                    className='hidden'
                    aria-label='Arquivo do cabeçalho'
                    onChange={handleFile}
                  />
                  {headerMedia ? (
                    <div className='flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm'>
                      <span className='min-w-0 flex-1 truncate'>
                        {headerMedia.name}
                      </span>
                      <Button
                        type='button'
                        variant='ghost'
                        size='xs'
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Trocar
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-xs'
                        aria-label='Remover arquivo do cabeçalho'
                        onClick={() => setHeaderMedia(null)}
                      >
                        <SteelIcon icon={Cancel01Icon} size={14} />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type='button'
                      disabled={uploadMedia.isPending}
                      onClick={() => fileInputRef.current?.click()}
                      className='flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-muted-foreground text-xs transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60'
                    >
                      <SteelIcon icon={CloudUploadIcon} size={20} />
                      <span className='font-medium text-foreground text-sm'>
                        {uploadMedia.isPending
                          ? 'Enviando…'
                          : MEDIA_ACTION_LABEL[mediaFormat]}
                      </span>
                      {TEMPLATE_HEADER_MEDIA[mediaFormat].hint}
                    </button>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    A Meta usa o arquivo como exemplo na aprovação, e ele vai
                    junto em todo envio do template.
                  </p>
                </div>
              ) : null}
            </fieldset>

            <div className='space-y-1.5'>
              <Label htmlFor='template-body'>Corpo da mensagem</Label>
              <Textarea
                id='template-body'
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='Olá {{1}}, confirmando seu exame de {{2}} agendado para amanhã.'
                rows={4}
              />
              <p className='text-muted-foreground text-xs'>
                Use {'{{1}}'}, {'{{2}}'}... para variáveis preenchidas no envio
              </p>
            </div>

            {bodyVariableCount > 0 && (
              <div className='space-y-2 rounded-md border p-2.5'>
                <p className='text-muted-foreground text-xs'>
                  A Meta exige um valor de exemplo por variável para aprovar o
                  template
                </p>
                <div className='grid gap-2 sm:grid-cols-2'>
                  {Array.from({ length: bodyVariableCount }, (_, i) => (
                    <div key={`body-example-${i + 1}`} className='space-y-1'>
                      <Label>Exemplo de {`{{${i + 1}}}`}</Label>
                      <Input
                        value={bodyExample[i + 1] ?? ''}
                        onChange={(e) =>
                          setBodyExample((prev) => ({
                            ...prev,
                            [i + 1]: e.target.value,
                          }))
                        }
                        placeholder={i === 0 ? 'Maria' : 'Hemograma completo'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className='space-y-1.5'>
              <Label htmlFor='template-footer'>Rodapé (opcional)</Label>
              <Input
                id='template-footer'
                value={footer}
                maxLength={60}
                onChange={(e) => setFooter(e.target.value)}
                placeholder='Responda em até 24h'
              />
            </div>

            <WhatsappButtonsEditor
              workspaceId={workspaceId}
              value={buttons}
              onChange={setButtons}
            />
          </div>

          <div className='md:sticky md:top-0 md:self-start'>
            <p className='mb-2 font-medium text-muted-foreground text-xs'>
              Prévia de como o cliente vai receber
            </p>
            <WhatsappBubblePreview
              header={previewHeader}
              body={renderTemplateText(body, bodyExample)}
              footer={footer}
              buttons={buttons.map((button) => ({
                type: button.type,
                label: button.label,
              }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createTemplate.isPending || uploadMedia.isPending}
          >
            {createTemplate.isPending ? 'Enviando...' : 'Enviar para aprovação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
