# 0049 — Protocolo de atendimento no Zap: um número por ciclo de atendimento

- **Status:** Proposta
- **Data:** 2026-10-22
- **Decisores:** Alexandre (product owner); plano escrito pelo agente da fatia `zap-protocol-plan` (onda zapops). Só documentação: nada aqui está aplicado.

## Contexto

Quem atende pelo Zap (Comunicação) hoje não tem um número para citar. O
cliente liga ou escreve de novo e diz "sobre aquele atendimento de ontem", e o
atendente procura pelo nome. Clínicas, provedores, escolas, cobrança e
suporte pedem um **protocolo**: um código curto, único, que o contato recebe,
guarda e informa depois. A comparação com a oferta GO360/GOCheck/GOTracking do
grupo Ótima Digital mostrou que isso é lacuna.

O que o código faz hoje e que condiciona a decisão (lido em
`src/services/whatsapp-conversation.service.ts`,
`src/services/whatsapp-webhook.service.ts` e `prisma/schema.prisma`):

- **Existe uma conversa por contato, reaproveitada.** Quando o contato escreve
  numa conversa `CLOSED`, o webhook chama `findLatestClosedByContact` e
  `reopenWhatsAppConversation`: é a **mesma linha** `WhatsAppConversation`, com o
  histórico junto, que volta para `NEW`/`IN_PROGRESS`. Só se não houver conversa
  fechada é criada outra. Logo, um protocolo "por conversa" seria, na prática,
  um protocolo por contato e nunca mudaria.
- **O ciclo já existe, só não tem identidade.** `applyClose` grava
  `closedAt`, `closeReason`, `closeOutcome`, `closeStatusIds` e
  `closeStatusLabels` e **os limpa ao reabrir** (`reopenWhatsAppConversation`).
  O resultado de cada atendimento passado só sobrevive como evento
  (`WhatsAppConversationEvent` `CLOSED`/`REOPENED`, com `closeOutcome` e rótulos
  copiados). Não há como dizer "o atendimento N desta conversa terminou em
  insucesso" sem reconstruir pelos eventos.
- **Portas de entrada de um ciclo** (todas passam por `create` ou `reopen`):
  mensagem do contato (webhook Meta e Z-API, dois trechos em
  `whatsapp-webhook.service.ts`), `WhatsAppConversationService.start` (atendente
  inicia), `reopen` manual, campanhas de IA (`whatsapp-ai-campaign.service.ts`,
  que reabre ou cria), WhatsApp dentro do chamado (`sd-whatsapp.service.ts`) e o
  atendente de voz (`voice-agent.service.ts`, cria conversa). **Portas de
  saída:** `close` manual, `closeInactive` (job, janela `autoCloseAfterHours`,
  padrão 24 h), `closeWhatsAppConversationBySystem` (ação de campanha de IA) e,
  desde `f9a59d24`, arquivar/excluir fecha a conversa antes.
- **Disparos em massa não abrem conversa.** Broadcasts e o ledger
  `WhatsAppUsageMonthly` enviam sem criar `WhatsAppMessage`. Só viram ciclo
  quando o contato responde (webhook) ou quando uma campanha de IA cria/reabre a
  conversa.
- **Chamados do ServiceDesk** já têm numeração própria: `SdTicket.number`
  (Int sequencial por workspace, contador `SdSettings.nextTicketNumber`),
  exibido por `src/lib/servicedesk/ticket-code.ts` como `<prefixo>-<6 dígitos>`
  (`INC-000123`), com prefixo configurável por tipo. O chamado se liga à
  conversa por `SdTicket.whatsappConversationId` (`onDelete: SetNull`).
- **SLA em construção (slice `zap-sla`, ADR 0048).** Na data deste texto a
  branch `feat/zap-sla` ainda não tem commits e não há PR; o modelo
  `WhatsAppSlaCycle` descrito pelo brief da onda não pôde ser lido. Este plano
  descreve apenas o **ponto de encaixe** (abaixo) e deve ser reconciliado com a
  ADR 0048 quando ela existir.
