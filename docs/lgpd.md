# LGPD — descadastro (opt-out) de mensagens de marketing

Campanhas de e-mail do CRM e transmissões do WhatsApp são comunicação de
marketing: o titular pode sair a qualquer momento, sem login, e a exclusão
vale para **todas** as campanhas/transmissões futuras do workspace. Mensagens
transacionais (login, OTP, redefinição de senha, convites, avisos de conta)
**não** passam por essas regras.

## E-mail (campanhas do CRM)

- **Link em todo e-mail de campanha.** `CrmEmailCampaignService.send` anexa um
  rodapé com o link `/unsubscribe/<token>` e os cabeçalhos
  `List-Unsubscribe: <…/api/crm/unsubscribe/<token>>` e
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058).
- **Token.** HMAC-SHA256 do id do destinatário (`src/lib/crm-email-unsubscribe.ts`),
  assinado com `BETTER_AUTH_SECRET` e separação de domínio. Não expira e não
  exige sessão. Trocar `BETTER_AUTH_SECRET` invalida os links já enviados.
  As URLs usam `BETTER_AUTH_URL`, que precisa ser a URL pública.
- **Confirmação.** O `GET` da página só mostra o endereço; o descadastro exige
  o clique (`POST`), para que scanners de link não descadastrem ninguém. O
  `POST` one-click do provedor (`List-Unsubscribe=One-Click`) descadastra
  direto. As duas rotas estão em `PUBLIC_ROUTES` (`proxy.ts`) e funcionam
  mesmo com o módulo CRM desligado: o direito de descadastro vale para todo
  e-mail já enviado.
- **Registro.** Tabela `crm_email_opt_outs` (workspace + e-mail em minúsculas,
  pessoa vinculada, campanha de origem, `source` = `LINK` ou `ONE_CLICK`,
  `created_at`). O primeiro descadastro prevalece. Auditoria:
  `audit.mutation.crm_email_opt_out.opt_out` (sem o e-mail no log).
- **Exclusão.** Feita na montagem dos destinatários (endereço **ou** pessoa
  vinculada) e revalidada no envio — quem saiu entre a criação e o disparo
  fica como `SKIPPED`. A UI só reflete (badge "Descadastrado", contagens).
- **Reinscrição.** Não há reinscrição pela interface: se o titular pedir para
  voltar a receber, remova o registro em `crm_email_opt_outs` mediante o
  pedido documentado.

## WhatsApp (transmissões)

- **Palavra-chave.** Uma mensagem recebida que seja **exatamente** `SAIR`,
  `PARAR`, `STOP` ou `DESCADASTRAR` (sem diferenciar maiúsculas, acentos e
  pontuação nas pontas) descadastra o contato das transmissões e envia uma
  confirmação na conversa; a IA não responde a essa mensagem.
  `CANCELAR` fica de fora de propósito: é a resposta natural a um lembrete de
  consulta (transmissões importadas por planilha).
- **Registro.** `whatsapp_contacts.broadcast_opted_out_at` e
  `broadcast_opt_out_source` (`KEYWORD` ou `ADMIN`). Auditoria:
  `audit.mutation.whatsapp_contact.opt_out` / `opt_in`.
- **Exclusão.** Filtrada na query ao criar a lista de transmissão e na
  importação por planilha; ao iniciar a lista e no processor de envio, quem
  saiu depois vira `SKIPPED`. Conversas individuais não são afetadas.
- **Admin.** Em Contatos, OWNER/ADMIN podem descadastrar um contato (ex.:
  pedido por telefone) — `PUT /api/workspaces/:id/whatsapp/contacts/:contactId/broadcast-opt-out`.

### Regra de reinscrição (re-subscribe)

Reinscrever um contato descadastrado **só é permitido a pedido explícito do
próprio contato** (por exemplo, ele escreveu pedindo para voltar a receber).
O admin não pode desfazer um "SAIR" por iniciativa própria nem por pedido de
terceiros.

- Somente OWNER/ADMIN (`assertModulePrivileged`, módulo Comunicação); o botão
  nem aparece para os demais membros.
- A API exige `contactRequested: true` (`UpdateWhatsAppContactBroadcastOptOutSchema`);
  sem isso responde `VALIDATION_ERROR`. Na UI, o admin precisa marcar "O
  contato pediu explicitamente para voltar a receber".
- O evento `opt_in` é auditado com quem reinscreveu e a data/origem do
  descadastro anterior. Guarde a evidência do pedido (a própria conversa no
  WhatsApp) — ela é a base legal da reinscrição.

## Registros de trabalho e indicadores de produtividade

