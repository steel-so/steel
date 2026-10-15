'use client'

import { Alert02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bold, Code2, Italic, Strikethrough, Underline } from 'lucide-react'
import { KEYS, type Value } from 'platejs'
import { Plate, useEditorRef, usePlateEditor } from 'platejs/react'
import { type ReactNode, useCallback, useState } from 'react'
import {
  BLOG_EDITOR_PLUGINS,
  CALLOUT_KEY,
} from '@/components/editor/blog-plugins'
import {
  type EditorDocumentBackend,
  EditorDocumentProvider,
  type EditorUploadedMedia,
  useEditorDocument,
} from '@/components/editor/editor-document-context'
import { AlignToolbarButton } from '@/components/editor/ui/align-toolbar-button'
import { Editor, EditorContainer } from '@/components/editor/ui/editor'
import { EmojiToolbarButton } from '@/components/editor/ui/emoji-toolbar-button'
import { FixedToolbar } from '@/components/editor/ui/fixed-toolbar'
import {
  RedoToolbarButton,
  UndoToolbarButton,
} from '@/components/editor/ui/history-toolbar-button'
import { InsertToolbarButton } from '@/components/editor/ui/insert-toolbar-button'
import { LinkToolbarButton } from '@/components/editor/ui/link-toolbar-button'
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
  TodoListToolbarButton,
} from '@/components/editor/ui/list-toolbar-button'
import { MarkToolbarButton } from '@/components/editor/ui/mark-toolbar-button'
import { MediaToolbarButton } from '@/components/editor/ui/media-toolbar-button'
import { TableToolbarButton } from '@/components/editor/ui/table-toolbar-button'
import { ToolbarButton, ToolbarGroup } from '@/components/editor/ui/toolbar'
import { TurnIntoToolbarButton } from '@/components/editor/ui/turn-into-toolbar-button'
import { SteelIcon } from '@/components/icon/icon'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { crmSitesApi } from '@/src/hooks/use-crm-sites'
import { MediaPickButton } from '../media-pick-button'

/**
 * Body editor of a blog post: Plate with the blog kits, a fixed toolbar
 * (blocks, marks, lists, links, tables, media, callout) and images from
 * the site's media library. Uploads go to the same library. Comments and
 * mentions are off for posts (the backend answers with nothing).
 */

const notAvailable = () =>
  Promise.reject(new Error('Comentários não estão disponíveis nos posts'))

