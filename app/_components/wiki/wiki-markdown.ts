import { MarkdownPlugin } from '@platejs/markdown'
import type { Descendant, SlateEditor } from 'platejs'

/** AI markdown as editor blocks, with plain paragraphs as a fallback. */
export function markdownToBlocks(
  editor: SlateEditor,
  text: string,
): Descendant[] {
  try {
    const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(text)
    if (nodes.length > 0) return nodes
  } catch {
    // The parser rejected it: fall through to plain paragraphs.
  }
  return text
    .split(/\n{2,}/)
    .map((chunk) => ({ type: 'p', children: [{ text: chunk }] }))
}

/** The page as markdown (the editor's MarkdownKit serializer). */
export function editorMarkdown(editor: SlateEditor): string {
  return editor.getApi(MarkdownPlugin).markdown.serialize()
}
