import { describe, expect, it, vi } from 'vitest'
import {
  scopeFromSnapshot,
  type WhatsAppConversationScope,
} from '@/src/lib/whatsapp/conversation-scope'
import type { WhatsAppRealtimeEvent } from '@/src/lib/whatsapp/realtime'
import {
  createRealtimeScopeFilter,
  createScopeRefresher,
} from '@/src/lib/whatsapp/realtime-scope-filter'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { WhatsAppPhoneCallDTO } from '@/types/whatsapp-phone-call'

const TEAMS = [
  { id: 'sales', members: [{ userId: 'ana', role: 'AGENT' as const }] },
]
const agent = scopeFromSnapshot('ana', 'MEMBER', TEAMS)
const owner = scopeFromSnapshot('own', 'OWNER', TEAMS)

function updated(
  id: string,
  assignedUserId: string | null,
  teamId: string | null = null,
): WhatsAppRealtimeEvent {
  return {
    type: 'conversation.updated',
    conversation: { id, assignedUserId, teamId } as WhatsAppConversationDTO,
  }
}

const message = (conversationId: string): WhatsAppRealtimeEvent => ({
  type: 'message.created',
  conversationId,
  message: { id: 'm1' } as WhatsAppMessageDTO,
})

function filterFor(
  scope: WhatsAppConversationScope | null,
  targets: Record<
    string,
    { assignedUserId: string | null; teamId: string | null }
  > = {},
  maxEntries?: number,
) {
  const loadTarget = vi.fn(async (id: string) => targets[id] ?? null)
  const filter = createRealtimeScopeFilter({
    getScope: async () => scope,
    loadTarget,
    maxEntries,
  })
  return { filter, loadTarget }
}

describe('createRealtimeScopeFilter()', () => {
  it('forwards everything to an unscoped viewer without lookups', async () => {
    const { filter, loadTarget } = filterFor(owner)
    expect(await filter(message('c1'))).toEqual(message('c1'))
    expect(await filter(updated('c1', 'bia'))).toEqual(updated('c1', 'bia'))
    expect(loadTarget).not.toHaveBeenCalled()
  })

  it('drops everything once the viewer lost access', async () => {
    const { filter } = filterFor(null)
    expect(await filter(message('c1'))).toBeNull()
  })

  it('forwards a visible conversation update', async () => {
    const { filter } = filterFor(agent)
    expect(await filter(updated('c1', 'ana'))).toEqual(updated('c1', 'ana'))
  })

  it('turns an update the viewer can no longer see into a deletion, once', async () => {
    const { filter } = filterFor(agent)
    expect(await filter(updated('c1', 'bia'))).toEqual({
      type: 'conversation.deleted',
      conversationId: 'c1',
    })
    expect(await filter(updated('c1', 'bia'))).toBeNull()
    // Visible again (back to the queue): forwarded and forgotten as hidden.
    expect(await filter(updated('c1', null))).toEqual(updated('c1', null))
    expect(await filter(updated('c1', 'bia'))).toEqual({
      type: 'conversation.deleted',
      conversationId: 'c1',
    })
  })

  it('checks messages against a remembered conversation', async () => {
    const { filter, loadTarget } = filterFor(agent)
    await filter(updated('mine', 'ana'))
    await filter(updated('theirs', 'bia'))
    expect(await filter(message('mine'))).toEqual(message('mine'))
    expect(await filter(message('theirs'))).toBeNull()
    expect(loadTarget).not.toHaveBeenCalled()
  })

  it('loads an unknown conversation once and remembers it', async () => {
    const { filter, loadTarget } = filterFor(agent, {
      q: { assignedUserId: null, teamId: 'sales' },
    })
    expect(await filter(message('q'))).toEqual(message('q'))
    expect(await filter(message('q'))).toEqual(message('q'))
    expect(loadTarget).toHaveBeenCalledTimes(1)
  })

  it('drops events of a missing conversation and retries the lookup', async () => {
    const { filter, loadTarget } = filterFor(agent)
    expect(await filter(message('gone'))).toBeNull()
    expect(await filter(message('gone'))).toBeNull()
    expect(loadTarget).toHaveBeenCalledTimes(2)
  })

  it('filters updates/deletions of messages and phone calls too', async () => {
    const { filter } = filterFor(agent, {
      other: { assignedUserId: 'bia', teamId: null },
    })
    const deleted: WhatsAppRealtimeEvent = {
      type: 'message.deleted',
      conversationId: 'other',
      messageId: 'm1',
    }
    const call: WhatsAppRealtimeEvent = {
      type: 'phone-call.updated',
      call: { conversationId: 'other' } as WhatsAppPhoneCallDTO,
    }
    expect(await filter(deleted)).toBeNull()
    expect(await filter(call)).toBeNull()
    expect(
      await filter({
        type: 'message.updated',
        conversationId: 'other',
        message: {} as WhatsAppMessageDTO,
      }),
    ).toBeNull()
  })

  it('shows a call without a conversation only to the user who made it', async () => {
    const { filter, loadTarget } = filterFor(agent)
    const own: WhatsAppRealtimeEvent = {
      type: 'phone-call.updated',
      call: { conversationId: null, userId: 'ana' } as WhatsAppPhoneCallDTO,
    }
    const others: WhatsAppRealtimeEvent = {
      type: 'phone-call.updated',
      call: { conversationId: null, userId: 'bia' } as WhatsAppPhoneCallDTO,
    }
    expect(await filter(own)).toEqual(own)
    expect(await filter(others)).toBeNull()
    expect(loadTarget).not.toHaveBeenCalled()
  })

  it('forwards phone calls to an unscoped viewer and group messages to all', async () => {
    const call: WhatsAppRealtimeEvent = {
      type: 'phone-call.updated',
      call: { conversationId: 'x' } as WhatsAppPhoneCallDTO,
    }
    expect(await filterFor(owner).filter(call)).toEqual(call)
    const group: WhatsAppRealtimeEvent = {
      type: 'group-message.created',
      groupId: 'g1',
    }
    expect(await filterFor(agent).filter(group)).toEqual(group)
  })

  it('forwards deletions and forgets the conversation', async () => {
    const { filter, loadTarget } = filterFor(agent, {
      c1: { assignedUserId: 'ana', teamId: null },
    })
    await filter(updated('c1', 'ana'))
    const deleted: WhatsAppRealtimeEvent = {
      type: 'conversation.deleted',
      conversationId: 'c1',
    }
    expect(await filter(deleted)).toEqual(deleted)
    await filter(message('c1'))
    expect(loadTarget).toHaveBeenCalledTimes(1)
  })

  it('resets its memory past the size cap', async () => {
    const { filter, loadTarget } = filterFor(
      agent,
      { a: { assignedUserId: 'ana', teamId: null } },
      1,
    )
    await filter(updated('a', 'ana'))
    await filter(updated('b', 'ana'))
    await filter(message('a'))
    expect(loadTarget).toHaveBeenCalledWith('a')
  })
})

