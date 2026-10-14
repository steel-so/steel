'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
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
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useCreateWhatsAppTemplate } from '@/src/hooks/use-whatsapp-templates'
import {
  countPlaceholders,
  extractTemplateFillableFields,
  type MetaTemplateButton,
} from '@/src/lib/whatsapp/template-variables'
import {
  WHATSAPP_TEMPLATE_CATEGORIES,
  type WhatsAppTemplateCategory,
} from '@/src/schemas/whatsapp-template.schema'
import { TemplatePreview } from './template-preview'

const CATEGORY_LABEL: Record<WhatsAppTemplateCategory, string> = {
  UTILITY: 'Utilidade (lembretes, confirmações)',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticação',
}

type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'

interface ButtonDraft {
  type: ButtonType
  text: string
  url?: string
  phone_number?: string
}

const MAX_BUTTONS = 3

function emptyButton(): ButtonDraft {
  return { type: 'QUICK_REPLY', text: '' }
}

function toMetaButton(draft: ButtonDraft): MetaTemplateButton {
  if (draft.type === 'URL') {
    return { type: 'URL', text: draft.text, url: draft.url ?? '' }
  }
  if (draft.type === 'PHONE_NUMBER') {
    return {
      type: 'PHONE_NUMBER',
      text: draft.text,
      phone_number: draft.phone_number ?? '',
    }
  }
  return { type: 'QUICK_REPLY', text: draft.text }
}