function useNoComments() {
  return useQuery({
    queryKey: ['site-post-no-comments'],
    queryFn: async () => [],
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function useNoMutation<T>() {
  return useMutation<unknown, Error, T>({ mutationFn: notAvailable })
}

function useNoMembers() {
  return useQuery({
    queryKey: ['site-post-no-members'],
    queryFn: async () => [],
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Uploads to the site media library (same as the editor's Mídia tab). */
function useUploadSiteMedia() {
  const { workspaceId } = useEditorDocument()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadingFile, setUploadingFile] = useState<File>()
  const [uploadedFile, setUploadedFile] = useState<EditorUploadedMedia>()
  const uploadFile = useCallback(
    async (file: File) => {
      setIsUploading(true)
      setUploadingFile(file)
      try {
        const item = await crmSitesApi(workspaceId).uploadMedia(file)
        const uploaded = { key: item.id, url: item.url, name: file.name }
        setUploadedFile(uploaded)
        return uploaded
      } catch (error) {
        notify.error(error, 'Não foi possível enviar o arquivo')
        throw error
      } finally {
        setIsUploading(false)
        setUploadingFile(undefined)
      }
    },
    [workspaceId],
  )
  return {
    isUploading,
    progress: isUploading ? 50 : 0,
    uploadedFile,
    uploadingFile,
    uploadFile,
  }
}

export const siteBlogEditorBackend: EditorDocumentBackend = {
  useComments: useNoComments,
  useCreateComment: useNoMutation,
  useUpdateComment: useNoMutation,
  useResolveComment: useNoMutation,
  useDeleteComment: useNoMutation,
  useMentionableMembers: useNoMembers,
  useUploadMedia: useUploadSiteMedia,
}

function CalloutButton() {
  const editor = useEditorRef()
  return (
    <ToolbarButton
      tooltip='Destaque (caixa de aviso)'
      onClick={() => {
        editor.tf.insertNodes({
          type: CALLOUT_KEY,
          variant: 'info',
          children: [{ text: '' }],
        })
        editor.tf.focus()
      }}
    >
      <SteelIcon icon={Alert02Icon} />
    </ToolbarButton>
  )
}

function LibraryImageButton() {
  const editor = useEditorRef()
  const { workspaceId } = useEditorDocument()
  return (
    <MediaPickButton
      workspaceId={workspaceId}
      label='Imagem da mídia'
      onPick={(url) => {
        editor.tf.insertNodes({
          type: KEYS.img,
          url,
          children: [{ text: '' }],
        })
        editor.tf.focus()
      }}
    />
  )
}

function BlogToolbarButtons() {
  return (
    <div className='flex w-max min-w-full flex-nowrap items-center gap-y-1 sm:w-full sm:flex-wrap'>
      <ToolbarGroup>
        <UndoToolbarButton />
        <RedoToolbarButton />
      </ToolbarGroup>
      <ToolbarGroup>
        <InsertToolbarButton />
        <TurnIntoToolbarButton />
      </ToolbarGroup>
      <ToolbarGroup>
        <MarkToolbarButton nodeType='bold' tooltip='Negrito' command='cmd+B'>
          <Bold />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType='italic' tooltip='Itálico' command='cmd+I'>
          <Italic />
        </MarkToolbarButton>
        <MarkToolbarButton
          nodeType='underline'
          tooltip='Sublinhado'
          command='cmd+U'
        >
          <Underline />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType='strikethrough' tooltip='Riscado'>
          <Strikethrough />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType='code' tooltip='Código' command='cmd+E'>
          <Code2 />
        </MarkToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <AlignToolbarButton />
        <BulletedListToolbarButton />
        <NumberedListToolbarButton />
        <TodoListToolbarButton />
      </ToolbarGroup>
      <ToolbarGroup>
        <LinkToolbarButton />
        <TableToolbarButton />
        <CalloutButton />
        <EmojiToolbarButton />
      </ToolbarGroup>
      <ToolbarGroup>
        <MediaToolbarButton nodeType={KEYS.img} />
        <MediaToolbarButton nodeType={KEYS.video} />
      </ToolbarGroup>
      <ToolbarGroup>
        <LibraryImageButton />
      </ToolbarGroup>
    </div>
  )
}

export interface PostBodyEditorProps {
  workspaceId: string
  postId: string
  userId: string
  userName: string
  content: Value
  onChange: (content: Value) => void
  /** Rendered above the text in the scroll area (cover, title). */
  header?: ReactNode
  className?: string
}

export function PostBodyEditor({
  workspaceId,
  postId,
  userId,
  userName,
  content,
  onChange,
  header,
  className,
}: PostBodyEditorProps) {
  const editor = usePlateEditor({
    plugins: BLOG_EDITOR_PLUGINS,
    value: content.length
      ? content
      : [{ type: KEYS.p, children: [{ text: '' }] }],
  })
  return (
    <EditorDocumentProvider
      workspaceId={workspaceId}
      documentId={postId}
      userId={userId}
      userName={userName}
      backend={siteBlogEditorBackend}
    >
      <Plate
        editor={editor}
        onChange={({ value }) => {
          // Ctrl+A → Del can empty the editor before normalization.
          if (value.length === 0) {
            editor.tf.insertNodes(editor.api.create.block({ type: KEYS.p }), {
              at: [0],
            })
            return
          }
          onChange(value)
        }}
      >
        <div className={cn('flex h-full min-h-0 flex-col', className)}>
          <FixedToolbar className='static shrink-0 overflow-x-auto overflow-y-visible rounded-none px-3 sm:overflow-visible'>
            <BlogToolbarButtons />
          </FixedToolbar>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {header}
            <EditorContainer
              data-testid='site-post-editor'
              className='h-auto overflow-visible'
            >
              <Editor
                className='px-4 pt-2 pb-40 sm:px-[max(64px,calc(50%-380px))]'
                placeholder='Escreva o post… Digite / para inserir blocos.'
              />
            </EditorContainer>
          </div>
        </div>
      </Plate>
    </EditorDocumentProvider>
  )
}
