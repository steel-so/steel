import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

// The blog post editor crashed for every post ("reading 'accept'") because it
// rendered a media button for a node type the media toolbar has no config for.
// The suite mocks the editor, so this guards the pairing at the source level.
describe('post body editor media buttons', () => {
  it('only offers media types the media toolbar knows', () => {
    const supported = new Set(
      [
        ...read('components/editor/ui/media-toolbar-button.tsx').matchAll(
          /\[KEYS\.(\w+)\]:\s*\{\s*accept/g,
        ),
      ].map((match) => match[1]),
    )
    const used = [
      ...read('app/_components/crm/sites/blog/post-body-editor.tsx').matchAll(
        /<MediaToolbarButton nodeType=\{KEYS\.(\w+)\}/g,
      ),
    ].map((match) => match[1])

    expect(used.length).toBeGreaterThan(0)
    for (const type of used) expect(supported).toContain(type)
  })
})