Ajustes › Registros de trabalho mostra as horas apontadas nos chamados do
ServiceDesk (lista com filtros e CSV) e um painel de indicadores de
produtividade.

- **Finalidade.** Acompanhar a carga e o andamento do trabalho da equipe —
  planejamento de capacidade, faturamento de contratos e qualidade do
  atendimento —, não vigiar pessoas.
- **Quem vê o quê.** Dono (OWNER) e administradores (ADMIN) veem os números
  de todos e da equipe; qualquer outro membro vê **só os próprios**. A regra
  está no service (`WorklogService`), não só na tela: a API recusa (`403`) o
  pedido de um membro pelos dados de outra pessoa.
- **Sem nota e sem ranking.** Cada indicador aparece separado (esforço,
  faturamento, volume, eficiência, qualidade, confiabilidade dos dados); não
  há pontuação combinada, e as pessoas aparecem em ordem alfabética, sem
  ordenação por número.
- **Só dados que já existem.** Os indicadores saem do que as pessoas já
  registram no trabalho: apontamentos de horas, chamados atribuídos e
  resolvidos, tarefas e negócios do CRM, respostas enviadas no WhatsApp (as da
  IA não contam). **Não há** monitoramento de tela, teclado, mouse, aplicativos
  abertos nem tempo ocioso, e nada é coletado fora do Steel.
- **Só módulos habilitados.** Um módulo desligado no workspace não entra nos
  indicadores.
- **Registro.** Os downloads de CSV (apontamentos e indicadores) são auditados
  (`audit.mutation.worklog.download` / `export_requested`).

## Exportações do workspace

Ajustes › Exportações (só OWNER/ADMIN) gera uma cópia dos **dados completos**
do workspace ou dos **logs** dele no Axiom, uma vez por dia de cada tipo. O
arquivo contém dados pessoais (de membros, clientes e contatos): fica 7 dias no
armazenamento, só é baixado com login de OWNER/ADMIN, e o pedido, a conclusão
e cada download são auditados (`audit.mutation.workspace_export.*`).
Credenciais, senhas, segredos e tokens de acesso são removidos do arquivo de
dados; os logs não trazem IP nem corpo de requisição. Quem baixa passa a ser
responsável pela guarda da cópia.


## Gravação das ligações (PABX)

As ligações do botão **Ligar** podem ser gravadas pelo PABX, transcritas e
resumidas pelo Steel AI ([ADR 0043](./adr/0043-pabx-call-recording-transcription-and-summary.md),
[runbook](./runbooks/pabx-call-recording.md)). Voz é dado pessoal:

- **Desligado por padrão.** OWNER/ADMIN liga em WhatsApp › Configurações ›
  Atendimento, define o **aviso de gravação** e por quantos dias o áudio fica
  guardado (padrão 90, de 1 a 1.825).
- **Aviso ao contato.** Durante a ligação gravada, a faixa da ligação mostra
  ao atendente o aviso para ler ao contato. O texto mostrado fica registrado
  na ligação (`recording_notice`), como prova do aviso.
- **Retenção.** A data de expiração é congelada no upload. O job das 03:00
  (`data-retention` › `purge-call-recordings`) apaga o áudio vencido e também
  o áudio de ligação que não existe mais (apagada junto com a conversa, o
  contato ou o workspace). A transcrição e o resumo ficam com a ligação e
  saem quando ela sai.
- **Telefone web.** As ligações feitas no navegador
  ([ADR 0044](./adr/0044-pabx-webphone-in-the-browser.md), adendo de
  22/10/2026) entram no mesmo histórico e seguem as mesmas regras: só as de
  **saída** são gravadas, com o aviso mostrado no telefone e registrado na
  ligação. As recebidas ficam no histórico (número, horário e duração), sem
  áudio.
- **Exclusão na hora.** OWNER/ADMIN apaga o áudio de uma ligação pelo card
  ("Apagar áudio"), auditado (`audit.mutation.whatsapp_phone_call_recording.delete`);
  o upload também é auditado (`...recording.create`), sem o conteúdo.
- **Quem ouve.** Quem vê o registro onde a ligação aparece: a conversa
  (equipes e responsável), o chamado vinculado (só agentes; o solicitante não
  ouve) ou a pessoa/oportunidade do CRM (permissão de leitura do recurso).
- **Provedor.** A transcrição usa o Whisper da OpenAI e o resumo o modelo do
  workspace; nada sai com a transcrição desligada ou o Steel AI desligado. O
  mascaramento de dados pessoais antes do provedor entra com a frente de
  proteções (ADR 0041).