describe('createScopeRefresher()', () => {
  it('reuses the scope inside the TTL and reloads after it', async () => {
    let now = 0
    const load = vi.fn(async () => ({ ok: true as const, value: owner }))
    const get = createScopeRefresher(agent, load, 1000, () => now)

    expect(await get()).toBe(agent)
    now = 1500
    expect(await get()).toBe(owner)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps the last scope when the reload fails, and honours a revocation', async () => {
    let now = 0
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, value: null })
    const get = createScopeRefresher(agent, load, 10, () => now)

    now = 20
    expect(await get()).toBe(agent)
    now = 40
    expect(await get()).toBeNull()
  })

  it('defaults to the wall clock', async () => {
    const get = createScopeRefresher(agent, vi.fn(), 60_000)
    expect(await get()).toBe(agent)
  })
})

describe('createRealtimeScopeFilter() · Pix charges', () => {
  const pix = (conversationId: string): WhatsAppRealtimeEvent => ({
    type: 'pix-charge.updated',
    conversationId,
    charge: { id: 'ch1' } as never,
  })

  it('forwards a charge only to viewers who can see its conversation', async () => {
    const { filter } = filterFor(agent, {
      mine: { assignedUserId: 'ana', teamId: null },
      theirs: { assignedUserId: 'bia', teamId: null },
    })
    expect(await filter(pix('mine'))).toEqual(pix('mine'))
    expect(await filter(pix('theirs'))).toBeNull()
  })

  it('forwards it to an unscoped viewer without a lookup', async () => {
    const { filter, loadTarget } = filterFor(owner)
    expect(await filter(pix('any'))).toEqual(pix('any'))
    expect(loadTarget).not.toHaveBeenCalled()
  })
})
