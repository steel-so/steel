import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import {
  addMember,
  authenticatedOwner,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  assignVariant,
  type ExperimentVariant,
} from '@/src/lib/sites/experiments'

/** Sites wave S4: A/B tests — management routes, server-side variant
 * render on the public runtime and the exposure/conversion beacon. */

/** root > [s1 "Título original", s1b (variant B of s1) "Título variante"] */
function abDocument(): CanvasDocument {
  const doc = createSiteDocument('Título original')
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      root: { ...doc.nodes.root, children: ['s1', 's1b'] },
      s1b: {
        ...doc.nodes.s1,
        id: 's1b',
        props: { ...doc.nodes.s1.props, anchor: 'variante' },
        children: ['h1b'],
        meta: { name: 'Variante B', variantOf: 's1', variantKey: 'B' },
      } as CanvasDocument['nodes'][string],
      h1b: {
        ...doc.nodes.h1,
        id: 'h1b',
        props: { ...doc.nodes.h1.props, text: 'Título variante' },
      },
    },
  }
}

const VARIANTS: ExperimentVariant[] = [
  { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
  { key: 'B', name: 'Variante B', weight: 50, nodeId: 's1b' },
]

/** A cookie key the test assigns to `target`. */
function keyFor(experimentId: string, target: 'A' | 'B'): string {
  for (let i = 0; i < 5000; i++) {
    const key = i.toString(16).padStart(32, '0')
    if (assignVariant(VARIANTS, experimentId, key) === target) return key
  }
  throw new Error('no key')
}

async function siteWithVariant() {
  const { user, workspace } = await authenticatedOwner()
  const base = `/api/workspaces/${workspace.id}/crm/sites`
  const slug = `ab-${createId().slice(0, 12)}`
  const site = (
    await (await postJson(base, { name: 'Loja A/B', slug }, user.cookie)).json()
  ).data
  const page = (
    await (
      await postJson(
        `${base}/${site.id}/pages`,
        { title: 'Oferta', document: abDocument() },
        user.cookie,
      )
    ).json()
  ).data
  const experiments = `${base}/${site.id}/experiments`
  return { user, workspace, base, slug, site, page, experiments }
}

const beacon = (slug: string, events: unknown[], cookie?: string) =>
  fetch(`${BASE_URL}/api/sites/${slug}/experiments`, {
    method: 'POST',
    headers: { ...defaultHeaders, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ events }),
  })

