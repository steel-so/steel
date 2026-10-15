import { describe, expect, it } from 'vitest'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  heading,
  image,
  named,
  section,
  text,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import {
  buildCandidates,
  collectImageTargets,
  describeImageRequest,
  libraryDescriptions,
  MAX_LIBRARY_CANDIDATES,
  SITE_AI_PLACEHOLDERS,
  toImageSuggestions,
} from '@/src/lib/site-ai/images'

function page() {
  return toDocument([
    named(
      'Sobre',
      section({}, [
        heading('h2', 'Quem somos'),
        text('Uma padaria de bairro com fornada a cada hora.'),
        image('/old.png', 'Foto antiga'),
        named('Logo', image('/logo.png', 'Logo')),
      ]),
    ),
    section({}, [text('curto'), image('/b.png', '')]),
  ])
}

describe('libraryDescriptions', () => {
  it('maps each image URL to the first alt text the site gives it', () => {
    const doc = page()
    const other = toDocument([
      section({}, [
        image('/old.png', 'Outra descrição'),
        image('/c.png', '  '),
      ]),
    ])
    other.nodes.extra = {
      id: 'extra',
      type: SITE_TYPES.image,
      props: { image: { src: 5 } },
    }
    const map = libraryDescriptions([doc, other])
    expect(map.get('/old.png')).toBe('Foto antiga')
    expect(map.has('/c.png')).toBe(false)
    expect(map.has('/b.png')).toBe(false)
  })
})

describe('buildCandidates', () => {
  it('lists library images first (capped) then the placeholders', () => {
    const library = Array.from(
      { length: MAX_LIBRARY_CANDIDATES + 5 },
      (_, i) => ({
        url: `https://media/x${i}.png`,
        description: i === 0 ? 'Fachada da loja' : null,
      }),
    )
    const candidates = buildCandidates(library)
    expect(candidates).toHaveLength(
      MAX_LIBRARY_CANDIDATES + SITE_AI_PLACEHOLDERS.length,
    )
    expect(candidates[0]).toEqual({
      id: 'b1',
      src: 'https://media/x0.png',
      description: 'Fachada da loja',
      source: 'library',
      dimensions: null,
    })
    expect(candidates[1].description).toContain('sem descrição')
    const placeholder = candidates[MAX_LIBRARY_CANDIDATES]
    expect(placeholder.id).toBe('p1')
    expect(placeholder.source).toBe('placeholder')
    expect(placeholder.dimensions).toEqual({ width: 926, height: 926 })
    expect(placeholder.src.startsWith('/landing-page-templates/')).toBe(true)
  })
})

describe('collectImageTargets', () => {
  it('lists images with their context and skips the logo and hidden ones', () => {
    const doc = page()
    const targets = collectImageTargets(doc)
    expect(targets).toHaveLength(2)
    expect(targets[0]).toMatchObject({
      id: 'i1',
      currentSrc: '/old.png',
      currentAlt: 'Foto antiga',
      context:
        'Sobre — perto de: "Uma padaria de bairro com fornada a cada hora."',
    })
    expect(targets[1]).toMatchObject({ id: 'i2', currentAlt: '' })
    expect(targets[1].context).toContain('Seção')

    const [first] = doc.nodes[doc.rootId].children as string[]
    expect(collectImageTargets(doc, [first])).toHaveLength(1)
    expect(collectImageTargets(doc, [], 1)).toHaveLength(1)

    doc.nodes[targets[0].nodeId].meta = { hidden: true }
    expect(collectImageTargets(doc)).toHaveLength(1)
  })

  it('tolerates an image without props and a page without text', () => {
    const doc = toDocument([section({}, [])])
    const [sectionId] = doc.nodes[doc.rootId].children as string[]
    doc.nodes.bare = { id: 'bare', type: SITE_TYPES.image, props: {} }
    doc.nodes[sectionId].children = ['bare']
    expect(collectImageTargets(doc)[0]).toMatchObject({
      currentSrc: '',
      currentAlt: '',
      context: 'Seção',
    })
  })
})

describe('describeImageRequest / toImageSuggestions', () => {
  const doc = page()
  const targets = collectImageTargets(doc)
  const candidates = buildCandidates([
    { url: 'https://media/fachada.png', description: 'Fachada' },
  ])

  it('describes targets and candidates for the model', () => {
    const text = describeImageRequest(targets, candidates)
    expect(text).toContain('- i2: Seção')
    expect(text).toContain('sem texto alternativo')
    expect(text).toContain('- b1 (biblioteca do workspace): Fachada')
    expect(text).toContain('- p1 (exemplo):')
  })

  it('maps picks to suggestions, keeping the image on unknown ids', () => {
    const suggestions = toImageSuggestions(
      [
        {
          id: 'i1',
          candidate: 'b1',
          alt: '  Fachada   da padaria ',
          idea: 'Foto da vitrine',
        },
        { id: 'i2', candidate: 'zz', alt: 'Pães na bancada', idea: '' },
        { id: 'i9', candidate: 'p1', alt: 'x', idea: 'x' },
      ],
      targets,
      candidates,
    )
    expect(suggestions).toEqual([
      {
        nodeId: targets[0].nodeId,
        currentSrc: '/old.png',
        src: 'https://media/fachada.png',
        alt: 'Fachada da padaria',
        idea: 'Foto da vitrine',
        source: 'library',
        dimensions: null,
      },
      {
        nodeId: targets[1].nodeId,
        currentSrc: '/b.png',
        src: '/b.png',
        alt: 'Pães na bancada',
        idea: '',
        source: 'current',
        dimensions: null,
      },
    ])
  })

  it('skips picks that change nothing and gives placeholder sizes', () => {
    const suggestions = toImageSuggestions(
      [
        { id: 'i1', candidate: '', alt: '', idea: 'x' },
        { id: 'i2', candidate: 'p2', alt: '', idea: '' },
      ],
      targets,
      candidates,
    )
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      source: 'placeholder',
      alt: '',
      dimensions: { width: 815, height: 1272 },
    })
  })
})
