'use client'

import { Cancel01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import {
  TRIGGER_DESCRIPTION,
  TRIGGER_LABEL,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import {
  CHATBOT_LIMITS,
  CHATBOT_TRIGGERS,
  type ChatbotTrigger,
} from '@/src/schemas/whatsapp-chatbot.schema'

export interface ChatbotSettingsValue {
  triggerKind: ChatbotTrigger
  keywords: string[]
  /** `''` = every connection of the workspace. */
  connectionId: string
  sessionTtlMinutes: number
}

const ALL_CONNECTIONS = 'all'

/** Trigger, keywords, connection and session timeout of a bot. */
export function ChatbotSettingsFields({
  workspaceId,
  value,
  onChange,
  disabled,
}: {
  workspaceId: string
  value: ChatbotSettingsValue
  onChange: (next: ChatbotSettingsValue) => void
  disabled?: boolean
}) {
  const connections = useWhatsAppConnections(workspaceId)
  const [draft, setDraft] = useState('')

  const addKeyword = () => {
    const word = draft.trim()
    setDraft('')
    if (!word) return
    const exists = value.keywords.some(
      (item) => item.toLowerCase() === word.toLowerCase(),
    )
    if (exists || value.keywords.length >= CHATBOT_LIMITS.keywords) return
    onChange({ ...value, keywords: [...value.keywords, word] })
  }

  const list = connections.data ?? []

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <Label>Quando o chatbot começa</Label>
        <Select
          value={value.triggerKind}
          onValueChange={(next) =>
            next && onChange({ ...value, triggerKind: next as ChatbotTrigger })
          }
          disabled={disabled}
        >
          <SelectTrigger className='w-full' aria-label='Gatilho'>
            <SelectValue>{TRIGGER_LABEL[value.triggerKind]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {CHATBOT_TRIGGERS.map((trigger) => (
                <SelectItem key={trigger} value={trigger}>
                  {TRIGGER_LABEL[trigger]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className='text-muted-foreground text-xs'>
          {TRIGGER_DESCRIPTION[value.triggerKind]}
        </p>
      </div>

      {value.triggerKind === 'KEYWORD' ? (
        <div className='space-y-1.5'>
          <Label htmlFor='chatbot-keyword'>Palavras-chave</Label>
          <div className='flex gap-2'>
            <Input
              id='chatbot-keyword'
              value={draft}
              maxLength={60}
              disabled={disabled}
              placeholder='Ex.: orçamento'
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault()
                  addKeyword()
                }
              }}
            />
            <Button
              type='button'
              variant='outline'
              disabled={disabled || !draft.trim()}
              onClick={addKeyword}
            >
              Adicionar
            </Button>
          </div>
          <div className='flex flex-wrap gap-1.5'>
            {value.keywords.map((word) => (
              <Badge key={word} variant='secondary' className='gap-1'>
                {word}
                <button
                  type='button'
                  aria-label={`Remover ${word}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      keywords: value.keywords.filter((k) => k !== word),
                    })
                  }
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label>Conexão</Label>
          <Select
            value={value.connectionId || ALL_CONNECTIONS}
            onValueChange={(next) =>
              onChange({
                ...value,
                connectionId: !next || next === ALL_CONNECTIONS ? '' : next,
              })
            }
            disabled={disabled}
          >
            <SelectTrigger className='w-full' aria-label='Conexão'>
              <SelectValue>
                {value.connectionId
                  ? (list.find((c) => c.id === value.connectionId)?.label ??
                    'Conexão')
                  : 'Todas as conexões'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_CONNECTIONS}>
                  Todas as conexões
                </SelectItem>
                {list.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='chatbot-ttl'>
            Expira após (minutos sem resposta)
          </Label>
          <Input
            id='chatbot-ttl'
            type='number'
            min={5}
            max={10080}
            value={value.sessionTtlMinutes}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                sessionTtlMinutes: Number(event.target.value) || 5,
              })
            }
          />
        </div>
      </div>
    </div>
  )
}