- **Superfícies que mostram a conversa:** busca global (`zap-conversation` em
  `src/lib/search/search-entities.ts`, indexada por `indexSearchDocument`),
  exportação de transcrição TXT/CSV (`exportTranscript`), eventos da linha do
  tempo, tela de histórico/relatórios do Zap, ferramentas MCP `zap_*`
  (`docs/mcp/README.md`) e API pública em `app/api/v1/whatsapp`.

## Decisão

Adotar o **protocolo de atendimento: um número por ciclo de atendimento**,
gerado quando a conversa abre (cria ou reabre) e encerrado quando fecha. Ele
vive em uma tabela própria, `WhatsAppProtocol`, e é aditivo e **desligado por
padrão**.

### 1. Granularidade

| Opção | Veredito | Por quê |
| --- | --- | --- |
| **Por ciclo de atendimento** (recomendada) | Adotada | Casa com o que o atendente e o cliente chamam de "atendimento": começa quando o contato fala ou o atendente inicia, termina no fechamento. Cada reabertura é um atendimento novo (o código já diz isso: "A reopened conversation is a new attendance: limited and counted"). Permite resultado, tempo e SLA por atendimento. |
| Por conversa | Descartada | Existe uma conversa por contato, reaproveitada para sempre. O protocolo seria constante por contato, sem valor para referenciar "aquele atendimento". |
| Por chamado (ServiceDesk) | Descartada como base | Só atendimentos que viram chamado teriam número; o resto do Zap (vendas, cobrança, dúvidas) ficaria sem. O chamado **referencia** o protocolo, não o gera. |

Regra de ouro: **no máximo um protocolo aberto por conversa** (`closedAt IS NULL`),
garantido por índice único parcial (ver modelo). Muitos protocolos fechados por
conversa.

### 2. Formato e unicidade

- **Formato:** `[PREFIXO-]AAAAMMDD-NNNNNN`, ex.: `20261022-000137` ou
  `CLI-20261022-000137`. O prefixo é opcional, configurável por workspace
  (`protocolPrefix`, mesma regra de `ticket-code.ts`: 1–10 alfanuméricos
  começando por letra, sempre maiúsculas; vazio = sem prefixo). Isso deixa cada
  segmento "marcar" o número (CLI, FIN, MAT) sem mudar o motor.
