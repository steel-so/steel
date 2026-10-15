# Steel Canvas — motor dos construtores de e-mail e sites

Decisão de arquitetura: [ADR 0026](../adr/0026-steel-canvas-shared-drag-and-drop-engine.md).

## Peças

| Onde | O quê |
|---|---|
| `src/lib/canvas/types.ts` | Documento normalizado, nó, breakpoints, `Responsive<T>`, fragmento |
| `src/lib/canvas/registry.ts` | Definição de componente, descrição do inspetor, `defineCatalog` |
| `src/lib/canvas/ops.ts` | Operações puras, validação, `canDrop`, clonagem, `resolveResponsive` |
| `src/lib/canvas/store.ts` | Estado do editor: seleção, histórico, breakpoint, zoom, área de transferência |
| `app/_components/canvas/` | Shell: barra superior, barra lateral (Adicionar, Camadas + abas do catálogo), canvas em iframe com camada de edição, inspetor gerado, controles |
| `src/lib/canvas-email/` | Catálogo de e-mail (React Email) — fase E1 |
| `src/lib/canvas-site/` | Catálogo de sites — fase S1 |

## Editor

- **Esquerda**: Adicionar (paleta do catálogo por categoria, com busca),
  Camadas (árvore com renomear, ocultar, travar e arrastar), e as abas do
  catálogo (Seções prontas, Salvos, Estilos globais, Páginas, Mídia).
- **Centro**: o canvas com os componentes reais, linha azul onde o item vai
  cair, destinos inválidos recusados, duplo clique no texto edita ali mesmo
  (TipTap) com barra flutuante.
- **Direita**: sem seleção, configurações do documento; com seleção, o
  inspetor do componente nas abas Conteúdo, Estilo e Avançado. Campos
  responsivos mostram em qual breakpoint há sobrescrita.
- **Atalhos**: Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / Ctrl+V, Ctrl+D (duplicar),
  Delete, setas para mudar a seleção, Esc sobe para o pai, Ctrl+S salva.

## Fases

| Fase | Entrega |
|---|---|
| B0 | Motor (núcleo + shell) com catálogo de demonstração |
| E1 | E-mail livre: linhas, colunas, blocos básicos, rodapé obrigatório, render idêntico no envio, conversor da v1 |
| E2 | Blocos de marca/vendas/relacionamento, seções prontas, blocos salvos, estilos globais, versões, checklist de envio |
| E3 | Bloco condicional por contato, produtos dinâmicos, ajustes só no celular, IA nos blocos |
| S1 | Sites: site e páginas, layout em fluxo, ~15 elementos, tema, breakpoints, formulário do CRM, subdomínio, migração das landing pages, menu "Sites" |
| S2 | Nível Wix: galeria, carrossel, abas, popups, animações, posição livre, componentes globais, mídia, versões, SEO |
| S3 | Nível WordPress: blog, coleções, domínio próprio com TLS, redirecionamentos, sitemap, conversões |
| S4 | Coedição (Yjs), gerador de site com IA, teste A/B; loja e área de membros a decidir |

## Núcleo do motor (`src/lib/canvas/`)

| Arquivo | O quê |
|---|---|
| `ops.ts` | `applyOp`, `canDrop`, `cloneFragment`, `fragmentForType`, `createDocument`, `validateDocument`, `getNode`, `parentOf`, `resolveResponsive` |
| `store.ts` | `createCanvasStore`: histórico, seleção, área de transferência, estado salvo |
| `nodes.ts` | Documentos derivados sem copiar o mapa de nós (sobreposição) |
| `tree.ts` | Índice de pais por documento (WeakMap), derivado a cada operação |
| `draft.ts` | Cópia de trabalho de uma operação ou de um lote |
| `rules.ts` | Regras do catálogo (accepts, parents, min/max, props) |
| `path.ts` / `responsive.ts` | Caminhos com ponto (`style.padding.top`) e valores por breakpoint |
| `app/_components/canvas/use-canvas.ts` | `CanvasStoreProvider`, `useCanvasStore(selector, isEqual?)`, `useCanvasStoreApi`, `useCanvasNode` |

Regras que quem usa o motor precisa saber:

- **Leia nós com `getNode(doc, id)`** (ou `useCanvasNode`). Um documento
  produzido por `applyOp` guarda só o que mudou sobre o anterior;
  `doc.nodes` continua sendo um `Record` de verdade (JSON, spread,
  `Object.values`), mas é montado no primeiro acesso — O(n) uma vez por
  documento. Assim cada operação custa O(profundidade): ~0,03–0,05 ms num
  documento de 2.000 nós.
- **Identidade preservada**: nós não tocados mantêm o mesmo objeto; uma
  operação que não muda nada devolve o mesmo documento (e não entra no
  histórico).
- **`move.to.index` é a linha de soltar** entre os filhos *atuais* do destino;
  dentro do mesmo pai o motor desconta a vaga do próprio nó.