describe('site A/B tests', () => {
  it('runs a section test end to end', async () => {
    const { user, base, slug, site, page, experiments } =
      await siteWithVariant()

    // Before any test, the published page shows only the original.
    await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
    const before = await (await fetch(`${BASE_URL}/s/${slug}/oferta`)).text()
    expect(before).toContain('Título original')
    expect(before).not.toContain('Título variante')
    expect(before).not.toContain('id="ss-ab"')

    const created = await postJson(
      experiments,
      {
        name: 'Título da oferta',
        kind: 'SECTION',
        pageId: page.id,
        controlNodeId: 's1',
        variantNodeIds: ['s1b'],
      },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const experiment = (await created.json()).data
    expect(experiment).toMatchObject({
      state: 'DRAFT',
      unpublishedVariants: [],
      results: { enoughData: false },
    })

    const start = await postJson(
      `${experiments}/${experiment.id}/status`,
      { action: 'start' },
      user.cookie,
    )
    expect(start.status).toBe(200)
    expect((await start.json()).data.state).toBe('RUNNING')

    // The variant is chosen on the server from the visitor's key.
    const bKey = keyFor(experiment.id, 'B')
    const aKey = keyFor(experiment.id, 'A')
    const cookieB = `ss-ab-${slug}=${bKey}`
    const pageB = await (
      await fetch(`${BASE_URL}/s/${slug}/oferta`, {
        headers: { Cookie: cookieB },
      })
    ).text()
    expect(pageB).toContain('Título variante')
    expect(pageB).not.toContain('Título original')
    expect(pageB).toContain('id="ss-ab"')
    expect(pageB).toContain(bKey)
    const pageA = await (
      await fetch(`${BASE_URL}/s/${slug}/oferta`, {
        headers: { Cookie: `ss-ab-${slug}=${aKey}` },
      })
    ).text()
    expect(pageA).toContain('Título original')
    expect(pageA).not.toContain('Título variante')

    // Exposure, then conversion (counted once, for the variant seen).
    const exposure = await beacon(
      slug,
      [{ experimentId: experiment.id, kind: 'EXPOSURE' }],
      cookieB,
    )
    expect(exposure.status).toBe(202)
    expect((await exposure.json()).data).toEqual({ recorded: 1 })
    await beacon(
      slug,
      [
        { experimentId: experiment.id, kind: 'CONVERSION' },
        { experimentId: experiment.id, kind: 'CONVERSION' },
      ],
      cookieB,
    )
    // A conversion without an exposure does not count.
    await beacon(
      slug,
      [{ experimentId: experiment.id, kind: 'CONVERSION' }],
      `ss-ab-${slug}=${aKey}`,
    )

    const results = (
      await (
        await getJson(`${experiments}/${experiment.id}`, user.cookie)
      ).json()
    ).data.results
    expect(results.variants).toMatchObject([
      { key: 'A', visitors: 0, conversions: 0 },
      { key: 'B', visitors: 1, conversions: 1, rate: 1 },
    ])
    expect(results.enoughData).toBe(false)

    // Changing the split of a running test asks for a restart.
    const split = [
      { ...VARIANTS[0], weight: 70 },
      { ...VARIANTS[1], weight: 30 },
    ]
    const refused = await patchJson(
      `${experiments}/${experiment.id}`,
      { variants: split },
      user.cookie,
    )
    expect(refused.status).toBe(409)
    expect((await refused.json()).error.code).toBe('SITE_EXPERIMENT_RUNNING')
    const restarted = await patchJson(
      `${experiments}/${experiment.id}`,
      { variants: split, restart: true },
      user.cookie,
    )
    expect(restarted.status).toBe(200)
    const restartedData = (await restarted.json()).data
    expect(restartedData.run).toBe(2)
    expect(restartedData.results.totals).toEqual({
      visitors: 0,
      conversions: 0,
    })

    // Starting a second test on the same section conflicts.
    const second = (
      await (
        await postJson(
          experiments,
          {
            name: 'Outro',
            kind: 'SECTION',
            pageId: page.id,
            controlNodeId: 's1',
            variantNodeIds: ['s1b'],
          },
          user.cookie,
        )
      ).json()
    ).data
    expect(
      (
        await postJson(
          `${experiments}/${second.id}/status`,
          { action: 'start' },
          user.cookie,
        )
      ).status,
    ).toBe(409)
    expect(
      (await deleteJson(`${experiments}/${second.id}`, user.cookie)).status,
    ).toBe(200)

    // Pause: everyone sees the original again.
    await postJson(
      `${experiments}/${experiment.id}/status`,
      { action: 'pause' },
      user.cookie,
    )
    const paused = await (
      await fetch(`${BASE_URL}/s/${slug}/oferta`, {
        headers: { Cookie: cookieB },
      })
    ).text()
    expect(paused).toContain('Título original')
    expect(paused).not.toContain('id="ss-ab"')

    // Apply B: it replaces the original in the draft and the test ends.
    const applied = await postJson(
      `${experiments}/${experiment.id}/apply-winner`,
      { variantKey: 'B' },
      user.cookie,
    )
    expect(applied.status).toBe(200)
    expect((await applied.json()).data).toMatchObject({
      status: 'ENDED',
      winnerKey: 'B',
    })
    const draft = (
      await (
        await getJson(`${base}/${site.id}/pages/${page.id}`, user.cookie)
      ).json()
    ).data.document as CanvasDocument
    expect(draft.nodes.root.children).toEqual(['s1b'])
    expect(draft.nodes.s1).toBeUndefined()
    expect(
      (
        await postJson(
          `${experiments}/${experiment.id}/status`,
          { action: 'start' },
          user.cookie,
        )
      ).status,
    ).toBe(409)

    const list = await getJson(experiments, user.cookie)
    expect((await list.json()).data).toHaveLength(1)
  })

  it('creates hidden page copies and warns before a publish restarts a test', async () => {
    const { user, base, site, page, experiments } = await siteWithVariant()
    const created = await postJson(
      experiments,
      {
        name: 'Página nova',
        kind: 'PAGE',
        pageId: page.id,
        goal: { type: 'FORM' },
      },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const experiment = (await created.json()).data
    const copyId = experiment.variants[1].pageId
    const copy = (
      await (
        await getJson(`${base}/${site.id}/pages/${copyId}`, user.cookie)
      ).json()
    ).data
    expect(copy.seo.noindex).toBe(true)
    expect(copy.title).toBe('Oferta (Variante B)')
    expect(experiment.unpublishedVariants).toEqual(['A', 'B'])

    // Not published yet: cannot start.
    const early = await postJson(
      `${experiments}/${experiment.id}/status`,
      { action: 'start' },
      user.cookie,
    )
    expect(early.status).toBe(422)
    expect((await early.json()).error.code).toBe(
      'SITE_EXPERIMENT_NOT_PUBLISHED',
    )

    await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
    await postJson(
      `${experiments}/${experiment.id}/status`,
      { action: 'start' },
      user.cookie,
    )
    const impactUrl = `${experiments}/impact`
    expect((await (await getJson(impactUrl, user.cookie)).json()).data).toEqual(
      { experiments: [] },
    )

    await patchJson(
      `${base}/${site.id}/pages/${copyId}`,
      { document: createSiteDocument('Nova versão B') },
      user.cookie,
    )
    expect((await (await getJson(impactUrl, user.cookie)).json()).data).toEqual(
      {
        experiments: [
          { id: experiment.id, name: 'Página nova', variants: ['B'] },
        ],
      },
    )

    // Publishing restarts it.
    await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
    const after = (
      await (
        await getJson(`${experiments}/${experiment.id}`, user.cookie)
      ).json()
    ).data
    expect(after.run).toBe(2)

    // Deleting the test removes the copy from the draft.
    expect(
      (await deleteJson(`${experiments}/${experiment.id}`, user.cookie)).status,
    ).toBe(200)
    expect(
      (await getJson(`${base}/${site.id}/pages/${copyId}`, user.cookie)).status,
    ).toBe(404)
  })

  it('guards the routes', async () => {
    const { workspace, user, experiments, page, slug } = await siteWithVariant()
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(experiments, viewer.cookie)).status).toBe(200)
    expect(
      (
        await postJson(
          experiments,
          { name: 'x', kind: 'PAGE', pageId: page.id },
          viewer.cookie,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await postJson(
          experiments,
          { name: 'x', kind: 'SECTION', pageId: page.id },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    const anonymous = await fetch(`${BASE_URL}${experiments}`, {
      headers: defaultHeaders,
    })
    expect(anonymous.status).toBe(401)
    expect((await getJson(`${experiments}/nope`, user.cookie)).status).toBe(404)

    // Public beacon: unknown site and bad payloads.
    expect(
      (
        await beacon(`nao-existe-${createId()}`, [
          { experimentId: 'x', kind: 'EXPOSURE' },
        ])
      ).status,
    ).toBe(404)
    expect((await beacon(slug, [])).status).toBe(422)
  })
})
