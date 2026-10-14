'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** Someone with the page open, read from the Yjs awareness. */
export interface WikiPresenceUser {
  id: string
  name: string
  image: string | null
  color: string
}

const MAX_VISIBLE = 3

/**
 * Turns the awareness states (one per open tab) into people: the editor
 * publishes `{ id, name, image, color }` under `data`; the same person in two
 * tabs shows once. States without an id (older clients) fall back to the name.
 */
export function presenceFromAwareness(
  states: Iterable<Record<string, unknown>>,
): WikiPresenceUser[] {
  const people = new Map<string, WikiPresenceUser>()
  for (const state of states) {
    const data = state?.data as Record<string, unknown> | undefined
    if (!data || typeof data.name !== 'string') continue
    const id = typeof data.id === 'string' ? data.id : `name:${data.name}`
    if (people.has(id)) continue
    people.set(id, {
      id,
      name: data.name,
      image: typeof data.image === 'string' ? data.image : null,
      color: typeof data.color === 'string' ? data.color : 'currentColor',
    })
  }
  return [...people.values()]
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

function PersonAvatar({
  person,
  label,
}: {
  person: WikiPresenceUser
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Avatar
            size='sm'
            aria-label={label}
            className='ring-2 ring-background'
            style={{ boxShadow: `0 0 0 1px ${person.color}` }}
          />
        }
      >
        {person.image && <AvatarImage src={person.image} alt='' />}
        <AvatarFallback className='text-[10px]'>
          {initials(person.name)}
        </AvatarFallback>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Overlapping avatars of who is on the page now, with "+N" past three. */
export function WikiPresence({
  users,
  selfId,
}: {
  users: WikiPresenceUser[]
  selfId: string
}) {
  if (users.length === 0) return null
  const visible = users.slice(0, MAX_VISIBLE)
  const hidden = users.slice(MAX_VISIBLE)
  const labelOf = (person: WikiPresenceUser) =>
    person.id === selfId ? `${person.name} (você)` : person.name

  return (
    <ul
      aria-label='Pessoas nesta página'
      className='flex shrink-0 items-center -space-x-1.5'
    >
      {visible.map((person) => (
        <li key={person.id} className='flex'>
          <PersonAvatar person={person} label={labelOf(person)} />
        </li>
      ))}
      {hidden.length > 0 && (
        <li className='flex'>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role='img'
                  className='relative flex size-6 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-foreground ring-2 ring-background'
                  aria-label={`Mais ${hidden.length} pessoas`}
                />
              }
            >
              +{hidden.length}
            </TooltipTrigger>
            <TooltipContent>{hidden.map(labelOf).join(', ')}</TooltipContent>
          </Tooltip>
        </li>
      )}
    </ul>
  )
}
