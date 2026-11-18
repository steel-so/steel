import type {
  DesignSection,
  DesignSpec,
} from '@/src/lib/site-ai/fidelity/blueprint/design-spec'
import type {
  BlueprintBox,
  BlueprintButton,
  BlueprintDivider,
  BlueprintForm,
  BlueprintHeading,
  BlueprintIcon,
  BlueprintImage,
  BlueprintList,
  BlueprintNode,
  BlueprintSpacer,
  BlueprintText,
  SectionBlueprint,
} from '@/src/lib/site-ai/fidelity/blueprint/section-blueprint'
import type { ReferenceCapture } from '@/src/lib/site-ai/fidelity/types'

export function fakeDesignSection(
  over: Partial<DesignSection> = {},
): DesignSection {
  return {
    type: 'hero',
    layout: 'Duas colunas: texto à esquerda, imagem à direita',
    columns: 2,
    align: 'left',
    backgroundKind: 'color',
    backgroundColor: '#ffffff',
    backgroundColorTo: null,
    textColor: null,
    minHeightPx: null,
    paddingYPx: 96,
    density: 'airy',
    elements: ['h1', 'lead', '2 botões', 'imagem 4:3 à direita'],
    imageSide: 'right',
    imageRatio: '4/3',
    equivalent: 'hero',
    yStart: 0,
    yEnd: 720,
    ...over,
  }
}

export function fakeDesignSpec(over: Partial<DesignSpec> = {}): DesignSpec {
  return {
    source: 'ref1',
    summary: 'Claro, arejado, botões arredondados',
    kit: 'saas',
    palette: [
      { hex: '#0A66FF', role: 'primary', usage: 'botões' },
      { hex: '#ffffff', role: 'background', usage: 'fundo' },
      { hex: '#111827', role: 'text', usage: 'texto' },
      { hex: '#f3f4f6', role: 'surface', usage: 'cartões' },
    ],
    typography: {
      headingFont: 'geist',
      bodyFont: 'geist',
      observedHeadingFont: 'Inter',
      observedBodyFont: 'Inter',
      h1Px: 56,
      h2Px: 40,
      h3Px: 24,
      bodyPx: 16,
      headingWeight: 700,
      bodyWeight: 400,
      headingLineHeight: 1.1,
      bodyLineHeight: 1.6,
      headingLetterSpacingPx: -1,
      headingTransform: 'none',
    },
    buttons: {
      radiusPx: 999,
      fill: 'solid',
      size: 'lg',
      paddingXPx: 28,
      paddingYPx: 14,
      fontPx: 16,
      fontWeight: 600,
      transform: 'none',
      backgroundHex: '#0a66ff',
      textHex: '#ffffff',
      secondary: 'contorno',
    },
    cards: {
      present: true,
      radiusPx: 16,
      shadow: 'soft',
      borderPx: 1,
      borderHex: '#e5e7eb',
      backgroundHex: '#ffffff',
      paddingPx: 32,
    },
    radii: { smPx: 6, mdPx: 12, lgPx: 24 },
    spacing: {
      sectionPaddingYPx: 96,
      contentMaxWidthPx: 1200,
      gridGapPx: 32,
    },
    images: { style: 'mockups', radiusPx: 16, dominantRatio: '4/3' },
    sections: [
      fakeDesignSection(),
      fakeDesignSection({
        type: 'cards',
        layout: 'Três cartões lado a lado',
        columns: 3,
        equivalent: 'services',
        yStart: 720,
        yEnd: 1400,
        imageSide: 'none',
        imageRatio: null,
      }),
    ],
    ...over,
  }
}

// ─── blueprint nodes (every nullable field null unless overridden) ───────

export function bpHeading(
  over: Partial<BlueprintHeading> = {},
): BlueprintHeading {
  return {
    type: 'heading',
    level: 'h2',
    text: 'Um título',
    sizePx: null,
    sizeMobilePx: null,
    weight: null,
    lineHeight: null,
    letterSpacingPx: null,
    transform: null,
    color: null,
    align: null,
    maxWidth: null,
    ...over,
  }
}

export function bpText(over: Partial<BlueprintText> = {}): BlueprintText {
  return {
    type: 'text',
    text: 'Um parágrafo.',
    preset: 'body',
    sizePx: null,
    sizeMobilePx: null,
    weight: null,
    lineHeight: null,
    letterSpacingPx: null,
    transform: null,
    color: null,
    align: null,
    maxWidth: null,
    ...over,
  }
}

export function bpButton(over: Partial<BlueprintButton> = {}): BlueprintButton {
  return {
    type: 'button',
    label: 'Fale com a gente',
    variant: 'primary',
    size: 'lg',
    bg: null,
    textColor: null,
    borderColor: null,
    radius: null,
    align: null,
    icon: null,
    ...over,
  }
}