export function CreateTemplateDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [language, setLanguage] = useState('pt_BR')
  const [category, setCategory] = useState<WhatsAppTemplateCategory>('UTILITY')
  const [headerText, setHeaderText] = useState('')
  const [body, setBody] = useState('')
  const [bodyExample, setBodyExample] = useState<Record<number, string>>({})
  const [footer, setFooter] = useState('')
  const [buttons, setButtons] = useState<ButtonDraft[]>([])

  const bodyVariableCount = countPlaceholders(body)

  const connections = useWhatsAppConnections(workspaceId)
  const metaConnections = (connections.data ?? []).filter(
    (connection) => connection.provider === 'META',
  )
  const createTemplate = useCreateWhatsAppTemplate(workspaceId)

  const previewFields = useMemo(
    () =>
      extractTemplateFillableFields([
        ...(headerText
          ? [
              {
                type: 'HEADER' as const,
                format: 'TEXT' as const,
                text: headerText,
              },
            ]
          : []),
        { type: 'BODY' as const, text: body },
        ...(footer ? [{ type: 'FOOTER' as const, text: footer }] : []),
        ...(buttons.length > 0
          ? [{ type: 'BUTTONS' as const, buttons: buttons.map(toMetaButton) }]
          : []),
      ]),
    [headerText, body, footer, buttons],
  )

  function reset() {
    setName('')
    setConnectionId(undefined)
    setLanguage('pt_BR')
    setCategory('UTILITY')
    setHeaderText('')
    setBody('')
    setBodyExample({})
    setFooter('')
    setButtons([])
  }

  function updateButton(index: number, patch: Partial<ButtonDraft>) {
    setButtons((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    )
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
    const missingExample = Array.from(
      { length: bodyVariableCount },
      (_, i) => i + 1,
    ).some((i) => !bodyExample[i]?.trim())
    if (missingExample) {
      notify.error('Preencha um valor de exemplo para cada variável do corpo.')
      return
    }

    try {
      await createTemplate.mutateAsync({
        connectionId,
        name: name.trim(),
        language,
        category,
        headerText: headerText.trim() || undefined,
        body: body.trim(),
        bodyExample:
          bodyVariableCount > 0
            ? Array.from(
                { length: bodyVariableCount },
                (_, i) => bodyExample[i + 1]?.trim() ?? '',
              )
            : undefined,
        footer: footer.trim() || undefined,
        // Contract shim until the UI slice rewrites this dialog: phone
        // buttons are no longer offered (product cap is 2 reply/link).
        buttons:
          buttons.length > 0
            ? buttons
                .filter((b) => b.type !== 'PHONE_NUMBER')
                .map((b, index) =>
                  b.type === 'URL'
                    ? {
                        id: `b${index + 1}`,
                        type: 'URL' as const,
                        label: b.text,
                        url: b.url ?? '',
                      }
                    : {
                        id: `b${index + 1}`,
                        type: 'REPLY' as const,
                        label: b.text,
                        actions: [],
                      },
                )
            : undefined,
      })
      notify.success('Template enviado para aprovação da Meta')
      setOpen(false)
      reset()
    } catch (err) {
      notify.error(err, 'Não foi possível criar o template.')
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
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Novo template</DialogTitle>
          <DialogDescription>
            Enviado para aprovação da Meta — normalmente leva algumas horas
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 md:grid-cols-2'>
          <div className='max-h-[60vh] space-y-3 overflow-y-auto pr-1'>
            <div className='space-y-1.5'>
              <Label>Conexão Meta</Label>
              <Select
                value={connectionId}
                onValueChange={(value) => setConnectionId(value ?? undefined)}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Selecione a conexão' />
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

            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1.5'>
                <Label>Nome (snake_case)</Label>
                <Input
                  value={name}
                  onChange={(e) =>
                    setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))
                  }
                  placeholder='confirmacao_exame'
                />
              </div>
              <div className='space-y-1.5'>
                <Label>Idioma</Label>
                <Input
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
                <SelectTrigger className='w-full'>
                  <SelectValue />
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

            <div className='space-y-1.5'>
              <Label>Cabeçalho (opcional)</Label>
              <Input
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder='Confirmação de exame'
              />
            </div>

            <div className='space-y-1.5'>
              <Label>Corpo da mensagem</Label>
              <Textarea
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
              <div className='space-y-2 rounded-md border p-2'>
                <p className='text-muted-foreground text-xs'>
                  A Meta exige um valor de exemplo por variável para aprovar o
                  template
                </p>
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
            )}

            <div className='space-y-1.5'>
              <Label>Rodapé (opcional)</Label>
              <Input
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder='Responda em até 24h'
              />
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label>Botões (opcional)</Label>
                {buttons.length < MAX_BUTTONS && (
                  <Button
                    type='button'
                    variant='outline'
                    size='icon-xs'
                    aria-label='Adicionar botão'
                    onClick={() =>
                      setButtons((prev) => [...prev, emptyButton()])
                    }
                  >
                    <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
                  </Button>
                )}
              </div>
              {buttons.map((button, index) => (
                <div key={index} className='space-y-2 rounded-md border p-2'>
                  <div className='flex items-center gap-2'>
                    <Select
                      value={button.type}
                      onValueChange={(value) =>
                        value &&
                        updateButton(index, { type: value as ButtonType })
                      }
                    >
                      <SelectTrigger className='w-36'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          <SelectItem value='QUICK_REPLY'>
                            Resposta rápida
                          </SelectItem>
                          <SelectItem value='URL'>Link</SelectItem>
                          <SelectItem value='PHONE_NUMBER'>Telefone</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Input
                      value={button.text}
                      onChange={(e) =>
                        updateButton(index, { text: e.target.value })
                      }
                      placeholder='Confirmar'
                      className='flex-1'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-xs'
                      aria-label='Remover botão'
                      onClick={() =>
                        setButtons((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                    </Button>
                  </div>
                  {button.type === 'URL' && (
                    <Input
                      value={button.url ?? ''}
                      onChange={(e) =>
                        updateButton(index, { url: e.target.value })
                      }
                      placeholder='https://...'
                    />
                  )}
                  {button.type === 'PHONE_NUMBER' && (
                    <Input
                      value={button.phone_number ?? ''}
                      onChange={(e) =>
                        updateButton(index, { phone_number: e.target.value })
                      }
                      placeholder='5511999999999'
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className='mb-2 text-muted-foreground text-xs'>
              Prévia de como o cliente vai receber
            </p>
            <TemplatePreview
              fields={previewFields}
              values={{ header: {}, body: {}, buttons: {} }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={createTemplate.isPending}>
            {createTemplate.isPending ? 'Enviando...' : 'Enviar para aprovação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
