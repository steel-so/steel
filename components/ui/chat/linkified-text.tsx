import { Fragment } from 'react'
import { linkifyText } from '@/src/lib/linkify'

/**
 * Message text with its URLs as links that open in a new tab. The link
 * inherits the bubble colour (outgoing bubbles are on the primary colour).
 */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkifyText(text).map((part, index) =>
        part.type === 'link' ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts are rebuilt from the same string
            key={index}
            href={part.href}
            target='_blank'
            rel='noopener noreferrer'
            className='underline underline-offset-2 hover:opacity-80'
          >
            {part.text}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts are rebuilt from the same string
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  )
}
