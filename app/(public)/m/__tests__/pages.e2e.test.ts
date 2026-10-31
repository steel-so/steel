import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/** Public routes rate limit per IP: every call gets its own bucket. */
const anonIp = () => ({
  extraHeaders: {
    'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})
const pubGet = (path: string) => getJson(path, anonIp())
const pubPost = (path: string, body: unknown) => postJson(path, body, anonIp())

async function bookedPage() {
  const { user, workspace } = await authenticatedOwner()
  const created = await postJson(
    `/api/workspaces/${workspace.id}/crm/meeting-pages`,
    {
      title: 'Conversa com vendas',
      hostUserIds: [user.id],
      minNoticeMinutes: 0,
    },
    user.cookie,
  )
  const page = (await created.json()).data as { slug: string }
  const slots = (
    await (await pubGet(`/api/crm/meetings/${page.slug}/slots`)).json()
  ).data.slots as string[]
  const booking = await pubPost(`/api/crm/meetings/${page.slug}/book`, {
    startsAt: slots[0],
    name: 'Cliente Teste',
    email: 'cliente@example.com',
    timezone: 'America/Sao_Paulo',
    consent: true,
  })
  const token = (await booking.json()).data.manageToken as string
  return { page, token }
}

const get = (path: string) =>
  fetch(`${BASE_URL}${path}`, { redirect: 'manual' })

describe('public meeting pages (/m/**)', () => {
  it('should render the booking page without a session', async () => {
    const { page } = await bookedPage()

    const res = await get(`/m/${page.slug}`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('Conversa com vendas')
    expect(html).toContain('noindex')
  })

  it('should render the embeddable page', async () => {
    const { page } = await bookedPage()

    const res = await get(`/m/${page.slug}/embed`)

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Conversa com vendas')
  })

  it('should render the manage page for a booking token', async () => {
    const { token } = await bookedPage()

    const res = await get(`/m/b/${token}`)

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Conversa com vendas')
  })

  it.each([
    '/m/pagina-que-nao-existe',
    '/m/pagina-que-nao-existe/embed',
    '/m/b/token-que-nao-existe',
  ])('should answer 404 for %s', async (path) => {
    expect((await get(path)).status).toBe(404)
  })
})
