'use client'

import { type FormEvent, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IdentifyDocumentReaderSchema } from '@/src/schemas/document.schema'
import { type PublicReader, publicDocumentUrl } from './public-runtime'

type MessageBody = { message?: string } | null

/**
 * Asked by the generic link when the document requires identification:
 * name and e-mail before the content shows (`POST /identify`).
 */
export function IdentificationGate({
  token,
  title,
  brandName,
  onIdentified,
}: {
  token: string
  title: string
  brandName: string
  onIdentified: (reader: PublicReader) => void
}) {
  const id = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = IdentifyDocumentReaderSchema.safeParse({ name, email })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise os dados')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(publicDocumentUrl(token, '/identify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as MessageBody
        setError(body?.message ?? 'Não foi possível continuar. Tente de novo.')
        return
      }
      onIdentified(parsed.data)
    } catch {
      setError('Sem conexão. Verifique a internet e tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className='flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10'>
      <form
        onSubmit={(event) => void submit(event)}
        className='grid w-full max-w-sm gap-4 rounded-2xl border bg-background p-6 shadow-sm'
      >
        <div className='grid gap-1'>
          <p className='text-muted-foreground text-xs'>{brandName}</p>
          <h1 className='font-semibold text-lg leading-tight'>{title}</h1>
          <p className='text-muted-foreground text-sm'>
            Para abrir o documento, diga quem você é.
          </p>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-name`}>Nome</Label>
          <Input
            id={`${id}-name`}
            value={name}
            autoComplete='name'
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-email`}>E-mail</Label>
          <Input
            id={`${id}-email`}
            type='email'
            inputMode='email'
            autoComplete='email'
            value={email}
            maxLength={320}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error ? (
          <p role='alert' className='text-destructive text-sm'>
            {error}
          </p>
        ) : null}
        <Button type='submit' size='lg' disabled={busy}>
          {busy ? 'Abrindo…' : 'Abrir documento'}
        </Button>
        <p className='text-center text-muted-foreground text-xs'>
          Seus dados são enviados só para quem compartilhou o documento.
        </p>
      </form>
    </main>
  )
}
