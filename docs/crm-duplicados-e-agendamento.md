# Duplicados, mesclagem e agendamento de reuniões (CRM)

Duas entregas da fatia `crm-ops` (C7 e C5) e as lacunas fechadas depois delas. Manual do usuário em `content/docs/crm/duplicados-e-mesclagem.mdx` e `content/docs/crm/agendamento-de-reunioes.mdx`.

## C7 — duplicados e mesclagem

### Modelo

| Tabela | Papel |
| --- | --- |
| `crm_duplicate_candidates` | Um par por `entity` (`PERSON`/`COMPANY`) + `left_id` < `right_id` (único). `score`, `reasons`, `status` (`PENDING`/`MERGED`/`DISMISSED`), `notified_at` |
| `crm_merge_logs` | Uma mesclagem: sobrevivente, arquivado, quem fez, `snapshot` JSON (o que foi movido e os campos antes/depois) e `undo_until` (24 h) |

### Fluxo

- **Varredura diária**: fila `crm-duplicates`, job `run-scan` às 02:40 (`CrmDuplicatesCron`), processador `src/lib/queue/processors/crm-duplicates.ts` → `CrmDuplicateService.runScheduled()`. Percorre os workspaces com o módulo CRM ligado e `status = ACTIVE`; um workspace com falha não interrompe os outros (conta em `failed`).
- **Detecção** em `src/lib/crm-duplicates/detect.ts`: bloqueio por e-mail, telefone, nome e (empresas) CNPJ e domínio; nota mínima 60. Similaridade de nome ≥ 0,9, ou ≥ 0,82 para pessoas da mesma empresa. A varredura lê até 30.000 registros por workspace.
- **Na chegada** (`flagOnArrival`): formulário, fluxo do WhatsApp e cadastro manual chamam o serviço sem esperar (`void`); a vizinhança do registro (mesmo e-mail/telefone ou mesma primeira palavra do nome) é comparada e os pares novos entram na fila. Falha nunca bloqueia a gravação.
- **Notificação**: no máximo uma por dia, por entidade, para o dono e administradores (`CRM_DUPLICATES_FOUND`, `dedupeKey` com a data).
- **Mesclar** exige o recurso `people`/`companies` com a ação `DELETE` (dono e administradores). Descartar e procurar exigem `EDIT`. Ver a fila exige `VIEW`.

### Mesclagem e desfazer

`executeMerge` roda numa transação (timeout de 60 s): arquiva o perdedor (`deleted_at`; numa empresa, também zera `cnpj`/`domain` para liberar a unicidade), grava no sobrevivente só o que mudou (plano em `src/lib/crm-duplicates/merge-plan.ts`: o sobrevivente mantém o que tem, preenche o que está vazio e une e-mails e telefones), re-aponta as linhas filhas listadas em `PERSON_MOVES`/`COMPANY_MOVES` e os valores de campos customizados, descarta os outros pares do perdedor e registra a atividade `MERGED`.

`undoMerge` (janela de 24 h, uma única vez): devolve as colunas do sobrevivente **só se ninguém as editou depois** (compara o valor atual com `survivorAfter`), restaura o perdedor (e o CNPJ/domínio), devolve cada linha filha **só se ainda apontar para o sobrevivente**, reabre o par como `PENDING` e registra `MERGE_UNDONE`. Se o sobrevivente foi excluído, recusa (`CRM_DUPLICATE_INVALID`).

Códigos de erro: `CRM_DUPLICATE_NOT_FOUND`, `CRM_DUPLICATE_INVALID`, `CRM_MERGE_NOT_FOUND`, `CRM_MERGE_UNDO_EXPIRED`.

## C5 — agendamento de reuniões

### Modelo