- **Travado** (`meta.locked`) impede mover e excluir (inclusive excluir um
  ancestral); editar props e meta continua permitido (é como destravar).
- **Desfazer/refazer** reaplicam a inversa com `replay: true`: ignoram
  `LOCKED` e `REQUIRED`, mas não as regras estruturais.
- **Histórico**: até 200 passos; `update`s seguidos no mesmo nó e nos mesmos
  caminhos em até 500 ms viram um passo só (`coalesce: false` força passo
  novo). Salvar (`markSaved`) quebra a fusão. `markSaved(doc)` marca o
  instantâneo enviado ao servidor, então o que foi digitado durante o
  salvamento continua "não salvo".
- **Colar** entra dentro do nó âncora quando ele aceita o conteúdo; senão,
  logo depois dele. Copiar vários nós gera um fragmento com `roots`.
- Erros novos além do contrato inicial: `UNKNOWN_TYPE`, `DUPLICATE_ID` e
  `INVALID_DOCUMENT` (forma inválida, catálogo/versão errados, nó órfão).

## Shell do editor (`app/_components/canvas/`)

| Arquivo | O quê |
|---|---|
| `canvas-editor.tsx` | `CanvasEditor` (props em `types.ts`): cria o store, autosave (1,5 s), toasts de operação recusada, aviso de tela pequena |
| `top-bar.tsx` | Título, breakpoints, zoom, desfazer/refazer, prévia escura, estado de salvamento, ações |
| `sidebar/` | Abas Adicionar (paleta com busca e arrastar), Camadas (árvore: renomear, ocultar, travar, arrastar), Seções prontas e as abas do catálogo |
| `frame/` | Iframe com portal React (`frameHead` no `<head>`), camada de edição no documento pai (contorno, seleção, ações rápidas, linha de soltar), edição de texto no lugar (TipTap) com barra flutuante |
| `dnd/canvas-dnd.tsx` | `@dnd-kit`: mouse e teclado (espaço pega, setas movem, espaço/Enter solta, Esc cancela), rolagem automática |
| `inspector/` | Inspetor gerado (abas Conteúdo/Estilo/Avançado) e um controle por `InspectorControl` em `inspector/controls/` |
| `use-shortcuts.ts` | Atalhos (abaixo) na página e dentro do iframe |
| `__demo__/` | Catálogo de demonstração + playground `/<workspace>/canvas-lab` |

O que um catálogo precisa fazer para funcionar no shell:

- **Espalhar `attributes`** no elemento mais externo de cada componente
  (`<td {...attributes}>`). É o `data-canvas-id` que o canvas usa para
  selecionar, contornar e calcular onde o item cai. Na saída final vem vazio.
- **`icons`** no catálogo: o mapa de nomes (`icon: 'button'`) para ícones
  Hugeicons. Nome desconhecido cai num ícone neutro. Opções de `segmented`
  também podem usar os nomes prontos `text-left|center|right|justify`,
  `align-top|middle|bottom|left|center|right`.
- **Valores dos controles compostos** seguem `src/lib/canvas/values.ts`
  (cor, espaçamento, cantos, borda, sombra, tipografia, fundo, imagem, link,
  tamanho, visibilidade), com os schemas Zod e os helpers de CSS
  (`spacingToCss`, `backgroundToCss`, `resolveColor`…). Use
  `responsiveSchema(x)` para campos `responsive: true`.
- **`defineComponent<P>()`** tipa uma definição com as próprias props.
- Editar no lugar: `inlineText: { path, rich }`. Texto simples termina com
  Enter/Esc; rico usa as marcas do controle `richtext` do mesmo caminho.

Decisões do shell:

- O iframe cresce com o conteúdo e quem rola é o palco; a camada de edição
  fica no documento pai, então nada dela entra na saída.
- O alvo de soltar não usa *droppables*: a cada movimento o ponteiro é
  testado no iframe (`elementFromPoint`) ou na árvore de Camadas, e o
  `canDrop` do motor decide. Borda de um container (até 12 px) significa
  "antes/depois dele"; dentro, a posição entre os filhos.
- **Abaixo de 1024 px** o editor mostra "Use uma tela maior para editar": a
  barra lateral, o canvas e o inspetor não cabem lado a lado em tablet em pé.
- O playground abre fora de produção; em produção só com `CANVAS_LAB=true`.
- `store` (opcional): o chamador cria o store com `createCanvasStore` quando
  o contexto de render do catálogo precisa ler o documento vivo (e-mail).
- `dependsOn(doc, node)` na definição: o que o componente lê de outros nós;
  o canvas redesenha o nó quando esses valores mudam.

Atalhos: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+C / Ctrl+X / Ctrl+V,
Ctrl+D, Delete/Backspace, ↑/↓ irmão anterior/próximo, Alt+↑/↓ move o
elemento, ← pai, → primeiro filho, Esc sobe para o pai, Enter edita o texto,
Ctrl+S salva, Ctrl+= / Ctrl+- / Ctrl+0 zoom.

