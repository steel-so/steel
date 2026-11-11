# Documentos — montagem por IA

Parte do construtor de documentos ([README](README.md), [ADR 0063](../adr/0063-construtor-de-documentos-no-steel-canvas.md)).
O usuário sobe um PDF ou DOCX, ou descreve o documento, e a IA monta um
rascunho com os blocos do catálogo `document`.

## Fluxo

1. **Diálogo** (`app/_components/documents/import/document-import-dialog.tsx`):
   duas abas — "Importar PDF/DOCX" (arrastar e soltar) e "Gerar com IA"
   (pedido + tipo). Mostra a cota mensal e o custo estimado
   (`GET .../documents/imports/context`).
2. **`POST .../documents/imports`** (`DocumentImportService.create`):
   - permissão `documents` × `CREATE` no CRM;
   - arquivo conferido **pelo conteúdo** (`%PDF-` ou ZIP do DOCX), até
     20 MB e 60 páginas → senão `DOCUMENT_IMPORT_UNSUPPORTED` (422);
   - plano (`crm.aiAssistant`), modelo e cota da IA do CRM;
   - arquivo no MinIO, bucket privado `documents`,
     `<workspaceId>/imports/<importId>/<arquivo>`;
   - fila `documents-ai` (um job por importação, 2 tentativas só para falha
     de banco).
3. **Worker** (`DocumentImportService.run`):
   - etapas gravadas em `document_imports.progress` e publicadas no Redis
     (`documents:import:<id>`): lendo o arquivo → entendendo a estrutura →
     montando as seções → pronto;
   - o PDF vai **inteiro** ao modelo quando ele lê PDF (Claude e os modelos
     da OpenAI com visão); senão, o texto de cada página. Se a chamada com o
     PDF falhar, tenta de novo com o texto;
   - o DOCX vai como texto (mesma extração dos anexos do Steel AI), marcado
     como conteúdo de terceiros (ADR 0041);
   - a resposta é um plano estruturado (`DocumentOutline`, saída JSON com
     schema), validado; uma resposta inválida volta ao modelo uma vez;
   - `outlineToDocument` monta o conteúdo com os presets do catálogo, que é
     validado antes de gravar;
   - o documento nasce em `DRAFT`, com o usuário como dono, origem
     `PDF_IMPORT` ou `AI_PROMPT`, layout paginado para arquivos e web para
     pedidos, e o evento `CREATED`;
   - o custo vai para o consumo de IA do CRM e fica na importação.
   - o arquivo enviado é apagado do MinIO depois que o documento existe
     (só serviu de entrada para o modelo; menos dado pessoal guardado).
4. **Acompanhamento**: `GET .../imports/<id>/stream` (SSE) e, como reserva,
   `GET .../imports/<id>` a cada 4 s. Quando fica pronto, o diálogo abre
   `/crm/documents/<id>/edit`.

## Regras do modelo

- Mantém o texto do arquivo fielmente (sem resumir nem reescrever); tira
  cabeçalhos, rodapés e números de página repetidos.
- "Nome: ____", "Data: __/__/____", "CPF:", "CNPJ:", "E-mail:" e
  semelhantes viram **campos**.
- Linhas de assinatura viram **um bloco de aceite** no fim (não há
  assinatura no produto).
- Listas de itens com preço viram **tabela de preços**; outros dados em
  tabela, **tabela**.
- Espaços reservados para dados do cliente viram **variáveis**
  (`{{contato.nome}}`, `{{empresa.cnpj}}`…).
- **Imagens** não são copiadas nesta versão: viram espaços reservados para
  o usuário trocar no editor.

## Falhas (sempre em pt-BR na importação)

| Situação | O que o usuário vê |
|---|---|
| Provedor fora do ar | "A IA não respondeu agora. Tente de novo em instantes." |
| Recusa do modelo | "A IA recusou o conteúdo deste arquivo…" |
| Resposta inválida depois da correção | "A IA não conseguiu montar o documento. Tente de novo." |
| PDF digitalizado com modelo que só lê texto | Aviso de PDF sem texto selecionável |
| Arquivo sumiu do MinIO | "Não foi possível ler o arquivo enviado…" |
| Worker caiu (mais de 30 min sem terminar) | "A montagem demorou demais e foi interrompida…" |

## Limites e custo

- Texto extraído enviado ao modelo: até 300 mil caracteres (o final é
  cortado e o usuário é avisado).
- Saída: até 48 mil tokens (16 mil no GPT-4o mini, 32 mil no GPT-4.1 mini),
  em streaming.
- Estimativa: parte fixa + por página (arquivos) ou um valor por documento
  gerado por pedido, com o preço do modelo e a margem da plataforma
  (ADR 0019).