export function bpImage(over: Partial<BlueprintImage> = {}): BlueprintImage {
  return {
    type: 'image',
    source: 'stock',
    ratio: '4/3',
    widthPx: null,
    alt: 'Equipe trabalhando',
    fit: 'cover',
    radius: null,
    circle: null,
    shadow: null,
    align: null,
    bg: null,
    ...over,
  }
}

export function bpIcon(over: Partial<BlueprintIcon> = {}): BlueprintIcon {
  return {
    type: 'icon',
    name: 'star',
    sizePx: null,
    color: null,
    shape: 'circle',
    bg: null,
    align: null,
    ...over,
  }
}

export function bpList(over: Partial<BlueprintList> = {}): BlueprintList {
  return {
    type: 'list',
    items: ['Primeiro', 'Segundo'],
    marker: 'check',
    markerColor: null,
    preset: 'body',
    color: null,
    gap: null,
    columns: null,
    ...over,
  }
}

export function bpDivider(
  over: Partial<BlueprintDivider> = {},
): BlueprintDivider {
  return {
    type: 'divider',
    color: null,
    thickness: null,
    ...over,
  }
}

export function bpSpacer(over: Partial<BlueprintSpacer> = {}): BlueprintSpacer {
  return {
    type: 'spacer',
    heightPx: 40,
    heightMobilePx: null,
    ...over,
  }
}

export function bpForm(over: Partial<BlueprintForm> = {}): BlueprintForm {
  return {
    type: 'form',
    submitLabel: 'Enviar',
    columns: null,
    buttonVariant: 'primary',
    fieldBg: null,
    ...over,
  }
}

export function bpBox(
  children: BlueprintNode[],
  over: Partial<BlueprintBox> = {},
): BlueprintBox {
  return {
    type: 'box',
    card: false,
    layout: 'column',
    columns: null,
    columnsTemplate: null,
    columnsTablet: null,
    columnsMobile: null,
    align: null,
    justify: null,
    textAlign: null,
    wrap: null,
    bg: null,
    gradient: null,
    color: null,
    padY: null,
    padX: null,
    padYMobile: null,
    padXMobile: null,
    gap: null,
    gapMobile: null,
    maxWidth: null,
    minHeight: null,
    radius: null,
    shadow: null,
    borderWidth: null,
    borderColor: null,
    children,
    ...over,
  }
}

export function bpSection(
  children: BlueprintNode[],
  over: Partial<SectionBlueprint> = {},
): SectionBlueprint {
  return {
    type: 'section',
    name: 'Destaque',
    fullWidth: false,
    contentAlign: 'stretch',
    verticalAlign: 'center',
    bg: null,
    gradient: null,
    color: null,
    padY: null,
    padX: null,
    padYMobile: null,
    padXMobile: null,
    gap: null,
    gapMobile: null,
    maxWidth: null,
    minHeight: null,
    children,
    ...over,
  }
}

/** A hero: two columns, text on the left (heading, lead, buttons), photo
 * on the right. */
export function fakeHeroBlueprint(): SectionBlueprint {
  return bpSection(
    [
      bpBox(
        [
          bpBox(
            [
              bpText({ text: 'Para quem empreende', preset: 'overline' }),
              bpHeading({
                level: 'h1',
                text: 'Venda mais com menos esforço',
                sizePx: 56,
              }),
              bpText({ text: 'Tudo em um só lugar.', preset: 'lead' }),
              bpBox(
                [
                  bpButton({ label: 'Comece agora' }),
                  bpButton({ label: 'Ver como funciona', variant: 'outline' }),
                ],
                { layout: 'row', gap: 12 },
              ),
            ],
            { gap: 24, align: 'start' },
          ),
          bpImage({ ratio: '4/3', radius: 16 }),
        ],
        {
          layout: 'grid',
          columns: 2,
          columnsTemplate: '1fr 1fr',
          gap: 48,
          align: 'center',
        },
      ),
    ],
    { bg: '#ffffff', padY: 96, padX: 24, maxWidth: 1200 },
  )
}

export function fakeCapture(
  over: Partial<ReferenceCapture> = {},
): ReferenceCapture {
  return {
    url: 'https://ref.example/home',
    title: 'Referência',
    desktop: {
      width: 1440,
      height: 3000,
      strips: [
        'data:image/jpeg;base64,AAA',
        'data:image/jpeg;base64,BBB',
        'data:image/jpeg;base64,CCC',
      ],
      blocks: [
        {
          y: 0,
          height: 900,
          tag: 'section',
          style: { 'background-color': '#ffffff', 'padding-top': '96px' },
          text: 'Título da referência',
          children: [
            {
              y: 100,
              height: 80,
              tag: 'h1',
              style: { 'font-size': '56px', color: '#111827' },
              text: 'Título grande',
            },
          ],
        },
        {
          y: 1000,
          height: 900,
          tag: 'section',
          style: { 'background-color': '#f3f4f6' },
          text: '',
        },
      ],
    },
    mobile: { width: 390, height: 5000, strips: [] },
    fonts: ['Inter'],
    ...over,
  }
}