## Catálogo de e-mail (`src/lib/canvas-email/`)

Fase E1 entregue: catálogo `email` versão 2 (corpo → seção → coluna →
blocos, rodapé obrigatório), render idêntico no editor e no envio, conversor
da v1, seções prontas e checklist. Detalhes, regras e o que a fatia do editor
precisa saber: [email-catalog.md](./email-catalog.md).

Fases E2/E3 entregues no editor do CRM: blocos salvos do workspace,
histórico de versões com restauração, IA nos blocos (escrever, reescrever,
gerar seção), conteúdo condicional por contato ("Mostrar se") e ajustes só
no celular — ver [email-catalog.md](./email-catalog.md#fases-e2-e-e3-no-editor).

## Catálogo de sites (`src/lib/canvas-site/`)

Catálogo `site`, versão 1, breakpoints `base` (≥ 1024 px), `tablet`
(768–1023 px) e `mobile` (< 768 px).

| Arquivo | O quê |
|---|---|
| `catalog.tsx` | `createSiteCatalog(ctx)`, `siteCatalog` (sem contexto, para validar) e `validateSiteDocument` |
| `schemas.ts` | Props de cada componente (Zod); campos responsivos com `responsiveSchema` |
| `theme.ts` | Tema do site: paleta (`token:<id>`), fontes, estilos de texto h1–h6/lead/body/small/overline, botões, links, escala de espaçamento, cantos, sombras, largura do conteúdo; `parseSiteTheme` completa e corrige entradas parciais |
| `styles.ts` + `css.ts` | Compilador de CSS: props → classes `s-<hash>` determinísticas e media queries por breakpoint |
| `components/` | Renderização em HTML semântico; `attributes` só no editor |
| `render.tsx` | `SiteDocument` (saída final, sem código do editor), `needsFormScript` |
| `presets/` | Seções prontas (15 tipos × 3 estilos) e 5 modelos de página |

Estrutura: `site.page` → `site.section` (faixa de largura total: fundo cor,
gradiente, imagem ou vídeo, sobreposição, altura mínima, âncora) →
`site.container` (flex ou grade, aninhável, tudo responsivo) → elementos
(`heading`, `text`, `button`, `image`, `icon`, `video`, `divider`, `spacer`,
`list`, `form`, `menu`, `social`, `embed`). `site.columns` é só um item da
paleta que insere uma grade com colunas.

Regras do compilador:

- Cada tipo tem uma função de estilo que recebe as props já resolvidas para
  um breakpoint. `tablet` guarda só o que muda em relação a `base`, e
  `mobile` só o que muda em relação a `tablet`; propriedade que some volta
  a `initial`. O conjunto vira um hash, então estilos iguais dividem a
  mesma classe e o mesmo documento sempre gera o mesmo CSS.
- Cores do tema ficam como `var(--canvas-<token>)`: trocar o tema muda só a
  folha do tema, nunca as classes dos nós.
- Tema e regras estruturais ficam na camada `@layer s-base`; qualquer regra
  de nó vence, sem disputa de especificidade.
- Visibilidade por breakpoint usa as classes `s-hide-<bp>` (no editor o nó
  fica esmaecido em vez de sumir).
- Valores digitados (fontes, URLs, modelo de colunas) passam por
  `cssValue`, que impede fechar a regra ou o `<style>`.

Para quem usa:

- **Editor (site-ui)**: `createSiteCatalog({ pages, currentPageId, canEmbed,
  formPicker })`, `frameHead={<SiteFrameStyles theme />}`
  (`app/_components/canvas-site/`), `colorTokens={siteColorTokens(theme)}`,
  `viewportWidths={SITE_VIEWPORT_WIDTHS}`, `presets={SITE_PRESETS}`.
- **Runtime público**: `<SiteDocument doc context />` para cada documento
  (página e globais; globais usam `tag: 'div'` na raiz) e
  `compileSiteCss([globais, página], { theme })` num `<style>`. Quando
  `needsFormScript(docs)`, inclua `SITE_FORM_SCRIPT` uma vez, com o nonce da
  CSP. O formulário posta JSON em `/api/crm/forms/<token>/submit` (troque
  com `formAction`).
- **CSP**: vídeos do Vimeo precisam de `player.vimeo.com` em `frame-src`;
  o `site.embed` em modo HTML usa `srcdoc` com `sandbox` e herda a CSP da
  página.
- `site.embed` só aparece na paleta com `canEmbed` (administradores); o
  backend deve recusar documentos com `SITE_ADMIN_ONLY_TYPES` vindos de
  quem não é administrador.

O playground (`/<workspace>/canvas-lab`) tem a chave **Demonstração / Site**
e um seletor de modelo no modo Site.