| Tabela | Papel |
| --- | --- |
| `crm_meeting_pages` | A página pública: `slug` único na plataforma, duração, folga, antecedência, passo, janela em dias, fuso, formato, local, lembrete, origem do lead, `active`, exclusão lógica |
| `crm_meeting_hosts` | Vendedores da página, em ordem (`position`) e `last_assigned_at` (rodízio) |
| `crm_meeting_availabilities` | Por vendedor e workspace: fuso, horário semanal, endereço iCal **criptografado** (`CONNECTION_SECRETS`) e o resultado da última leitura |
| `crm_meeting_bookings` | A reserva: horário, convidado, `status`, `manage_token` (único, entregue só ao convidado), `calendar_event_id`, `lead_id`, marcas de envio de confirmação e lembrete |

### Motor de horários

`src/services/crm-meeting-slots.ts` junta, por vendedor, o horário semanal (padrão: segunda a sexta, 9h–18h, Brasília), as reservas confirmadas, a agenda do CRM e o iCal (`src/lib/crm-meetings/ics.ts`, cache de 5 minutos no Redis, falha de leitura nunca derruba a página). `computeFreeSlots` (`src/lib/crm-meetings/slots.ts`) respeita duração, folga, passo, antecedência e a janela máxima, calculando em fuso IANA (inclusive horário de verão).

### Rodízio e corrida

`CrmMeetingRepository.book` recebe os vendedores livres já ordenados (o ocioso há mais tempo primeiro) e, dentro de uma transação, trava cada candidato com `pg_advisory_xact_lock(hashtext(userId))`, **confere de novo** reservas e agenda (com a folga) e só então grava reserva + evento de agenda + `last_assigned_at`. Dois convidados no mesmo horário: um ganha, o outro recebe `CRM_MEETING_SLOT_TAKEN` (409). Coberto por teste de integração com seis reservas simultâneas.

### Rotas

- Públicas (sem sessão, limitadas por IP; liberadas em `PUBLIC_ROUTES` do `proxy.ts`): `GET /api/crm/meetings/{slug}`, `GET …/slots`, `POST …/book` (exige `consent: true`), `GET|DELETE /api/crm/meeting-bookings/{token}`; páginas `/m/{slug}`, `/m/{slug}/embed` e `/m/b/{token}`.
- Autenticadas: `/api/workspaces/{id}/crm/meeting-pages[/{pageId}]`, `meeting-availability`, `meeting-bookings[/{bookingId}]`. Recurso de permissão `leads`.
- O `iframe` do `/embed` é a única rota com `frame-ancestors *` (CSP no `proxy.ts` e `next.config.ts`).

### Lembretes

Fila `crm-meetings`, job `run-reminders` a cada 5 minutos (`CrmMeetingsCron`), processador `src/lib/queue/processors/crm-meetings.ts` → `CrmMeetingReminderService.tick()`. Cada reserva é **reivindicada** (`reminder_sent_at` com `updateMany` condicional) antes do envio, então duas execuções ou uma repetição nunca mandam o e-mail duas vezes. Lotes de 100.

### Lead e formulário

Ao marcar, `CrmLeadService.intake` (origem `meeting`) cria ou reaproveita o lead; falha nessa etapa **não** desfaz a reserva (aviso no log). Um formulário pode apontar para uma página (`crm_forms.booking_page_id`); a leitura pública devolve a página só se estiver ativa.

Códigos de erro: `CRM_MEETING_PAGE_NOT_FOUND`, `CRM_MEETING_BOOKING_NOT_FOUND`, `CRM_MEETING_SLOT_TAKEN`, `CRM_MEETING_INVALID`, `CRM_MEETING_SLUG_TAKEN`.

## Calendários por OAuth (Google e Outlook) — desligado

Hoje o único provedor de agenda é o **endereço iCal secreto**, que dispensa credencial de terceiros. A conexão por login (OAuth) fica **desligada**: `oauthProvidersEnabled` é sempre `false` no DTO de disponibilidade e a tela não oferece o botão. O ponto de encaixe é `loadFeedBusy` em `src/services/crm-meeting-slots.ts`: um provedor novo devolve a lista de intervalos ocupados do vendedor, sem mexer no restante do motor.

