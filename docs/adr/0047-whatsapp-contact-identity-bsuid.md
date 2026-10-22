# ADR 0047 — Identidade do contato WhatsApp: telefone ou BSUID

- **Status:** aceito
- **Data:** 2026-10-22

## Contexto

Desde abril de 2026 a Meta envia o **BSUID** (ID do usuário no escopo do negócio, `BR.123…`) em todo webhook de mensagem (`contacts[].user_id`, `messages[].from_user_id`). Para quem adotou um **username** o telefone (`from`, `wa_id`) pode vir ausente. Até então o Steel descartava a mensagem sem `from` e endereçava todo envio em `to: <telefone>`.

O `waId` é usado como telefone em cerca de 300 pontos (busca, exportação, ferramentas da IA, ligação pelo PABX, transmissões, ServiceDesk).

## Decisão

- `whatsapp_contacts.waId` continua sendo a **chave de identidade** do contato: o telefone (só dígitos) ou, enquanto a Meta não informa o telefone, o BSUID. Nova coluna `bsuid` (única por workspace) e `username`.
- A busca do contato é por BSUID e depois por telefone; quando o telefone aparece, o mesmo contato o adota como `waId` (se nenhum outro contato já o tem). Mensagens de sistema `user_changed_number` / `user_changed_user_id` movem o contato para o novo BSUID.
- Envio pela Cloud API: telefone vai em `to`, BSUID vai em `recipient` (`metaRecipient()`), nunca os dois.
- `isWhatsAppPhone(waId)` (`src/lib/whatsapp/phone.ts`) separa as duas formas. O DTO expõe `username` e `hasPhone`; a interface mostra o nome, `@username` ou "Sem telefone".
- Ações que exigem telefone ficam bloqueadas para contato só com BSUID: ligação pelo PABX (erro claro) e envios em massa (transmissões e campanhas de IA marcam o destinatário como `SKIPPED` com "Contato sem telefone"). A Marketing Messages API para BSUID não está integrada.
- O erro `131062` da Meta (tipo de mensagem sem suporte a BSUID) vira mensagem em português.

## Consequências

- Nenhuma mudança de contrato para integrações que só tratam telefone; `waId` pode, porém, trazer um BSUID para quem usa username (documentado no OpenAPI).
- Um contato que já existia só por telefone e passa a escrever só com BSUID vira um segundo contato, até a Meta enviar telefone e BSUID juntos.
- Z-API não é afetada (só telefone).
- Reavaliar quando a Meta publicar as Fases 2 e 3 do novo modelo de contas e abrir os usernames a todos os usuários.
