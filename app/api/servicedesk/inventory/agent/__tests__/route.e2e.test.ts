import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { seedSdInventoryToken } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { authenticatedOwner, defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const versionUrl = `${BASE_URL}/api/servicedesk/inventory/agent/version`
const downloadUrl = `${BASE_URL}/api/servicedesk/inventory/agent/download`

function get(url: string, token: string | null) {
  return fetch(url, {
    headers: {
      ...defaultHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

async function setup(autoUpdate: boolean) {
  const { user, workspace } = await authenticatedOwner()
  const token = randomBytes(32).toString('base64url')
  await seedSdInventoryToken({
    workspaceId: workspace.id,
    createdById: user.id,
    token,
  })
  await prisma.sdInventorySettings.upsert({
    where: { workspaceId: workspace.id },
    create: { workspaceId: workspace.id, agentAutoUpdate: autoUpdate },
    update: { agentAutoUpdate: autoUpdate },
  })
  return { token }
}

describe('public agent update endpoints', () => {
  it('rejects a missing, malformed or unknown token', async () => {
    const query = '?os=linux&arch=amd64&current=1.0.0'
    for (const token of [
      null,
      'curto',
      randomBytes(32).toString('base64url'),
    ]) {
      const res = await get(`${versionUrl}${query}`, token)
      expect(res.status).toBe(401)
      expect((await res.json()).error.code).toBe('SD_INVENTORY_TOKEN_INVALID')
    }
  })

  it('validates the query', async () => {
    const { token } = await setup(true)
    expect((await get(`${versionUrl}?os=plan9&arch=amd64`, token)).status).toBe(
      400,
    )
    expect(
      (await get(`${downloadUrl}?os=linux&arch=amd64`, token)).status,
    ).toBe(422)
  })

  it('offers nothing while the workspace has not opted in', async () => {
    const { token } = await setup(false)
    await prisma.sdInventoryAgentRelease.create({
      data: {
        version: `e2e-${randomBytes(4).toString('hex')}`,
        os: 'linux',
        arch: 'amd64',
        sha256: 'a'.repeat(64),
        sizeBytes: 1,
        storageKey: 'x',
      },
    })
    const res = await get(
      `${versionUrl}?os=linux&arch=amd64&current=1.0.0`,
      token,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.updateAvailable).toBe(false)

    const download = await get(
      `${downloadUrl}?os=linux&arch=amd64&version=whatever`,
      token,
    )
    expect(download.status).toBe(422)
  })

  it('offers the newest release when opted in, and never to a dev build', async () => {
    const { token } = await setup(true)
    const version = `e2e-${randomBytes(4).toString('hex')}`
    const sha256 = createHash('sha256').update('binary').digest('hex')
    await prisma.sdInventoryAgentRelease.create({
      data: {
        version,
        os: 'windows',
        arch: 'arm64',
        sha256,
        sizeBytes: 6,
        storageKey: `${version}/missing`,
      },
    })

    const offered = (
      await (
        await get(`${versionUrl}?os=windows&arch=arm64&current=1.0.0`, token)
      ).json()
    ).data
    expect(offered).toMatchObject({
      updateAvailable: true,
      version,
      sha256,
      size: 6,
    })
    expect(offered.downloadPath).toContain('/agent/download?')

    const dev = (
      await (
        await get(`${versionUrl}?os=windows&arch=arm64&current=dev`, token)
      ).json()
    ).data
    expect(dev.updateAvailable).toBe(false)

    // O binário não está no storage de teste: erro claro, sem vazar nada.
    const download = await get(`${BASE_URL}${offered.downloadPath}`, token)
    expect(download.status).toBe(422)
  })
})