Para ligar, o dono da plataforma precisa fazer o cadastro dos aplicativos. O código do conector é uma entrega à parte; estes são os passos de fora do código.

### Google Agenda

1. No [Google Cloud Console](https://console.cloud.google.com/), crie (ou escolha) um projeto e ative a **Google Calendar API**.
2. Em **APIs e serviços › Tela de consentimento OAuth**, escolha **Externo**, preencha nome do aplicativo, e-mail de suporte, domínio autorizado (o do Steel), links da política de privacidade e dos termos.
3. Adicione o escopo somente leitura de disponibilidade: `https://www.googleapis.com/auth/calendar.freebusy` (evita o escopo sensível de leitura de eventos). Se o conector precisar criar eventos, acrescente `calendar.events`.
4. Em **Credenciais › Criar credenciais › ID do cliente OAuth**, tipo **Aplicativo da Web**, com a URI de redirecionamento `https://<domínio do Steel>/api/crm/meeting-oauth/google/callback` (a rota nasce com o conector).
5. Guarde o **ID do cliente** e o **segredo** nas variáveis `GOOGLE_CALENDAR_CLIENT_ID` e `GOOGLE_CALENDAR_CLIENT_SECRET` (schema em `lib/env/_server.ts` e `.env.example`, no mesmo PR do conector).
6. Enquanto o aplicativo estiver em **Teste**, só os usuários de teste cadastrados conseguem conectar e o consentimento expira em 7 dias. Para uso geral, envie o aplicativo para **verificação** do Google (escopos sensíveis exigem vídeo de demonstração e a política de privacidade publicada; leva dias a semanas).

### Outlook / Microsoft 365

1. No [portal do Azure](https://portal.azure.com/) abra **Microsoft Entra ID › Registros de aplicativo › Novo registro**.
2. Tipos de conta aceitos: **contas em qualquer diretório organizacional e contas pessoais da Microsoft**.
3. URI de redirecionamento (tipo **Web**): `https://<domínio do Steel>/api/crm/meeting-oauth/microsoft/callback`.
4. Em **Permissões de API › Microsoft Graph › Delegadas**, adicione `Calendars.Read` e `offline_access` (e `User.Read`). Contas de organização podem exigir **consentimento do administrador do locatário**.
5. Em **Certificados e segredos**, crie um **segredo do cliente** (anote a validade: ele expira, no máximo em 24 meses) e guarde-o, com o **ID do aplicativo (cliente)**, em `MICROSOFT_CALENDAR_CLIENT_ID` e `MICROSOFT_CALENDAR_CLIENT_SECRET`.
6. Para aparecer como editor verificado, complete a **verificação do editor** (conta do Microsoft Partner Network).

### Como ligar quando o conector existir

A configuração será um interruptor por workspace, **desligado por padrão**, que só aparece se as quatro variáveis acima existirem no ambiente. Sem elas, ou com o interruptor desligado, o comportamento é o de hoje (iCal). Os tokens de acesso e renovação serão guardados criptografados como o endereço iCal.

## Testes

- Unitários: serviços `crm-meeting-*` e `crm-duplicate`, mapeadores, schemas, o fatiamento de horários e os dois processadores (`src/lib/__tests__/crm-duplicates-processor.test.ts`, `crm-meetings-processor.test.ts`).
- Integração (Postgres real): `crm-duplicate.repository.test.ts` (mesclar e desfazer, pessoas e empresas, janela, edição posterior) e `crm-meeting.repository.test.ts` (reserva, folga, corrida entre reservas simultâneas, lembretes).
- E2E (rodam só na CI): `app/api/crm/meetings/__tests__`, `app/(public)/m/__tests__`, `app/api/workspaces/[id]/crm/meeting-pages/__tests__` e `…/duplicates/__tests__`.
