# Steel Canvas — catálogo de e-mail (fase E1)

Catálogo `email`, versão 2, em `src/lib/canvas-email/`. Motor e regras gerais:
[README](./README.md) e [ADR 0026](../adr/0026-steel-canvas-shared-drag-and-drop-engine.md).

## Estrutura

```
email.body (raiz: largura, fundos, fonte, cores, pré-cabeçalho)
├── email.section (1 a 4 colunas; fundo cor/imagem/degradê, borda, cantos)
│   └── email.column (largura %, alinhamento vertical, fundo, empilhar no celular)
│       └── blocos
└── email.footer (obrigatório, único, sempre o último — descadastro + endereço)
```

Blocos por categoria da paleta:

| Categoria | Blocos |
|---|---|
| Básicos | Seção, Coluna, Título, Texto (rico), Botão, Imagem, Divisor, Espaço, Lista |
| Marca | Logo, Redes sociais, Menu, Assinatura |
| Vendas | Produto (produto do CRM → nome, descrição e preço), Cupom |
| Relacionamento | Depoimento, Pesquisa NPS, Evento, Vídeo (capa + link) |
| Avançado | HTML (só OWNER/ADMIN, sanitizado) |

## Regras

- **Mesmo código no editor e no envio**: cada componente renderiza com React
  Email, estilos inline e tabelas (`role="presentation"`, padding no `td`).
  O envio, o teste, a campanha e os fluxos multicanal passam por
  `renderEmailDocument` (`render.tsx`), com `editing: false` — sem
  `data-canvas-id`, sem dicas do editor, nós ocultos fora.
- **Celular**: valores responsivos são `{ base, mobile }`. No editor o
  breakpoint ativo resolve inline; na saída o desktop fica inline e cada
  sobrescrita de celular vira uma regra de media query numa classe do nó
  (`ec-<id>` na célula, `ec-<id>-t` no texto). Colunas empilham com
  `ec-stack`; "ocultar no celular/computador" usa `ec-hide-m`/`ec-show-m`.
- **Outlook**: o container ganha uma tabela fantasma de largura fixa
  (comentário condicional) e, com fonte do Google, um fallback para Arial.
- **Cores**: `token:primary` e afins vêm da marca do workspace
  (`emailColorTokens`); token desconhecido cai na paleta padrão, nunca em
  variável CSS.
- **Variáveis** (`{{primeiro_nome}}`, `{{campaign_link}}`…) atravessam a
  renderização intactas; cada destinatário só recebe a substituição.
- **Redes sociais** saem como botões de texto, não ícones em imagem: não
  dependem de host externo nem somem quando o leitor bloqueia imagens.
- **Vídeo** é a capa com link para a página do vídeo (leitores de e-mail não
  tocam vídeo).

## Servidor

- `CrmEmailTemplate.builderDocument` aceita a versão 1 (modelos travados) ou
  a 2. Na 2, o serviço normaliza (rodapé no fim, texto rico e HTML
  sanitizados), valida com `validateDocument` do motor + regras do e-mail
  (`validateEmailDocument`) e recusa com `CRM_EMAIL_CANVAS_INVALID` (422,
  `details.issues` com todos os problemas).
- Bloco de HTML novo ou alterado por quem não é OWNER/ADMIN →
  `CRM_EMAIL_CANVAS_HTML_FORBIDDEN` (403). Remover é livre.
- Um template passa da versão 1 para a 2, nunca o contrário.
- `POST …/email-templates` com `builderLayout` + `builderVersion: 2` cria o
  template já como documento do canvas.
- Templates versão 1 continuam renderizando pelo renderizador antigo até
  serem salvos pelo editor novo (sem mudança visual para quem já envia).

## Conversor v1 → v2

`openEmailDocument(stored)` abre qualquer documento salvo: a versão 2 como
está, a 1 convertida (`convertV1Document`), lixo como `null`. Cada seção da
v1 vira uma seção com uma coluna e os blocos equivalentes; ids derivados dos
ids da v1 (converter duas vezes dá o mesmo documento); seções opcionais
ocultas continuam ocultas (`meta.hidden`). Os testes comparam, para os 8
modelos, o texto, os links e as imagens do e-mail antigo e do convertido.

## Seções prontas e checklist

- `EMAIL_PRESETS`: 1 a 4 colunas e uma seção pronta por tipo da v1
  (cabeçalho, destaque, texto, imagem, botão, lista, produtos, cupom,
  evento, NPS, depoimento, assinatura). `EMAIL_STARTERS`: os 8 modelos da
  galeria como documentos v2.
- `emailChecklist({ doc, subject, html })`: assunto vazio, sem
  pré-visualização, acima de 102 KB (o Gmail corta), imagem sem texto
  alternativo, botão/NPS/vídeo sem link, variável desconhecida ou mal
  escrita.

## Para a fatia do editor

- Envolver o `CanvasEditor` com `EmailRenderProvider` (marca, produtos e
  `lookup` lendo o documento do store — a coluna usa para dividir larguras).
- `createEmailCatalog({ allowHtml })` esconde o bloco de HTML da paleta de
  quem não é admin; `EMAIL_TYPOGRAPHY_FONTS` alimenta o controle de
  tipografia; `emailColorTokens(brand)` os tokens de cor.
- O campo `productId` usa um controle de texto provisório: trocar por um
  seletor de produtos do CRM (`custom`).
