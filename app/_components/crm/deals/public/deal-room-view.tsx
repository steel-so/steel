'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  DealRoomVisitorSessionDTO,
  PublicDealRoomDTO,
} from '@/types/crm-deals'
import { formatDealDate, formatDealDateTime } from '../deals-tone'

const POLL_MS = 10_000
const OWNER_LABEL = { SELLER: 'Nós', CUSTOMER: 'Você' } as const

interface StoredVisitor {
  visitorId: string
  name: string
  email: string
}

const storageKey = (token: string) => `deal-room:${token}`

function readStored(token: string): StoredVisitor | null {
  try {
    const raw = window.localStorage.getItem(storageKey(token))
    return raw ? (JSON.parse(raw) as StoredVisitor) : null
  } catch {
    return null
  }
}

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    return res.ok && json?.success ? (json.data as T) : null
  } catch {
    return null
  }
}

/**
 * Sala de negociação vista pelo cliente. O link é o acesso; a pessoa diz o
 * nome e o e-mail na primeira vez (para o vendedor saber quem abriu o quê) e
 * depois vê a proposta, os materiais, o plano de ação em conjunto e a
 * conversa. A tela consulta a sala a cada poucos segundos.
 */
export function DealRoomView({
  token,
  initial,
}: {
  token: string
  initial: PublicDealRoomDTO
}) {
  const api = `/api/crm/deal-rooms/${token}`
  const [room, setRoom] = useState(initial)
  const [visitor, setVisitor] = useState<DealRoomVisitorSessionDTO | null>(null)
  const [checked, setChecked] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const opened = useRef(false)

  const identify = useCallback(
    async (person: { name: string; email: string }) => {
      const session = await post<DealRoomVisitorSessionDTO>(
        `${api}/visitors`,
        person,
      )
      if (!session) return false
      window.localStorage.setItem(
        storageKey(token),
        JSON.stringify({ ...session, email: person.email }),
      )
      setVisitor(session)
      return true
    },
    [api, token],
  )

  // A returning visitor is recognised (and the new opening is logged).
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    const stored = readStored(token)
    if (stored) void identify({ name: stored.name, email: stored.email })
    setChecked(true)
  }, [token, identify])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api)
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) setRoom(json.data as PublicDealRoomDTO)
    } catch {
      // The next tick tries again.
    }
  }, [api])

  useEffect(() => {
    if (!visitor) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [visitor, refresh])

  function track(kind: 'PROPOSAL_VIEWED' | 'MATERIAL_OPENED', targetId?: string) {
    if (!visitor) return
    void post(`${api}/events`, {
      visitorId: visitor.visitorId,
      kind,
      ...(targetId && { targetId }),
    })
  }

  async function handleIdentify() {
    setError(null)
    if (name.trim().length < 2 || !email.includes('@')) {
      setError('Informe o seu nome e um e-mail válido.')
      return
    }
    const ok = await identify({ name: name.trim(), email: email.trim() })
    if (!ok) setError('Não foi possível entrar na sala. Tente novamente.')
  }

  async function toggleAction(actionId: string, done: boolean) {
    if (!visitor) return
    try {
      const res = await fetch(`${api}/actions/${actionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitor.visitorId, done }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        setRoom((current) => ({ ...current, actions: json.data }))
      }
    } catch {
      setError('Não foi possível atualizar o plano. Tente novamente.')
    }
  }

  async function sendMessage() {
    if (!visitor || !message.trim()) return
    setSending(true)
    const created = await post(`${api}/messages`, {
      visitorId: visitor.visitorId,
      body: message.trim(),
    })
    setSending(false)
    if (!created) {
      setError('Não foi possível enviar a mensagem.')
      return
    }
    setMessage('')
    void refresh()
  }

  if (!checked) return null

  if (!visitor) {
    return (
      <main className='mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-4 px-6 py-12'>
        <div>
          <p className='text-muted-foreground text-sm'>{room.workspaceName}</p>
          <h1 className='font-semibold text-xl'>{room.title}</h1>
          {room.companyName ? (
            <p className='text-muted-foreground text-sm'>{room.companyName}</p>
          ) : null}
        </div>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='room-name'>Seu nome</Label>
            <Input
              id='room-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='room-email'>Seu e-mail</Label>
            <Input
              id='room-email'
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <p className='text-muted-foreground text-xs'>
            Usamos o seu nome e e-mail para a equipe saber quem está
            acompanhando esta negociação.
          </p>
          {error ? (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          ) : null}
          <Button onClick={handleIdentify}>Entrar na sala</Button>
        </div>
      </main>
    )
  }

  return (
    <main className='mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-8 px-6 py-10'>
      <header>
        <p className='text-muted-foreground text-sm'>{room.workspaceName}</p>
        <h1 className='font-semibold text-2xl'>{room.title}</h1>
        {room.companyName ? (
          <p className='text-muted-foreground text-sm'>{room.companyName}</p>
        ) : null}
        {room.welcomeMessage ? (
          <p className='mt-3 whitespace-pre-wrap text-sm'>
            {room.welcomeMessage}
          </p>
        ) : null}
        <p className='mt-2 text-muted-foreground text-xs'>
          Você entrou como {visitor.name}.
        </p>
      </header>

      {room.proposal ? (
        <section className='flex flex-col gap-2'>
          <h2 className='font-semibold text-base'>Proposta</h2>
          <a
            className='text-primary underline-offset-2 hover:underline'
            href={room.proposal.sharePath}
            target='_blank'
            rel='noreferrer'
            onClick={() => track('PROPOSAL_VIEWED')}
          >
            {room.proposal.name}
          </a>
        </section>
      ) : null}

      {room.materials.length > 0 ? (
        <section className='flex flex-col gap-2'>
          <h2 className='font-semibold text-base'>Materiais</h2>
          <ul className='flex flex-col gap-1.5'>
            {room.materials.map((material) => (
              <li key={material.id}>
                <a
                  className='text-primary underline-offset-2 hover:underline'
                  href={material.url}
                  target='_blank'
                  rel='noreferrer noopener'
                  onClick={() => track('MATERIAL_OPENED', material.id)}
                >
                  {material.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {room.actions.length > 0 ? (
        <section className='flex flex-col gap-2'>
          <h2 className='font-semibold text-base'>Plano de ação</h2>
          <ul className='flex flex-col gap-2'>
            {room.actions.map((action) => (
              <li key={action.id} className='flex items-start gap-2 text-sm'>
                <Checkbox
                  checked={action.done}
                  disabled={action.owner !== 'CUSTOMER'}
                  aria-label={action.title}
                  onCheckedChange={(value) =>
                    toggleAction(action.id, value === true)
                  }
                />
                <div className='flex flex-col'>
                  <span className={action.done ? 'line-through' : undefined}>
                    {action.title}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    Responsável: {OWNER_LABEL[action.owner]}
                    {action.dueDate
                      ? ` · até ${formatDealDate(action.dueDate)}`
                      : ''}
                    {action.done && action.doneByLabel
                      ? ` · feita por ${action.doneByLabel}`
                      : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className='flex flex-col gap-2'>
        <h2 className='font-semibold text-base'>Conversa</h2>
        <ul className='flex max-h-80 flex-col gap-1.5 overflow-auto'>
          {room.messages.length === 0 ? (
            <li className='py-2 text-muted-foreground text-sm'>
              Escreva aqui para falar com a equipe.
            </li>
          ) : (
            room.messages.map((item) => (
              <li
                key={item.id}
                className={
                  item.authorKind === 'CUSTOMER'
                    ? 'ml-6 rounded-md bg-primary/10 px-3 py-1.5 text-sm'
                    : 'mr-6 rounded-md bg-muted px-3 py-1.5 text-sm'
                }
              >
                <span className='font-medium'>{item.authorName}</span>
                <span className='ml-2 text-muted-foreground text-xs'>
                  {formatDealDateTime(item.createdAt)}
                </span>
                <p className='whitespace-pre-wrap'>{item.body}</p>
              </li>
            ))
          )}
        </ul>
        <div className='flex gap-2'>
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendMessage()
            }}
            placeholder='Escreva a sua mensagem'
            maxLength={2000}
          />
          <Button onClick={sendMessage} disabled={sending || !message.trim()}>
            Enviar
          </Button>
        </div>
        {error ? (
          <p role='alert' className='text-destructive text-sm'>
            {error}
          </p>
        ) : null}
      </section>
    </main>
  )
}
