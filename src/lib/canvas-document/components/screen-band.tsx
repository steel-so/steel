import type { ScreenBand } from '../page-furniture'

/**
 * Running header or footer as shown on screen (editor, public link): once,
 * around the document. The PDF prints them on every page instead.
 */
export function ScreenBandView({
  kind,
  band,
}: {
  kind: 'header' | 'footer'
  band: ScreenBand
}) {
  return (
    <div
      className={`d-hf d-hf--${kind} d-hf--${band.align}`}
      data-document-furniture={kind}
      contentEditable={false}
      suppressContentEditableWarning
    >
      {band.imageUrl ? <img src={band.imageUrl} alt='' /> : null}
      {band.text ? <span>{band.text}</span> : null}
    </div>
  )
}
