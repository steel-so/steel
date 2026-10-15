# CRM · Editor visual de e-mail (templates prontos)

Editor de e-mail do CRM no estilo do Storybook / react.email: o e-mail
renderizado fica em cima, e uma **barra inferior** edita o **conteúdo** do
bloco selecionado. A estrutura do template é travada — o usuário troca
texto, imagem, botão, link, lista de produtos, mostra/oculta seções
opcionais e reordena as seções móveis, mas não monta layout livre.

## Decisão: editor próprio sobre componentes do React Email

Avaliamos montar em cima do `@react-email/editor` (1.7.10, MIT), que já está
instalado e é usado no editor livre das campanhas. Ele é um editor de
documento livre (TipTap/ProseMirror): o usuário digita, abre `/` e insere
qualquer bloco; não há nó travado, nem "só conteúdo", nem painel de
propriedades por bloco além do inspector lateral. Travar a estrutura
exigiria reescrever o schema do ProseMirror e o serializador — e o JSON do
TipTap não é um bom contrato para "template X, versão Y, estes campos".

Por isso o builder é **nosso**, sobre os componentes do React Email
(`react-email`: `Html`, `Section`, `Row`, `Column`, `Heading`, `Text`,
`Button`, `Img`, `Hr`, `Link`, `Preview`) e renderizado com
`@react-email/render` — o mesmo código roda no navegador (preview ao vivo)
e no servidor (envio). O TipTap (mesma base do `@react-email/editor`) só é
usado no campo de **texto rico** dos parágrafos, com marcas limitadas
(negrito, itálico, sublinhado, link, listas). O `@react-email/editor`
continua servindo o editor livre (templates `LEGACY`).

## Contrato do domínio

- **Template** (`CrmEmailTemplate`), por workspace, com `kind`:
  - `LEGACY` — HTML livre (editor de blocos `@react-email/editor`) ou um dos
    dois layouts antigos (`templateId`/`templateProps`). Continua funcionando
    como antes.
  - `BUILDER` — documento estruturado em `builderDocument` (JSON abaixo).
    `contentHtml`/`contentText` guardam a última renderização (com as
    variáveis ainda como `{{nome}}`) para listagens e fluxos antigos.
- **Documento** (`builderDocument`, versão 1):
  `{ version: 1, layout, previewText, sections: [{ id, type, hidden, props }] }`.
  `layout` é um dos modelos da galeria; `sections` precisa bater com a
  estrutura do modelo: mesmos ids e tipos, cabeçalho primeiro e rodapé
  por último, `hidden` só nas seções opcionais e reordenação só entre as
  móveis. Fora disso → `CRM_EMAIL_BUILDER_STRUCTURE_LOCKED` (422).
- **Marca do workspace** (`CrmEmailBrand`, uma por workspace): nome, logo,
  cor primária, endereço e site. Sem linha gravada, vale o nome e o logo do
  workspace com a cor padrão do Steel.
- **Variáveis**: `{{nome}}`, `{{primeiro_nome}}`, `{{email}}`, `{{empresa}}`,
  `{{cargo}}`, `{{telefone}}`, `{{cidade}}` e `{{campaign_link}}` (link da
  campanha, com UTMs, resolvido pela fatia de campanhas). Aceitam valor
  padrão: `{{primeiro_nome|cliente}}`. Variável desconhecida fica vazia.
- **Descadastro (LGPD)**: todo e-mail do builder tem o rodapé com o link de
  descadastro (`{{unsubscribe_url}}`), que não pode ser ocultado. No envio,
  o link vira a URL assinada do destinatário (`CrmEmailOptOut`).
- **Imagens**: JPEG, PNG ou WebP até 5 MB, no bucket público
  `crm-email-images` (chave `<workspaceId>/<uuid>.<ext>`).
- **Permissões**: tudo sob o recurso `email` do CRM — ver (`VIEW`), criar
  (`CREATE`), editar/enviar teste/alterar marca (`EDIT`), excluir
  (`DELETE`); módulo CRM ligado.
- **Paginação**: a galeria é fixa (8 modelos); a lista de templates segue a
  tabela atual.

