import type { Editor } from '@tiptap/core'

export type InlineMark =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'list'

/** The inline text editor currently open on the canvas, shared with the
 * floating toolbar in the parent document. */
export interface InlineEditorState {
  editor: Editor
  rich: boolean
  marks: InlineMark[]
}
