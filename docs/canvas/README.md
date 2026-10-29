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
| S3 | Só domínios: subdomínio do Steel e domínio próprio do cliente com TLS (depende de infraestrutura — issue #91). Até lá, os sites ficam em `/s/<site>` |
| Conteúdo | Blog e coleções (CMS), antes previstos no S3; redirecionamentos, sitemap e conversões já entraram na S2 |
| Buscadores | SEO, AEO e GEO: perfil do negócio, notas por página, robots por robô de IA, `llms.txt`, editor de dados estruturados |
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
- `tracksSelection` (S2): o canvas passa `activeChild` — o filho no caminho
  até a seleção, ou o último que esteve — para o componente mostrar o que
  está sendo editado (slide, aba, item, popup).
- `readsChildren` (S2): o render recebe `childNodes` (rótulos das abas,
  títulos do acordeão desenhados pelo pai); redesenha só quando um filho
  direto muda.
- `freeLayout: { childPath, enabled(props, breakpoint) }` (S2): filhos de um
  nó em posição livre são arrastados no canvas com guias de alinhamento
  (bordas e centro do container e dos irmãos; Alt desliga o ímã). O arraste
  grava `<childPath>.x` e `<childPath>.y` no breakpoint ativo.

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

## Fase S2 — elementos "nível Wix"

Novos tipos do catálogo `site` (a versão do catálogo continua 1: só há
props e tipos novos, nenhum documento antigo muda):

| Tipo | Elemento | Observações |
|---|---|---|
| `site.gallery` | Galeria | Grade ou mosaico; "Ampliar ao clicar" abre a lightbox |
| `site.carousel` + `site.slide` | Carrossel | Qualquer conteúdo no slide; setas, indicadores, passagem automática (pausa no mouse, foco, toque e botão), arrastar no celular (scroll-snap nativo) |
| `site.tabs` + `site.tab` | Abas | Padrão WAI-ARIA (setas, Home/End); sem JS mostra todos os painéis |
| `site.accordion` + `site.accordion-item` | Acordeão (FAQ) | `<details>` nativo, um aberto por vez via `name` |
| `site.popup` | Popup | Filho da página; abre por clique (interação ou link `#âncora`), ao carregar, depois de N s, ao rolar X % ou na intenção de saída; frequência por visita/visitante; `<dialog>` modal (foco preso, Esc fecha, foco volta) |
| `site.countdown` | Contagem regressiva | Data, hora e fuso (UTC±) do próprio elemento |
| `site.stats` | Números | Contagem animada ao aparecer; o HTML já traz o valor final |
| `site.testimonials` | Depoimentos | Grade ou carrossel |
| `site.pricing` | Tabela de preços | Planos com destaque, selo e botão |
| `site.logos` | Logos | Grade ou faixa rolando (CSS puro) |
| `site.map` | Mapa | Google Maps por endereço; por padrão só carrega após o clique (LGPD) |
| `site.whatsapp` | Botão do WhatsApp | Flutuante ou na página; número digitado ou de uma conexão da Comunicação |
| `site.before-after` | Antes e depois | `<input type=range>` nativo sobre as duas imagens |

Efeitos em qualquer elemento (props comuns, aba Avançado/Estilo):

- **Ao clicar** (`interaction`): abrir/fechar popup, rolar até uma âncora, ir
  para página/URL, mostrar/ocultar elemento. Alvos são âncoras (`id`);
  popups sem âncora usam `popup-<id do nó>`.
- **Animação de entrada** (`animation`): efeito, ao abrir ou ao aparecer,
  duração, atraso e aceleração. `prefers-reduced-motion` desliga tudo.
  Use "Ao abrir" no topo da página (não atrasa o LCP).
- **Ao passar o mouse** (`hover`): cor de fundo/texto/borda, sombra, escala,
  elevar, opacidade — em botões, containers (cartões), imagens e ícones;
  vale também para foco do teclado.
- **Posição livre**: no container, "Posicionamento: Livre" (por
  breakpoint); cada filho guarda `place.x`, `place.y`, `place.width` e
  `place.z` por breakpoint. O fluxo continua sendo o padrão.

Runtime público (`src/lib/canvas-site/runtime/`):

- `siteRuntimeScripts(docs)` devolve `boot` (uma linha que marca `html.s-js`
  antes do conteúdo) e só os scripts das funções usadas: `form`,
  `carousel`, `tabs`, `actions` (popups e interações), `lightbox`,
  `countdown`, `stats`, `map`, `before-after`, `reveal`. Cada um é JS puro
  pequeno, inline com o nonce da CSP; nada do editor vai para a página.
- O CSS estrutural dos elementos novos (`static-css-elements.ts`) também só
  entra quando a página usa o elemento.
- A CSP libera `https://www.google.com` em `frame-src` (mapa).
- A prévia do editor roda os mesmos scripts (exceto o do formulário).

Editor:

- Carrossel, abas e acordeão mostram o filho selecionado; clicar num
  indicador ou numa aba no canvas seleciona aquele slide/aba. Popups ficam
  recolhidos num selo "Popup: nome" até serem selecionados (pelo selo ou
  pelas Camadas).
- O inspetor do carrossel, das abas e do acordeão tem "Adicionar
  slide/aba/item"; o alvo de "Ao clicar" é escolhido numa lista de âncoras e
  popups da página; o WhatsApp lista as conexões da Comunicação.
- Seções prontas novas (12 tipos × 3 estilos) e o modelo "Evento e
  lançamento".


## Sites — fase S2, plataforma

### Documento próprio dos sites publicados

O app tem **uma raiz por grupo**: cada grupo do Steel (`(private)`,
`(public)`, `(web)`, `onboarding`, `upgrade`) renderiza
`app/_components/root/steel-root.tsx` (estilos, JSON-LD, cookies e
rastreadores do Steel), e o site publicado tem a sua em
`app/(sites)/s/[siteSlug]/layout.tsx`: `lang="pt-BR"`, a CSP do site como
primeiro item do `<head>`, a fonte Geist e nada do Steel. URLs que não casam
com rota nenhuma caem em `app/global-not-found.tsx`
(`experimental.globalNotFound`). Navegar entre duas raízes recarrega a
página — o que já acontecia na prática entre esses grupos.

O App Router começa a responder (200) antes de a página decidir que não
existe, então o **status HTTP é decidido no `proxy.ts`**: ele lê um índice
de rotas do site publicado (caminhos das páginas + redirecionamentos,
`SitePublicService.routeIndex`, em cache no Redis `site-routes:<slug>` e
expirado junto com a tag do site a cada publicação, renomeação, exclusão ou
mudança de redirecionamento). Página inexistente responde **404 de
verdade** (uma página "Página não encontrada" simples, sem scripts, com link
para a inicial), redirecionamento **301/302**. Se o Redis e o banco falharem, a página decide sozinha (404
vira tela com `noindex`, redirecionamento vira 308/307).

O runtime não leva mais componente React de cliente: um script inline
(`src/lib/sites/runtime-script.ts`) cuida do aviso de cookies, do beacon de
visita e conversão e dos rastreadores.

### Rastreamento (GA4, Tag Manager, Pixel) e LGPD

- Os IDs ficam em **Configurações do site → Métricas**.
- Rastreador **só carrega depois que o visitante clica em Aceitar** no aviso
  de cookies do site. Com qualquer ID preenchido o aviso aparece **mesmo com
  a chave do aviso desligada**. "Rejeitar" não carrega nada. A escolha fica no
  `localStorage` (`steel-site-consent:<slug>`).
- A métrica anônima do Steel (sem cookie, hash diário no servidor) segue a
  regra da S1: sem aviso, conta na hora; com aviso ligado, só depois do
  Aceitar.
- Envio de formulário do CRM vira **conversão** (`kind = CONVERSION` em
  `site_views`) e, com consentimento, `generate_lead` no GA4,
  `steel_form_submit` no `dataLayer` e `Lead` no Pixel.

**CSP em duas camadas** (`src/lib/sites/csp.ts`), ambas aplicadas pelo
navegador (vale a interseção):

1. Cabeçalho, no `proxy.ts`, para `/s/<slug>` e `<slug>.<SITES_ROOT_DOMAIN>`:
   scripts do próprio site por nonce + origens dos três rastreadores. Nenhum
   serviço do Steel (Axiom, Sentry, socket da Wiki) entra.
2. `<meta http-equiv="Content-Security-Policy">` por site: a mesma política
   só com as origens dos rastreadores que **aquele** site configurou.

Os rastreadores são injetados com o nonce da página. Tags do Tag Manager que
carregam scripts de outras origens (fora do Google) são bloqueadas pela CSP;
use as integrações nativas (GA4, Pixel) para elas. `frame-src https:` cobre
vídeos e o `site.embed` (só administradores, com `sandbox`).

### Métricas

- `GET /api/workspaces/{id}/crm/sites/{siteId}/analytics?from&to` (até 366
  dias; padrão 30): visitas, visitantes por dia, páginas, origens, UTM e
  conversões por página, com o período anterior para comparação.
- `GET /api/workspaces/{id}/crm/sites/analytics?days=14`: série diária de
  cada site (gráfico pequeno nos cards da lista).
- Dias contados no **fuso do site** (`settings.timezone`, padrão São Paulo).
  O visitante é o hash diário, então "visitantes" conta uma pessoa por dia.
- Tela: `/<workspace>/crm/sites/<siteId>/metrics` (também no menu do card e
  no ícone da barra do editor).

### SEO

- Cada página publica um grafo schema.org (`Organization`, `WebSite`,
  `WebPage`, `BreadcrumbList`). Nome, logo e perfis sociais da organização
  ficam em Configurações do site; sem eles, nome do site e favicon.
- Página com acordeão ganha também um `FAQPage`: cada item com título e
  resposta vira uma pergunta (itens ocultos ficam de fora).
- Imagem social por página (envio) → do site → **cartão gerado** em
  `/<site>/_og?page=<id>` (1200×630, cores do tema).
- Endereço canônico por página; página com canônico apontando para fora sai
  do sitemap. Prioridade e frequência de mudança vão para o `sitemap.xml`.
- Sem favicon próprio, o site usa a inicial do nome na cor primária — nunca
  o ícone do Steel.

### Redirecionamentos

- Tabela `site_redirects`, gerenciada em **Redirecionamentos** (ícone na
  barra do editor). Vale **na hora**, sem publicar.
- Origem exata (`/antigo`) ou prefixo (`/blog/*`); destino é caminho do
  site ou URL https. Destino terminado em `/*` leva o resto do caminho.
- Roda **antes** da busca da página. Permanente responde **301**,
  temporário **302**.
- Laços (direto ou em cadeia) são recusados (`SITE_REDIRECT_LOOP`).

### Componentes reutilizáveis (símbolos)

- Aba **Componentes** do editor: selecione uma seção e "Criar componente" —
  ela vira um global `SYMBOL` e a seção vira a primeira cópia (um passo de
  desfazer).
- Arraste (ou clique) um componente para inserir uma cópia: o nó
  `site.symbol` guarda só `symbolId` e `overrides` (texto por nó do
  componente: título, texto, rótulo de botão).
- "Editar" abre o componente no canvas; ao salvar, todas as cópias mudam.
- No inspetor da cópia, cada texto pode ser trocado só naquela cópia; vazio
  segue o componente.
- Um componente não pode conter outro (`SITE_DOCUMENT_INVALID`). Cópia de
  componente excluído não aparece no site.

### Canvas em modo padrão

O iframe do editor começa em `about:blank` (modo quirks). O shell agora
escreve um documento com `<!doctype html>` antes de montar, a raiz tem a
altura mínima do palco e um documento sozinho ocupa o palco todo (fundo do
e-mail). O ajuste da S1 que encolhia cabeçalho e rodapé saiu.

## Sites — blog e coleções (S4, fatia site-blog)

### Blog

- **Posts** (`site_posts`): título, endereço, resumo, corpo no editor Plate
  (o mesmo da Wiki/KB: títulos, listas, código, tabelas, colunas, imagens da
  mídia do site, vídeos e incorporações, destaque/callout, sumário), capa,
  autor, categorias, tags, destaque e SEO. O HTML público é gerado no
  servidor ao salvar (`src/lib/sites/blog/plate.ts`): só nós conhecidos,
  texto escapado e URLs conferidas — o site publicado não carrega o editor.
  Também guardamos o texto puro (busca, feeds, IA), um resumo automático e o
  tempo de leitura (200 palavras/min).
- **Publicação própria**: um post vai ao ar sem publicar o site. PUBLISHED
  com data passada é público na hora; data futura agenda (SCHEDULED) e o
  worker (`site-posts`, a cada minuto) publica no horário. O runtime já
  trata um agendado vencido como publicado, então um atraso do worker não
  atrasa o post. Datas no **fuso do site** (`settings.timezone`).
- **Autores** (`site_authors`): perfil público por site (nome, foto, bio,
  redes), ligado a um membro do workspace ou convidado (sem conta). Sem FK
  para o usuário: o perfil e os posts sobrevivem à conta.
- **SEO do post**: o mesmo modelo de SEO da página (título, descrição,
  imagem social, noindex, canônico) mais o bloco `seo.search` no formato da
  área **Buscadores** (palavra-chave, sinônimos, perguntas que o conteúdo
  responde, resumo citável). As perguntas viram o FAQ do post (acordeão no
  fim + `FAQPage`). Cada post publica um `BlogPosting` no grafo JSON-LD.
- **IA** (cota do assistente de IA do CRM): escrever post a partir de
  assunto/roteiro, gerar resumo, sugerir títulos e transformar em FAQ.
  Sempre rascunho para revisão no editor; nada é salvo sozinho.

### Páginas dinâmicas e modelos

| Endereço | Modelo |
|---|---|
| `/blog` (`?pagina=2`, `?busca=termo`) | Página do blog |
| `/blog/<post>` | Post |
| `/blog/categoria/<slug>` | Categoria (sem modelo próprio: o da página do blog) |
| `/blog/tag/<slug>` | Tag (idem) |
| `/blog/autor/<slug>` | Autor (idem) |
| `/<coleção>/<item>` | Página do item da coleção |

- Modelos são globais `TEMPLATE` (o `name` é a chave: `blog-index`,
  `blog-post`, `blog-category`, `blog-tag`, `blog-author`,
  `collection:<id>`), editados no canvas como qualquer página e publicados
  com o site. Sem modelo, o runtime usa o padrão embutido
  (`src/lib/sites/blog/templates.ts`) — o blog funciona antes de alguém
  mexer em modelo.
- Página comum vence página dinâmica (uma página `/blog` criada à mão é
  servida no lugar do índice).
- O índice de rotas do proxy inclui os endereços dinâmicos, então post
  inexistente responde 404 de verdade.

### Elementos novos do catálogo `site`

`site.post-list` (Lista de posts: mais recentes, da página — categoria,
tag, autor, busca —, em destaque ou relacionados; grade, cartões ou lista;
paginação; primeiro em destaque), `site.post` (o post atual), `site.post-terms`
(categorias/tags do blog ou do post), `site.blog-search`, `site.post-author`,
`site.collection-list` e `site.collection-field` (um campo do item atual,
para o modelo da página do item). Os dados chegam por
`SiteRenderContext.cms`, resolvidos antes do render
(`src/lib/sites/blog/resolve.ts`): no runtime, do banco; no editor, dos
posts do site (rascunhos inclusos) ou de um blog de exemplo quando ainda não
há post.

### Coleções

Tipos de conteúdo próprios (casos, equipe, vagas, imóveis…) com campos
tipados: texto, texto formatado, imagem, número, data, link, referência a
outra coleção do site e produto do CRM (nome e preço copiados ao salvar).
Itens publicados aparecem na hora; com a página do item criada, cada item
ganha `/<coleção>/<item>`.

### Feeds, sitemap e llms.txt

- `/feed.xml` (RSS 2.0) e `/atom.xml`; `?categoria=<slug>` filtra. Os últimos
  50 posts, com o HTML completo.
- O `sitemap.xml` inclui o blog, os posts (sem noindex/canônico externo) e os
  itens de coleções com página.
- `SiteBlogPublicService.llmsSections` + `renderLlmsSections` montam as
  seções "Blog" e de cada coleção para o `/llms.txt` da área Buscadores.

### Cache

Leituras do blog e das coleções usam a tag do site (`site:<slug>`) e vida
curta (`minutes`): salvar um post publicado expira na hora; um agendado
aparece sozinho em até alguns minutos.
## Coedição em tempo real (S4)

Decisão em [ADR 0027](../adr/0027-canvas-real-time-co-editing.md).

- **Onde liga:** `CanvasEditorProps.collaboration = { documentName, user }`.
  O editor de sites (página ou global) e o de e-mail v2 passam a sala
  (`canvasDocumentName('site-page' | 'site-global' | 'email-template', id)`)
  e o usuário da sessão, que vem da página do servidor. Sem a prop o
  editor funciona como antes.
- **Peças:** `src/lib/canvas-collab/` — `ydoc.ts` (modelo Yjs, props planas
  por caminho), `binding.ts` (`bindCanvasStore`: store ⇄ Y.Doc),
  `project.ts` (projeção válida de um estado remoto), `presence.ts`
  (awareness), `names.ts` (salas e mensagens). No shell,
  `app/_components/canvas/collab/` — `session.ts` (conexão, presença,
  flush), `hocuspocus.ts`, `collab-context.tsx`, `presence-bar.tsx`. No
  servidor, `src/services/canvas-collab.service.ts` e
  `canvas_collab_states`.
- **Store:** ganhou `onChange` (toda mudança de documento, com a op),
  `applyRemote` (sem passo de histórico) e `setTextGuard` (recusa editar
  texto travado por outra pessoa). Desfazer continua por usuário e é
  **comparar-e-gravar** por nó e campo (`src/lib/canvas/history-guard.ts`):
  desfazer/refazer só regrava um caminho de prop ou chave de meta que ainda
  tem o valor que o passo desta pessoa deixou. Campo que outra pessoa mudou
  depois fica como está, o resto do passo se aplica, e o editor avisa
  ("Parte do desfazer foi ignorada porque outra pessoa alterou o mesmo
  campo."). Passo sem nada a aplicar sai do histórico.
- **Salvar:** com a sala ao vivo, o servidor realtime grava (debounce do
  Hocuspocus); "Salvar"/Ctrl+S, publicar e enviar teste pedem gravação
  imediata (`canvas.flush`) e caem no REST se o servidor não confirmar. Sem
  realtime, o autosave REST de sempre; o selo "Sem colaboração em tempo
  real" aparece na barra.
- **Presença:** avatares de quem está no documento na barra, contorno com a
  cor e o nome da pessoa no que ela selecionou, e "Fulano está editando
  este texto" no texto em edição (os outros não conseguem abrir o mesmo
  texto).
- **Proxy:** usa o `/realtime` da Wiki — nenhuma regra nova no nginx nem no
  Apache de borda.
## Sites — fase S4, gerador com IA

"Novo site → Gerar com IA" monta um site inteiro a partir de um briefing curto; no editor, a aba **IA** gera uma seção, reescreve os textos da página e sugere imagens. Tudo usa o provedor, o modelo e a cota mensal da IA do CRM (ADR 0007/0019: feature `crm.aiAssistant`, consumo lançado como `CRM_ASSISTANT` com `module = CRM`).

**Princípio: a IA escreve, o catálogo monta.** O modelo nunca cria nós. A estrutura vem das seções prontas do catálogo (`SECTION_BUILDERS`, `ELEMENT_SECTION_BUILDERS`) e de algumas seções próprias do gerador (`src/lib/site-ai/sections.ts`: abertura de página, chamada para ação, contato com o formulário do CRM, produtos e depoimentos reais, contagem regressiva, cabeçalho e rodapé). O modelo só preenche **slots** (`src/lib/site-ai/slots.ts`): cada texto da árvore (título, parágrafo, botão, item de lista, pergunta, aba, plano, texto alternativo, ícone) vira um campo com id curto (`t1`…), papel, limite de caracteres e o texto de exemplo. Valor que não cabe no schema da prop é descartado e o campo fica com o texto do modelo de seção.

- **Dados reais não passam pela IA**: nós com nome de camada `Logo`, `Produto`, `Descrição do produto`, `Preço`, `Depoimento`, `Autor do depoimento` e `Direitos` ficam fora dos slots (nem a geração nem "Reescrever textos" mexem). Produtos vêm do CRM (`crm_products`, ativos), depoimentos das seções `TESTIMONIAL` das landing pages; sem esses dados, as seções `products`/`testimonials` não entram no plano. O prompt proíbe inventar números, preços, clientes e contatos ("Sob consulta" onde faltar preço).
- **Plano** (`plan.ts`): a primeira chamada escolhe estilo (kit), paleta, fontes, texto do botão e as seções de cada página; `normalizePlan` só aceita o que o briefing permite e completa com padrões (Início abre com `hero`, páginas internas com `intro`, um único formulário — na página Contato ou no fim do Início, no máximo 7 seções). A cor da marca do briefing sempre vence a do modelo; cor clara ganha texto escuro no botão.
- **Respostas** (`run.ts`): saída JSON estrita (structured outputs), lida com reparo (cercas, texto em volta, vírgula sobrando), conferida por Zod e por validação de domínio (todos os campos devolvidos). Se falhar, os problemas voltam ao modelo como nova mensagem — até 3 chamadas. Cada chamada lança o consumo na hora.
- **Validação**: links para âncoras que não existem viram link para a página Contato (ou para o Início); cada seção é validada sozinha por `validateSiteDocument` e a que falhar é descartada (com aviso), depois a página inteira. Nada é gravado antes de todas as páginas ficarem prontas; site, páginas (com SEO) e globais entram numa transação (`SiteRepository.createWithPages`).
- **Stream**: `POST /crm/sites/ai/generate` responde `text/event-stream` (`SiteAiEvent`: `steps` → `step`* → `done`/`error`), com `: ping` a cada 15 s para o proxy não derrubar a conexão; as páginas são escritas 3 por vez. Erros de permissão, plano, cota, limite de sites e formulário voltam antes do stream, no envelope JSON.
- **Imagens**: "Sugerir imagens" só deixa o modelo escolher entre a biblioteca de mídia do workspace (descrita pelos textos alternativos que o site já usa) e as fotos de exemplo do catálogo (`SITE_AI_PLACEHOLDERS`, servidas pelo próprio app). Nenhum endereço externo é aceito.
- **Custo**: `GET /crm/sites/ai` devolve a cota (usada, total, restante) e a estimativa de cada ação (`estimate.ts`: tokens típicos × preço do modelo × margem da plataforma). A tela mostra "Custo estimado ≈ … · Restam … da cota" e bloqueia quando a cota acabou.

Formulário de contato: o usuário escolhe um formulário publicado, pede um novo ("Contato pelo site", ação LEAD, criado e publicado no fim da geração) ou deixa para depois (o editor mostra "Escolha um formulário").
## Sites — Buscadores (SEO, AEO e GEO)

Três frentes, uma nota de 0 a 100 cada, calculadas por verificações
**determinísticas e puras** em `src/lib/sites/search/`:

| Frente | Para quem | O que pesa |
|---|---|---|
| **SEO** | Google e Bing | palavra-chave, título e descrição (tamanho e termo), endereço, um H1 e hierarquia, texto alternativo, links internos e externos, quantidade de texto, títulos repetidos no site, canônico/noindex, imagem social |
| **AEO** | trechos em destaque, "As pessoas também perguntam", assistentes de voz | títulos em forma de pergunta, resposta direta de 40–60 palavras logo depois, FAQ visível (acordeão → `FAQPage`), perguntas cadastradas, listas e tabelas, HowTo, resumo falável |
| **GEO** | ChatGPT, Perplexity, Gemini, Visões gerais do Google | perfil do negócio completo, NAP consistente (telefone do perfil = telefone do site), fatos com números/datas, resumo citável no topo, fontes de referência (.gov.br, .edu, .org, Wikipédia), atualização (data visível e `dateModified`), dados estruturados válidos, HTML semântico, acesso das IAs (robots.txt e llms.txt) |

Cada verificação devolve `pass`/`warn`/`fail`, um peso, a explicação em
pt-BR e, quando dá, uma **correção de um clique** (`SearchFix`): `patch` no
SEO da página, `canvas` (operações desfazíveis, ex.: rebaixar H1 extras),
`select` (seleciona o nó no inspetor), `insert-faq`, `insert-summary`,
`open` (leva ao campo/aba certa) e `ai`. A nota é a soma ponderada (aviso
vale metade). O editor e o relatório usam as mesmas funções, então a nota
do painel (documento ao vivo) e a do relatório (rascunho salvo) batem.

### Modelo de dados (sem migração)

- **Site** → `sites.settings.search` (`SiteSearchSettingsSchema`):
  `business` (perfil do negócio: tipo schema.org, nome, razão social,
  descrição, categoria, endereço, geo, telefone, e-mail, horários, área
  atendida, fundação, logo, `sameAs`, pessoas, faixa de preço), `crawlers`
  (`false` bloqueia o robô), `llms` (liga/desliga + recado), `indexNow`
  (liga/desliga + chave gerada pelo servidor) e `verification` (Google
  Search Console, Bing). Vai no snapshot: entra no ar ao publicar.
- **Conteúdo** → `seo.search` (`SearchContentSchema`): `focusKeyword`,
  `synonyms`, `questions` (pergunta + resposta direta), `summary`,
  `speakable`, `showUpdatedDate` e `structuredData` (Article, Product,
  Service, Event, HowTo, FAQPage, LocalBusiness; BreadcrumbList é
  automático).

**Blog e outros conteúdos reutilizam o mesmo modelo**: guarde
`SearchContentSchema` no JSON de SEO do post (`seo.search`), monte um
`SearchPageInput` (`page` = o post, `document` = o canvas do post,
`siblings` = os outros posts/páginas para títulos repetidos) e chame
`analyzeSearchPage`; os campos de UI (`KeywordFields`, `QuestionsEditor`,
`SummaryFields` em `app/_components/crm/sites/search/search-fields.tsx`) e o
`StructuredDataDialog` recebem `search` + `onSave(patch)` e não sabem se é
página ou post. Para o JSON-LD, `structuredDataNode` monta Article e os
demais; o perfil do negócio vem de `resolveBusinessProfile(settings)`.

Diálogos antigos que regravam `settings`/`seo` inteiros sem o bloco `search`
não o apagam: `keepStoredSearch` mantém o que estava salvo (site e página).

### Telas

- **Editor → aba Buscadores**: as três notas da página aberta (ao vivo),
  palavra-chave e sinônimos, verificações com correção, prévia do Google
  (computador/celular) e das redes, perguntas (salvar e "Inserir como seção
  na página" — vira um acordeão, logo `FAQPage`), resumo citável,
  speakable, "Atualizado em", "Como a IA resumiria esta página" e dados
  estruturados (com produto do CRM, validação e prévia do JSON-LD).
- **Configurações da página**: palavra-chave e as três notas.
- **`/<ws>/crm/sites/<id>/search`** (ícone de lupa na barra do editor):
  *Saúde* (médias, problemas por impacto somado, páginas com notas e
  "Otimizar com IA" em lote com revisão antes de aplicar), *Perfil do
  negócio* (rascunho preenchido com workspace, marca de e-mail e SEO do
  site) e *Rastreadores e feeds* (robô por robô, treino × busca explicado,
  prévia do robots.txt, llms.txt, IndexNow e verificação).

### Runtime público

| Arquivo | O quê |
|---|---|
| `/robots.txt` | um grupo `Disallow` por robô bloqueado, depois `*` liberado, sitemap e o link do llms.txt |
| `/llms.txt` | resumo em Markdown (llmstxt.org): perfil, fatos, páginas com resumo, perguntas frequentes |
| `/llms-full.txt` | texto de todas as páginas indexáveis em Markdown (até 400 mil caracteres) |
| `/indexnow-key.txt` | chave do IndexNow (só com ele ligado) |
| `/sitemap.xml` | `lastmod` da própria página (`updatedAt` no snapshot) |
| página | metatags de verificação, JSON-LD com perfil (Organization ou LocalBusiness), `dateModified`, `abstract`, `speakable` e os itens estruturados; "Atualizado em" no fuso do site |

**IndexNow**: a cada publicação, com ele ligado, as URLs indexáveis vão
para `api.indexnow.org` (Bing, Yandex, Seznam, Naver) — melhor esforço,
nunca bloqueia a publicação, resultado no Axiom (`site_indexnow.*`).

### IA

`POST …/search/ai/summary` (resumo como um mecanismo generativo leria, com
entidades, perguntas e sugestões) e `POST …/search/ai/optimize` (títulos,
descrições e respostas diretas para até 10 páginas, uma chamada por
página). Mesmo provedor, permissão de plano (`crm.aiAssistant`) e cota
mensal das outras IAs do CRM. Nada é gravado pela IA: `POST …/search/apply`
salva só o que o usuário marcou. Falha do provedor: `SITE_SEARCH_AI_FAILED`.

## Sites — elementos de newsletter (fatia nl-archive, ADR 0054)

Categoria **Newsletter** do catálogo `site`:

- `site.newsletter-subscribe` (Inscrição na newsletter): escolhe uma
  newsletter `ACTIVE` do workspace (`newsletterId`, com `newsletterName` de
  fotografia). Título, nome opcional, texto do botão, e-mail e botão
  empilhados ou lado a lado (responsivo), estilo do botão e fundo dos campos.
  O texto de consentimento é sempre `CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT`.
  O script `newsletter` do runtime (`SITE_NEWSLETTER_SCRIPT`, só em páginas
  com o elemento) posta JSON em `POST /api/newsletters/subscribe` com
  `source: 'SITE'` e `sourceRef: <id do site>`, respeita o honeypot `website`
  e troca o formulário por "confira seu e-mail" (confirmação dupla) ou
  "inscrição feita".
- `site.newsletter-issues` (Últimas edições): 1 a 12 edições `SENT`, em
  cartões (1–3 colunas, responsivo) ou lista, com número, data (fuso do site,
  `SiteRenderContext.timeZone`) e resumo, e o link "Ver todas as edições".
  Links absolutos para `/n/<ws>/<newsletter>` (o site pode estar em outro
  domínio); sem arquivo público, nada é listado.

Dados: `SiteRenderContext.newsletters` (por id). No runtime vêm de
`loadSiteNewsletters` (tag do site, vida `minutes`); no editor e na prévia, de
`GET /api/workspaces/<id>/crm/sites/newsletters` (`useLiveSiteNewsletters`),
que também alimenta o seletor `SiteNewsletterPicker`. Newsletter arquivada,
excluída ou CRM desligado: os elementos somem da página publicada.
