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

## Editor no CRM

`/<workspace>/crm/email-templates/new` e `/<workspace>/crm/email-templates/<id>`
(código em `app/_components/crm/email-editor/`).

- **Novo template**: galeria com "Em branco" (`createBlankEmailDocument`:
  uma coluna vazia e o rodapé) e os `EMAIL_STARTERS` com miniatura real na
  marca do workspace, filtro por categoria. Cria com
  `POST …/email-templates` — `builderLayout` + `builderVersion: 2` para um
  modelo, `builderDocument` para o em branco.
- **Editor**: `CanvasEditor` com o catálogo de `createEditorEmailCatalog`
  (contexto de render lido a cada render, bloco de HTML só para
  OWNER/ADMIN, seletor de produtos do CRM no lugar do campo de texto de
  `productId`). O store é criado pela página e passado em `store`, porque o
  contexto do catálogo lê o documento vivo.
- **Barra superior**: voltar, nome do template e o "envelope" (assunto e
  texto de pré-visualização num popover). Nome e assunto salvam sozinhos
  (1 s) pelo `PATCH` do template; o documento, pelo autosave do shell como
  `builderDocument` v2. À direita: Checklist, Visualizar e Enviar teste.
- **Checklist** (`emailChecklist`): contador na barra; clicar num item
  seleciona o bloco. Antes do teste o checklist aparece de novo — erros
  (assunto vazio, variável errada) impedem o envio, avisos não.
- **Visualizar**: o HTML exato do envio, no computador ou celular, claro ou
  escuro, com as variáveis de um contato do CRM, do contato de exemplo ou
  cruas, e a linha da caixa de entrada (remetente, assunto, pré-visualização).
- **Abas extras**: "Estilos globais" (fonte, cores e largura do e-mail;
  estilo de todos os botões de uma vez; marca do workspace) e "Variáveis"
  (adiciona a variável ao título/texto/botão selecionado, ao assunto, ou
  copia).
- **Templates v1** abrem no editor antigo com "Abrir no novo editor":
  converte com `openEmailDocument` e salva como v2 depois de uma
  confirmação. Não tem volta.
- **Lista**: o tipo "Novo editor" marca os templates v2.

### Redesenho entre nós

Um componente cuja aparência depende de outros nós declara `dependsOn(doc,
node)` (registro do motor). O `NodeView` assina esses valores e redesenha
o nó quando um deles muda. O catálogo de e-mail declara as props do corpo
para todos (fonte, cores, largura) e as larguras das irmãs para a coluna —
antes, mudar a largura de uma coluna só redesenhava as outras na próxima
mudança da seção.

## Fases E2 e E3 no editor

### Blocos salvos ("Salvos")

- Selecione uma seção ou um bloco e use "Salvar seção/bloco selecionado":
  nome e categoria (Cabeçalhos, Conteúdo, Chamadas, Produtos, Rodapés e
  assinaturas, Outros). O bloco vale para **todo o workspace**.
- O fragmento (`CrmEmailSavedBlock.fragment`) passa pela mesma validação do
  documento: `validateEmailFragment` (`fragments.ts`) coloca o fragmento num
  e-mail mínimo (corpo → seção → coluna → bloco, rodapé) e roda
  `validateEmailDocument`; texto rico e HTML saem sanitizados. Só seção ou
  bloco de conteúdo pode ser salvo (`CRM_EMAIL_SAVED_BLOCK_INVALID`), bloco
  de HTML só por OWNER/ADMIN, até 200 por workspace.
- Na aba, cada bloco tem prévia real (render do fragmento na marca do
  workspace), busca, renomear e excluir; arrasta para o canvas ou insere com
  clique, como as seções prontas. Inserir copia o conteúdo (ids novos):
  editar ou excluir o bloco salvo não muda e-mails que já o usam.
- API: `GET/POST /api/workspaces/{id}/crm/email-saved-blocks`,
  `PATCH/DELETE …/email-saved-blocks/{blockId}` (permissão `email`).

### Histórico de versões ("Histórico")

- `CrmEmailTemplateVersion` guarda documento + assunto de templates v2 em
  quatro momentos: "Salvar versão" (com nome opcional), envio de teste,
  criação de campanha com o template e restauração. Conteúdo igual ao da
  última versão não grava de novo (hash de documento + assunto), exceto a
  restauração. Ficam as **50** mais recentes por template.
- A gaveta lista as versões (motivo, autor, há quanto tempo), mostra a
  prévia exata do envio e restaura com confirmação: o template é salvo pelo
  `PATCH` normal (mesma validação e regra do bloco de HTML) e vira uma
  versão `RESTORE` — nada se perde.
- API: `GET/POST …/email-templates/{templateId}/versions`,
  `GET …/versions/{versionId}`, `POST …/versions/{versionId}/restore`.

### IA nos blocos

- Inspetor, seção "IA" (título, texto, botão, depoimento, cupom, evento, NPS,
  descrição do produto): "Escrever com IA" a partir de um pedido e
  "Reescrever" — mais curto, mais persuasivo, mais formal. O resultado entra
  como um passo de desfazer.
- Aba "IA" da barra lateral: "Gerar seção" a partir de um pedido e/ou de um
  produto do CRM. O modelo devolve um JSON pequeno (colunas e blocos);
  `buildAiSection` (`ai-blocks.ts`) cria cada bloco com os padrões do
  catálogo, descarta o que o schema recusa e valida a seção inteira — nó
  inválido nunca chega ao editor.
- Mesmo provedor, modelo e cota mensal do assistente do CRM (ADR 0007,
  feature `crm.aiAssistant`). Rotas: `POST …/crm/email-ai/rewrite` e
  `POST …/crm/email-ai/section`.

### Conteúdo condicional ("Mostrar se")

- Seções e blocos ganham `showIf` (Avançado › Mostrar se): dado do contato
  (nome, primeiro nome, e-mail, empresa, cargo, telefone, cidade — é igual,
  é diferente, contém, não contém, está vazio, está preenchido; sem
  diferenciar maiúsculas e acentos) ou lista de e-mail (está / não está).
- No render final o nó condicional fica entre comentários
  `<!--ec-if:<id>:<condição>-->…<!--ec-endif:<id>-->`. A renderização base
  continua única (cache e cópia da campanha); por destinatário,
  `applyEmailConditions` mantém ou corta cada trecho e refaz o texto puro,
  antes das variáveis. Vale no envio de teste, na campanha e na API de
  render; as listas do contato só são consultadas quando o e-mail tem
  condição de lista.
- No canvas o nó condicional mostra o selo "Mostrar se: …". Em "Visualizar",
  o "Ver como" mostra a versão de cada contato (com as listas da pessoa do
  CRM); com "Mostrar variáveis" tudo aparece.

### Só no celular

- Avançado › Celular: mostrar no computador/celular (um dos dois fica
  ligado), margem própria no celular e tamanho da fonte no celular. Grava os
  valores responsivos do catálogo (`{ base, mobile }`), que viram media
  queries no envio, qualquer que seja o tamanho mostrado no canvas.
