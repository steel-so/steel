import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authenticatedOwner, defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { fakeVoiceAgentSecret } from '@/src/__tests__/helpers/fake-tokens'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const SECRET = fakeVoiceAgentSecret()
const OTHER_SECRET = fakeVoiceAgentSecret('y')
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

function post(path: string, fields: Record<string, string>) {
  return fetch(`${BASE_URL}/api/pabx/voice-agent/${path}`, {
    method: 'POST',
    headers: { Origin: defaultHeaders.Origin },
    body: new URLSearchParams(fields),
  })
}

async function seedWorkspaceSettings(
  workspaceId: string,
  userId: string,
  overrides: { enabled?: boolean; secret?: string | null } = {},
) {
  await prisma.voiceAgentSettings.create({
    data: {
      workspaceId,
      enabled: overrides.enabled ?? true,
      runAsUserId: userId,
      fallbackTarget: '200',
      pabxSecretHash:
        overrides.secret === null ? null : sha(overrides.secret ?? SECRET),
    },
  })
}

async function seedVoiceCall(
  workspaceId: string,
  userId: string,
  transferTarget: string | null,
) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Principal',
      phoneNumber: `5511${suffix()}`,
      zapiInstanceId: `inst-${suffix()}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId, waId: `5511${suffix()}` },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: { workspaceId, connectionId: connection.id, contactId: contact.id },
  })
  const session = crypto.randomUUID()
  const call = await prisma.whatsAppPhoneCall.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      deviceId: 'voice-agent',
      extension: 'suporte',
      destination: '5511999998888',
      callbackTokenHash: sha(session),
      voiceAgent: true,
      voiceTransferTarget: transferTarget,
    },
  })
  return { session, call }
}

describe('POST /api/pabx/voice-agent/session', () => {
  const caller = { caller: '11999998888', queue: 'suporte' }

  it('rejects a workspace without settings or with another secret', async () => {
    const { workspace } = await authenticatedOwner()
    const none = await post('session', {
      workspace: workspace.id,
      secret: SECRET,
      ...caller,
    })
    expect(none.status).toBe(401)
    expect((await none.json()).error.code).toBe('VOICE_AGENT_SECRET_INVALID')

    const { user, workspace: other } = await authenticatedOwner()
    await seedWorkspaceSettings(other.id, user.id)
    const wrong = await post('session', {
      workspace: other.id,
      secret: OTHER_SECRET,
      ...caller,
    })
    expect(wrong.status).toBe(401)
  })

  it('validates the form', async () => {
    const res = await post('session', { workspace: 'ws', secret: 'short' })
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('answers NO:disabled while the attendant is off', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedWorkspaceSettings(workspace.id, user.id, { enabled: false })
    const res = await post('session', {
      workspace: workspace.id,
      secret: SECRET,
      ...caller,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('NO:disabled')
  })

  it('never opens a session on a queue that is not routed', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedWorkspaceSettings(workspace.id, user.id)
    const res = await post('session', {
      workspace: workspace.id,
      secret: SECRET,
      ...caller,
    })
    // `not_ready` where the test server has no AudioSocket port, `no_route`
    // where it has one: either way the dialplan keeps its human path.
    expect(await res.text()).toMatch(/^NO:(not_ready|no_route)$/)
    expect(
      await prisma.whatsAppPhoneCall.count({ where: { voiceAgent: true } }),
    ).toBe(0)
  })
})

describe('POST /api/pabx/voice-agent/outcome', () => {
  it('sends the call to the person it was handed to', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedWorkspaceSettings(workspace.id, user.id)
    const { session } = await seedVoiceCall(workspace.id, user.id, '300')

    const res = await post('outcome', {
      workspace: workspace.id,
      secret: SECRET,
      session,
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('TRANSFER|300')
  })

  it('hangs up when nobody took the call', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedWorkspaceSettings(workspace.id, user.id)
    const { session } = await seedVoiceCall(workspace.id, user.id, null)
    const res = await post('outcome', {
      workspace: workspace.id,
      secret: SECRET,
      session,
    })
    expect(await res.text()).toBe('HANGUP')
  })

  it('refuses another secret and another workspace’s session', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedWorkspaceSettings(workspace.id, user.id)
    const { session } = await seedVoiceCall(workspace.id, user.id, '300')

    const wrong = await post('outcome', {
      workspace: workspace.id,
      secret: OTHER_SECRET,
      session,
    })
    expect(wrong.status).toBe(401)

    const { user: otherUser, workspace: other } = await authenticatedOwner()
    await seedWorkspaceSettings(other.id, otherUser.id)
    const crossed = await post('outcome', {
      workspace: other.id,
      secret: SECRET,
      session,
    })
    expect(crossed.status).toBe(401)

    const invalid = await post('outcome', {
      workspace: workspace.id,
      secret: SECRET,
      session: 'not-a-uuid',
    })
    expect(invalid.status).toBe(422)
  })
})