- **Por que data + sequência:** é legível por telefone ("vinte e seis, dez, vinte
  e dois, cento e trinta e sete"), ordena por data e dá ao atendente uma pista
  de quando foi. O formato do ServiceDesk (`INC-000123`) é só contador; aqui a
  data entra porque o protocolo é ditado ao telefone e citado dias depois. Para
  manter consistência: mesma largura de 6 dígitos para a sequência e mesma
  validação de prefixo, em um helper compartilhado `src/lib/whatsapp/protocol-code.ts`
  espelhando `ticket-code.ts`.
- **Fuso:** a data é a do dia em `America/Sao_Paulo`
  (`WHATSAPP_BUSINESS_HOURS_TIME_ZONE` em `src/lib/whatsapp/business-hours.ts`),
  calculada na abertura do ciclo. Nunca no fuso do navegador nem do runner (CI
  roda em UTC).
- **Sequência:** contador **por workspace e por dia** (reinicia a cada dia), em
  `WhatsAppProtocolCounter` (chave `workspaceId + day`). A alocação é um único
  `INSERT ... ON CONFLICT (workspace_id, day) DO UPDATE SET last = last + 1
  RETURNING last`, executado **na mesma transação** que cria o
  `WhatsAppProtocol`. Isso é race-safe (a linha do contador é travada pelo
  upsert) e, como o incremento volta junto com a transação, **não deixa buraco
  por erro**. Os buracos que sobram são os que ninguém consegue evitar
  (protocolo apagado por exclusão do workspace). Decisão: **monotônico e
  único; sem promessa de ausência de buracos**. Auditoria que exija sequência
  sem lacunas fica fora do escopo.
- **Unicidade:** `@@unique([workspaceId, code])`. Se um dia a sequência diária
  passar de 999 999, o número simplesmente cresce em dígitos (o formato não
  trunca).
- **Por que não derivar do `cuid` nem de hash:** não é ditável, e o contato não
  deve poder adivinhar protocolos alheios. O número é **identificador de
  referência, não segredo** (ver LGPD): nenhuma tela pública pode devolver dados
  a quem só sabe o código.

### 3. Modelo de dados

Tabela própria em vez de campos soltos na conversa, porque o ciclo tem
resultado e vários por conversa, e `closeOutcome`/`closeStatus*` são limpos na
reabertura.

```prisma
// Proposta — NÃO aplicada. Migração: zapops_protocol_tables.

/// Um ciclo de atendimento: abre quando a conversa começa ou reabre e fecha
/// quando ela fecha. O `code` é o que o contato recebe e cita.
model WhatsAppProtocol {
  id             String                @id @default(cuid())
  workspaceId    String                @map("workspace_id")
  conversationId String                @map("conversation_id")
  /// Código de exibição, único por workspace (ex.: "CLI-20261022-000137").
  code           String
  /// Data do dia do ciclo em America/Sao_Paulo e sequência do dia.
  day            String                // "AAAAMMDD"
  sequence       Int
  openedAt       DateTime              @default(now()) @map("opened_at")
  /// Quem abriu: contato escreveu, atendente iniciou/reabriu, campanha de IA,
  /// chamado, atendente de voz.
  openedBy       WhatsAppProtocolOrigin @map("opened_by")
  closedAt       DateTime?             @map("closed_at")
  /// Cópia do fechamento (a conversa limpa esses campos ao reabrir).
  closeOutcome       WhatsAppCloseOutcome? @map("close_outcome")
  closeStatusLabels  String[]              @default([]) @map("close_status_labels")
  closeReason        String?               @map("close_reason")
  /// Quem fechou: atendente, inatividade ou sistema (mesmo enum dos eventos).
  closedSource       WhatsAppConversationEventSource? @map("closed_source")
  /// Preenchido só se o recurso do ADR 0048 estiver ligado (ver "SLA").
  slaCycleId     String?               @unique @map("sla_cycle_id")
  /// Marca o ciclo criado pelo backfill (sem abertura real conhecida).
  backfilled     Boolean               @default(false)
  createdAt      DateTime              @default(now()) @map("created_at")

  workspace    Workspace            @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversation WhatsAppConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, code])
  @@index([conversationId, openedAt])
  @@index([workspaceId, openedAt])
  @@index([workspaceId, closeOutcome])
  @@map("whatsapp_protocols")
  // Índice parcial criado em SQL na migração (Prisma não declara):
  //   CREATE UNIQUE INDEX whatsapp_protocols_one_open
  //     ON whatsapp_protocols (conversation_id) WHERE closed_at IS NULL;
}

enum WhatsAppProtocolOrigin {
  CONTACT
  AGENT
  AI_CAMPAIGN
  SERVICEDESK
  VOICE_AGENT
  BACKFILL
}

/// Contador diário por workspace. Uma linha por (workspace, dia).
model WhatsAppProtocolCounter {
  workspaceId String   @map("workspace_id")
  day         String   // "AAAAMMDD" em America/Sao_Paulo
  last        Int      @default(0)
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@id([workspaceId, day])
  @@map("whatsapp_protocol_counters")
}
```

Acréscimos aditivos às tabelas existentes (nenhum obrigatório):

```prisma
// WhatsAppConversation — atalho para a listagem e a busca
currentProtocolId String? @map("current_protocol_id") // protocolo aberto, nulo se fechada
lastProtocolCode  String? @map("last_protocol_code")  // cópia do código mais recente
@@index([workspaceId, lastProtocolCode])

// WhatsAppSettings — tudo desligado por padrão
protocolEnabled            Boolean @default(false) @map("protocol_enabled")
protocolPrefix             String? @map("protocol_prefix")
protocolSendOnOpen         Boolean @default(false) @map("protocol_send_on_open")
protocolSendOnClose        Boolean @default(false) @map("protocol_send_on_close")
protocolOpenMessage        String? @map("protocol_open_message")   // com {{protocolo}}
protocolCloseMessage       String? @map("protocol_close_message")
protocolSendDuringHoursOnly Boolean @default(true) @map("protocol_send_during_hours_only")
protocolReuseWithinMinutes Int     @default(0) @map("protocol_reuse_within_minutes") // 0 = sempre novo
```

`lastProtocolCode` existe para a lista e a busca não fazerem join; é cópia, a
fonte da verdade é `WhatsAppProtocol`.

Formas Zod (proposta), em `src/schemas/whatsapp-protocol.schema.ts`:

```ts
export const protocolPrefixSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9]{0,9}$/)
  .transform((v) => v.toUpperCase())
  .nullable()

export const whatsappProtocolSettingsSchema = z.object({
  protocolEnabled: z.boolean(),
  protocolPrefix: protocolPrefixSchema,
  protocolSendOnOpen: z.boolean(),
  protocolSendOnClose: z.boolean(),
  protocolOpenMessage: z.string().trim().max(500).nullable(),
  protocolCloseMessage: z.string().trim().max(500).nullable(),
  protocolSendDuringHoursOnly: z.boolean(),
  protocolReuseWithinMinutes: z.number().int().min(0).max(1440),
})

export const whatsappProtocolDTOSchema = z.object({
  id: z.string(),
  code: z.string(),
  conversationId: z.string(),
  openedAt: z.string().datetime(),
  openedBy: z.enum(['CONTACT','AGENT','AI_CAMPAIGN','SERVICEDESK','VOICE_AGENT','BACKFILL']),
  closedAt: z.string().datetime().nullable(),
  closeOutcome: z.enum(['SUCCESS','FAILURE']).nullable(),
  closeStatusLabels: z.array(z.string()),
  closedSource: z.string().nullable(),
})

export const listWhatsappProtocolsQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),        // código exato ou parcial
  conversationId: z.string().optional(),
  open: z.coerce.boolean().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
```

Códigos de erro novos (acrescentar ao final de `src/errors/codes.ts`):
`WHATSAPP_PROTOCOL_NOT_FOUND` (404), `WHATSAPP_PROTOCOL_DISABLED` (409,
funcionalidade desligada no workspace).

**Relação com o SLA (ADR 0048).** O ponto de encaixe é o **mesmo gancho**:
os dois nascem em `create`/`reopen` e terminam em `applyClose`. Duas regras
para evitar duplicar o conceito de ciclo:

1. Se `WhatsAppSlaCycle` já for criado nessa abertura, o protocolo **referencia**
   o ciclo (`slaCycleId`), não o contrário, e a abertura/fechamento passa por
   **um** helper (`openAttendanceCycle`/`closeAttendanceCycle`) chamado nos mesmos
   pontos, para que os dois nunca discordem sobre "o que é um atendimento".
2. O protocolo **não depende** do SLA: com o SLA desligado o protocolo funciona
   sozinho (`slaCycleId` nulo), e vice-versa. Quem implementar segundo
   (provavelmente este) reaproveita o helper do primeiro; se os dois PRs
   mexerem no mesmo trecho de `reopenWhatsAppConversation`, a ordem é: SLA
   primeiro, protocolo encaixa depois.

**Resultado do fechamento.** `applyClose` passa a copiar
`closeOutcome`/`closeStatusLabels`/`closeReason`/`source` para o protocolo
aberto na mesma escrita. Os relatórios de resultado por atendimento (hoje
reconstruídos por eventos) passam a ler `WhatsAppProtocol`.

**Backfill.** Para conversas existentes: uma linha por conversa com
`backfilled = true`, `openedBy = BACKFILL`, `openedAt = createdAt` da conversa e
`closedAt/closeOutcome/...` copiados dela se estiver `CLOSED` (se não estiver,
fica aberto). O histórico anterior de reaberturas **não** é reconstituído em
vários protocolos (os eventos `REOPENED` poderiam, mas o ganho não paga o risco);
quem quiser pode rodar uma segunda passada opcional por eventos. O código do
backfill usa a data do `openedAt`, com a sequência do dia alocada em ordem de
`openedAt`. Script idempotente `pnpm seed:zap-protocols` (padrão dos
`seed:*` atuais), em lotes, fora da migração SQL, e **só roda para workspaces
com `protocolEnabled = true`** na hora em que o administrador liga o recurso
(job `whatsapp-protocol-backfill` na fila existente do Zap), nunca para todos.

### 4. Onde aparece

- **Cabeçalho da conversa:** chip com o código e botão de copiar; ao lado, o
  histórico de protocolos da conversa em um popover (código, abertura,
  fechamento, resultado).
- **Lista de conversas e busca:** a busca (`indexSearchDocument` de
  `zap-conversation`) passa a indexar `lastProtocolCode`; o filtro da lista aceita
  o código exato ou parcial. Busca por protocolo **antigo** de uma conversa
  reaberta usa `WhatsAppProtocol` (`GET .../protocols?q=`) e abre a conversa.
- **Relatórios e dashboards:** `zap/reports` ganha a coluna Protocolo; um
  widget "atendimentos por resultado" lê `WhatsAppProtocol.closeOutcome` (fim da
  reconstrução por eventos).
- **Exportação:** a transcrição (`exportTranscript`) ganha o cabeçalho
  "Protocolo: X" e, no CSV, a coluna. Como a exportação já é auditada, nada
  muda no `auditMutation`.
- **ServiceDesk:** o chamado criado a partir da conversa guarda o protocolo
  aberto no momento (campo `SdTicket.whatsappProtocolId`, opcional, fase 4) e o
  mostra ao lado do código do chamado (`INC-000123 · protocolo 20261022-000137`).
  Os formatos ficam distintos de propósito (o do chamado não tem data), mas
  usam a mesma largura de sequência e a mesma regra de prefixo.
- **Evento na linha do tempo:** reutilizar `REOPENED`/`CLOSED`, sem eventos novos. Criar `PROTOCOL_OPENED`/`PROTOCOL_CLOSED` só se a equipe quiser ver o código na linha do tempo (decisão adiada).
- **MCP e API pública:** `zap_conversation_get` e `zap_conversations_list`
  devolvem `protocol` (aberto) e `protocols` (últimos N); nova ferramenta de
  leitura `zap_protocol_get` (por código). Rotas:
  `GET /api/workspaces/[id]/whatsapp/protocols` (lista/busca),
  `GET .../protocols/[code]`, e o campo `protocol` nos DTOs de conversa; todas
  documentadas em `src/openapi/paths/whatsapp/**`. A API pública `v1` ganha
  `protocol` somente leitura. **Nenhuma rota cria ou edita protocolo
  manualmente**: o número só nasce do ciclo.

### 5. Envio ao contato

Por padrão **nada é enviado** (a regra da onda: configuração nova nunca muda um
workspace existente). Com `protocolEnabled` e `protocolSendOnOpen` ligados,
ao abrir o ciclo o contato recebe "Seu protocolo é *X*" (texto do administrador,
com `{{protocolo}}`); com `protocolSendOnClose`, recebe no fechamento "Atendimento
*X* encerrado".

- **Horário comercial:** respeita `protocolSendDuringHoursOnly` usando
  `src/lib/whatsapp/business-hours.ts`. Fora do horário a mensagem de abertura
  **não** é enfileirada para depois (evita mensagem velha); a de fechamento
  também não. O protocolo existe de qualquer jeito e o atendente pode copiá-lo.
- **Janela de 24 h e templates (Meta):** a mensagem de abertura é uma resposta à
  mensagem do contato, portanto está dentro da janela e vai como texto livre.
  Quando o ciclo é aberto pelo atendente ou por campanha (contato fora da janela),
  a Meta exige template aprovado: nesse caso o envio só ocorre se o workspace
  tiver um template de protocolo vinculado; sem ele, **não envia** e registra um
  log (nunca falha o ciclo). Fechamento por inatividade tipicamente ocorre fora
  da janela (24 h de silêncio): por isso `protocolSendOnClose` só envia texto livre
  se a janela ainda estiver aberta, ou template se houver; senão, não envia.
- **Z-API:** não há janela nem template; o texto livre vai respeitando horário e
  o limite de taxa existente. Custos entram no ledger `WhatsAppUsageMonthly`
  como mensagens normais (sinalizar na tela de custos da slice `zap-costs`).
- **Quem não recebe:** grupos (não têm ciclo), ciclos abertos por campanha de IA
  quando a campanha já envia mensagem própria (o texto da campanha pode usar
  `{{protocolo}}`; evitar duas mensagens), e ciclos criados pelo backfill.
- **Envio assíncrono:** vai para a fila de mensagens existente, nunca no caminho
  síncrono do webhook (uma falha de envio não pode impedir o recebimento).

### 6. Casos de borda

- **Reabertura dentro de X minutos mantém o protocolo?** Configurável por
  `protocolReuseWithinMinutes` (padrão **0 = cada reabertura é um novo
  protocolo**). Com X > 0, se o contato escreve até X minutos depois do
  fechamento, o protocolo fechado é reaberto (`closedAt = null`, resultado
  limpo) em vez de gerar outro. Serve para o "ah, esqueci de dizer" logo após
  o fechamento por inatividade. A reabertura reaproveitada também reaproveita o
  ciclo de SLA, nesse caso, para os dois não divergirem (ver ADR 0048).
- **Conversas mescladas:** o Zap não mescla conversas hoje. Se vier a mesclar, os
  protocolos da conversa absorvida são **movidos** (`conversationId`
  atualizado) e continuam consultáveis; nenhum código é reescrito.
- **Arquivada/excluída:** arquivar ou excluir fecha a conversa (`f9a59d24`), logo
  fecha o protocolo aberto (origem `AGENT`). A exclusão lógica (`deletedAt`)
  mantém os protocolos (são histórico); a exclusão física leva os protocolos
  por `onDelete: Cascade`. Um protocolo de uma conversa excluída continua
  buscável para administradores, mas abre "conversa indisponível".
  O **limpar** (`clearedAt`) não altera protocolos.
- **Campanhas de IA e atendente de voz:** abrem ciclo como qualquer outro
  (`openedBy = AI_CAMPAIGN` / `VOICE_AGENT`), mesmo quando a conversa é criada
  sem mensagem do contato. O reenvio de uma campanha para uma conversa já
  aberta **não** cria novo protocolo.
- **Broadcasts:** não abrem ciclo. Se o contato responde, o ciclo abre pela via
  normal (webhook). Isso mantém o protocolo ligado a atendimento de verdade, não
  a disparo.
- **Grupos:** `WhatsAppGroup`/`WhatsAppGroupMessage` não têm conversa nem ciclo:
  sem protocolo.
- **Concorrência:** duas mensagens quase simultâneas do mesmo contato podem
  tentar abrir dois ciclos. O índice único parcial garante um aberto por
  conversa; a segunda tentativa captura a violação e lê o protocolo existente
  (`get-or-open`), o contador só avança junto com a transação que vence.
- **Workspace com módulo em Postgres externo** (`WorkspaceModuleConnection`):
  as tabelas novas vivem junto das de WhatsApp, onde a conexão do módulo já
  resolve; a migração precisa rodar também nos bancos externos (checar o
  mecanismo atual de `module-db` antes da fase 1).
- **Protocolo desligado depois de ligado:** para de gerar e de enviar; os já
  gerados continuam visíveis e buscáveis.

### LGPD

O protocolo **não é dado pessoal sensível** e não identifica o titular por si:
é um número de referência. Mas é mostrado ao contato e, ao lado da conversa,
associa-se a dados pessoais. Regras: (a) o código não revela nome, telefone ou
conteúdo; (b) nenhuma rota sem sessão devolve dados a partir do protocolo (não
há "consulta pública de protocolo"); (c) a busca e a API respeitam o escopo da
conversa (`whatsapp-conversation-scope.service.ts`): quem não vê a conversa não
vê o protocolo, e a busca por código de conversa fora do escopo responde "não
encontrado"; (d) a exportação de dados do titular (`data-export`) inclui seus
protocolos; (e) a retenção segue a da conversa (nada é guardado além dela); (f) o
log nunca imprime telefone junto do código.

## Plano de implementação

Estimativas para uma pessoa, já com testes (meta de 95 % do repositório).

| Fase | Entrega | Estimativa |
| --- | --- | --- |
| 0. Reconciliar | Ler a ADR 0048 mergeada; decidir o helper comum de ciclo (`openAttendanceCycle`/`closeAttendanceCycle`). | 0,5 dia |
| 1. Fundação | Migração (`zapops_protocol_tables`), contador, `protocol-code.ts`, repositório, mapper, `WhatsAppProtocolService.openOrGet/close`, ganchos em `create`/`reopen`/`applyClose` **atrás de `protocolEnabled`**, cópia do resultado. Sem UI. | 3 dias |
| 2. Superfície | Chip no cabeçalho, histórico, busca/filtro, rota de lista, campo nos DTOs, exportação, OpenAPI, MCP (`zap_protocol_get`), manual em `content/docs`. | 3 dias |
| 3. Configuração e envio | Seção em `zap/configuracoes` (componente separado), mensagens de abertura/fechamento, horário, janela/template, fila de envio. | 3 dias |
| 4. Integrações | Vínculo com chamado do ServiceDesk, relatórios/dashboards, evento de linha do tempo opcional. | 2 dias |
| 5. Backfill e rollout | Script/job do backfill por workspace, ligar em homologação, depois piloto em 1 cliente, depois disponível. | 1,5 dia + piloto |

**Primeira PR recomendada (fase 1, sem UI e sem envio):** só as tabelas, o
gerador e os ganchos desligados. É a menor fatia que prova as duas partes
difíceis (alocação race-safe e "um aberto por conversa") sem nenhum efeito visível
para workspaces existentes.

**Estratégia de testes.**

- *Unit:* formatação e validação do prefixo (`protocol-code`), fuso (virada do
  dia às 00:00 de São Paulo, e 21:00 UTC), regras do serviço (autorização,
  desligado, reuso dentro de X minutos, cópia do resultado, mensagens não
  enviadas fora do horário/janela).
- *Integração (Postgres real):* **concorrência** — N aberturas simultâneas na
  mesma conversa geram exatamente um aberto; N aberturas em conversas
  diferentes do mesmo workspace geram sequências distintas sem repetição; o
  contador reinicia no dia seguinte; o índice parcial rejeita o segundo aberto.
- *Rota (e2e, só na CI):* busca por código, escopo (atendente de outra equipe não
  vê), módulo desligado, workspace cruzado.
- Cobrir os três pontos de abertura (webhook, `start`, campanha de IA) e os
  quatro de fechamento (manual, inatividade, sistema, arquivar).

**Riscos.**

1. **Divergência com o SLA** sobre o que é um ciclo — mitigada pelo helper comum
   e pela ordem de entrega (SLA primeiro).
2. **Contenção no contador** em workspaces de alto volume: uma linha por
   (workspace, dia) é atualizada a cada abertura; é um upsert curto na mesma
   transação, bem abaixo de dezenas de aberturas por segundo. Se virar gargalo,
   alocar em blocos em memória (aceitando buracos, já previstos).
3. **Webhook mais lento:** o gancho entra no caminho de entrada; mantê-lo em uma
   transação curta e mover o envio para a fila.
4. **Mensagem indevida ao contato** (fora da janela/Meta): o padrão é não enviar
   sem template e registrar; testar com a conexão Meta de homologação.
5. **Migração em bancos externos de módulo:** confirmar antes da fase 1.
6. **Backfill pesado:** em lotes, por workspace, com `flock`/fila, nunca na
   migração.

**Fora do escopo.** Protocolo para grupos; consulta pública de protocolo;
sequência sem lacunas auditável; protocolo para ligações do PABX fora de uma
conversa; reconstrução de ciclos antigos pelos eventos.

## Consequências

- **Mais fácil:** o cliente cita um número e o atendente acha o atendimento;
  relatórios por atendimento (resultado, tempo) deixam de depender de
  reconstrução por eventos; chamado e conversa se ligam por um identificador
  comum; o SLA ganha um alvo claro (o ciclo).
- **Mais difícil / custo aceito:** uma tabela e um contador novos no caminho de
  entrada do webhook; mais um conceito ("ciclo") que precisa ficar alinhado com
  o do SLA; o backfill não reconstitui reaberturas antigas, então protocolos
  de conversas existentes começam "no presente"; a sequência pode ter buracos.
- **Revisitar:** se o SLA (ADR 0048) fundir ciclo e protocolo em uma tabela
  única, esta ADR é substituída por uma nova (nunca reescrita); depois do
  piloto, reavaliar o padrão de `protocolReuseWithinMinutes` e se a sequência
  diária de 6 dígitos serve para todos os portes de cliente.