## Modelos da galeria

| id | Nome | Seções |
| --- | --- | --- |
| `newsletter` | Newsletter | cabeçalho, destaque, texto, destaques, imagem*, botão, rodapé |
| `promocao` | Promoção / oferta | cabeçalho, destaque, cupom*, produtos, botão, rodapé |
| `convite-evento` | Convite para evento | cabeçalho, destaque, evento, texto*, rodapé |
| `boas-vindas` | Boas-vindas | cabeçalho, destaque, próximos passos, botão, assinatura*, rodapé |
| `follow-up-proposta` | Follow-up de proposta | cabeçalho, texto, botão, assinatura, rodapé |
| `pesquisa-nps` | Pesquisa NPS | cabeçalho, texto, NPS, rodapé |
| `anuncio-produto` | Anúncio de produto | cabeçalho, destaque, texto, recursos, depoimento*, botão, rodapé |
| `lembrete` | Lembrete | cabeçalho, texto, evento, botão*, rodapé |

`*` = seção opcional (pode ser ocultada). O botão principal de cada modelo
aponta para `{{campaign_link}}` por padrão.

Os modelos são código nosso, escritos com os componentes do React Email e
com a escala tipográfica e as cores do template oficial **Barebone** do
react-email (`github.com/resend/react-email`, licença MIT, © Plus Five Five,
Inc). Nenhum template da comunidade (marcas de terceiros) foi copiado.

## API

| Método | Rota | O quê |
| --- | --- | --- |
| `POST` | `/api/workspaces/{id}/crm/email-templates` | `builderLayout` cria um template `BUILDER` com o conteúdo padrão do modelo |
| `GET` | `/api/workspaces/{id}/crm/email-templates/{templateId}` | um template |
| `PATCH` | `/api/workspaces/{id}/crm/email-templates/{templateId}` | `builderDocument` salva o documento (autosave do editor) |
| `POST` | `/api/workspaces/{id}/crm/email-templates/{templateId}/render` | renderiza com um contato (pessoa do CRM ou exemplo) → `{ subject, html, text }` |
| `POST` | `/api/workspaces/{id}/crm/email-templates/{templateId}/test-send` | "Enviar teste" para o e-mail de quem pede |
| `GET`/`PUT` | `/api/workspaces/{id}/crm/email-brand` | marca do workspace |
| `POST` | `/api/workspaces/{id}/crm/email-builder/images` | upload de imagem (corpo binário) |
| `GET` | `/api/workspaces/{id}/crm/email-builder/links` | landing pages e formulários publicados (atalhos do seletor de link) |

### Para a fatia de campanhas

```ts
import { renderCampaignEmail } from '@/src/services/crm-email-builder.service'

const result = await renderCampaignEmail(templateId, contact, {
  workspaceId,          // obrigatório: escopo do tenant
  campaignLink,         // URL rastreada (UTMs) → {{campaign_link}}
  recipientId,          // linha CrmEmailCampaignRecipient → link de descadastro assinado
})
// result: Result<{ subject: string; html: string; text: string }>
```

`contact` = `{ email, name?, company?, jobTitle?, phone?, city? }`. Sem
`recipientId` (nem `unsubscribeUrl`), o link de descadastro aponta para a
página genérica — use só em teste. A renderização base (sem variáveis) fica
em cache por template + versão da marca; cada contato só troca as
variáveis no HTML já renderizado.

Campanhas criadas pela tela atual com um template `BUILDER` gravam
`templateId`, `campaignLink` e o HTML/texto renderizados na criação (cache
por campanha); no envio cada destinatário recebe as variáveis resolvidas.

## Versão 2 (Steel Canvas)

O editor de arrastar e soltar (ADR 0026) grava em `builderDocument` um
documento `{ catalog: "email", version: 2, rootId, nodes }`. O catálogo, o
conversor da versão 1, as regras do servidor e o checklist estão em
[docs/canvas/email-catalog.md](canvas/email-catalog.md). Os modelos desta
página continuam valendo: viram os documentos iniciais e as "Seções prontas"
do editor novo.
