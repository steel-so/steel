import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  defaultHeaders,
  deleteJson,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d,
  0x74, 0x20,
])

async function seedCall(
  workspaceId: string,
  userId: string,
  overrides: {
    recordingRequested?: boolean
    status?: 'COMPLETED' | 'BUSY'
  } = {},
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
    data: { workspaceId, waId: `5511${suffix()}`, name: 'Maria' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'IN_PROGRESS',
      assignedUserId: userId,
    },
  })
  // Transcription off: the e2e run has no provider to call.
  await prisma.whatsAppSettings.create({
    data: { workspaceId, callTranscriptionEnabled: false },
  })
  const token = `tok-${suffix()}`.padEnd(32, 'x')
  const call = await prisma.whatsAppPhoneCall.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      userId,
      deviceId: '123',
      extension: '200',
      destination: '11988887777',
      callbackTokenHash: createHash('sha256').update(token).digest('hex'),
      status: overrides.status ?? 'COMPLETED',
      recordingRequested: overrides.recordingRequested ?? true,
      recordingNotice: 'Avise o contato',
    },
  })
  return { token, call, conversation }
}

function upload(token: string, bytes: Uint8Array = WAV) {
  const form = new FormData()
  form.set('token', token)
  form.set(
    'file',
    new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'audio/wav' }),
    'call.wav',
  )
  return fetch(`${BASE_URL}/api/pabx/calls/webhook/recording`, {
    method: 'POST',
    headers: { Origin: defaultHeaders.Origin },
    body: form,
  })
}

describe('POST /api/pabx/calls/webhook/recording', () => {
  it('stores the recording, lists it and streams it to the viewer', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { token, call, conversation } = await seedCall(workspace.id, user.id)

    const res = await upload(token)
    expect(res.status).toBe(201)
    expect((await res.json()).data).toEqual({
      callId: call.id,
      aiStatus: 'SKIPPED',
    })

    const again = await upload(token)
    expect(again.status).toBe(409)

    const list = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}/calls`,
      user.cookie,
    )
    expect(list.status).toBe(200)
    const [listed] = (await list.json()).data
    expect(listed).toMatchObject({
      id: call.id,
      hasRecording: true,
      aiStatus: 'SKIPPED',
      aiSkipReason: 'transcription_disabled',
      recording: { mimeType: 'audio/wav', sizeBytes: WAV.byteLength },
    })

    const audioPath = `/api/workspaces/${workspace.id}/phone-calls/${call.id}/recording`
    const audio = await getJson(audioPath, user.cookie)
    expect(audio.status).toBe(200)
    expect(audio.headers.get('content-type')).toBe('audio/wav')
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(WAV)

    const ranged = await getJson(audioPath, {
      cookie: user.cookie,
      extraHeaders: { Range: 'bytes=0-3' },
    })
    expect(ranged.status).toBe(206)
    expect(new TextDecoder().decode(await ranged.arrayBuffer())).toBe('RIFF')

    // Deleting the audio is for the module admins only.
    const member = await addMember(workspace.id, 'MEMBER')
    expect((await deleteJson(audioPath, member.cookie)).status).toBe(403)

    const deleted = await deleteJson(audioPath, user.cookie)
    expect(deleted.status).toBe(200)
    expect((await getJson(audioPath, user.cookie)).status).toBe(404)
  })

  it('rejects an unknown token, a call without recording and a non-audio file', async () => {
    const { user, workspace } = await authenticatedOwner()

    expect((await upload('x'.repeat(32))).status).toBe(401)

    const notAsked = await seedCall(workspace.id, user.id, {
      recordingRequested: false,
    })
    expect((await upload(notAsked.token)).status).toBe(409)

    const { user: other, workspace: ws2 } = await authenticatedOwner()
    const asked = await seedCall(ws2.id, other.id)
    expect(
      (await upload(asked.token, new TextEncoder().encode('<?php'))).status,
    ).toBe(415)
  })

  it('validates the form', async () => {
    const res = await fetch(`${BASE_URL}/api/pabx/calls/webhook/recording`, {
      method: 'POST',
      headers: { Origin: defaultHeaders.Origin },
      body: new FormData(),
    })
    expect(res.status).toBe(422)
  })
})

describe('GET calls of a ticket and of CRM records', () => {
  it('answers an empty list for records without calls', async () => {
    const { user, workspace } = await authenticatedOwner()
    for (const path of [
      'crm/opportunities/unknown/calls',
      'crm/people/unknown/calls',
    ]) {
      const res = await getJson(
        `/api/workspaces/${workspace.id}/${path}`,
        user.cookie,
      )
      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual([])
    }
  })

  it('requires a session', async () => {
    const res = await getJson('/api/workspaces/ws/crm/people/p/calls')
    expect(res.status).toBe(401)
  })
})
