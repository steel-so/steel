# 0052 — Arquivamento de conversas do WhatsApp para bancos: pacote .zip com um PDF por atendimento

- **Status:** Aceita
- **Data:** 2026-10-27
- **Decisores:** Alexandre (product owner); detalhes de implementação decididos pelo agente da fatia `zap-archive` (onda banks).

## Contexto

Bancos que trabalham com a Fidelizza+ (cobrança e relacionamento pelo
WhatsApp) exigem uma cópia estruturada das conversas: um pacote semanal e um
completo mensal, organizado por dia, atendente e contato, para auditoria. O
Steel já guarda as mensagens (`WhatsAppMessage`), exporta a transcrição de uma
conversa em TXT/CSV (`src/lib/whatsapp/conversation-export.ts`) e gera PDF com
`@react-pdf/renderer` (relatório de SLA, propostas). Não havia nada por período,
nem por atendente, nem com prova de integridade.

Decisões já tomadas pelo product owner: o "usuário" da pasta é o
**atendente**; **um PDF por atendimento**; guardar no **MinIO + cópia fora do
servidor**, com download em **.zip**. O servidor é pequeno: o pacote nunca
pode ficar inteiro na memória.

## Decisão

Criar o **arquivamento de conversas**: por workspace, **desligado por padrão**,
ligado só pelo admin global da plataforma. Ligado, o worker gera dois tipos de
pacote na fila nova `whatsapp-archive`:

| Tipo | Período | Quando roda | Guarda |
| --- | --- | --- | --- |
| `WEEKLY` (semanal) | segunda anterior 00:00 → domingo 23:59:59.999 | segunda, 02:00 | 90 dias |
| `MONTHLY_FULL` (completo) | todo o histórico até o último instante do mês anterior | dia 1, 02:30 | 12 meses |

Todo "dia", hora, nome de arquivo e carimbo é em **America/Sao_Paulo**.
O "Gerar agora" do admin e o script `pnpm archive:whatsapp` usam o mesmo
período que o agendamento do dia (reproduzível). Constantes em
`src/lib/queue/retention.ts` (`WhatsappArchiveCron`, `WhatsappArchiveRetention`).

### Layout do pacote

```
<RAIZ>/WHATSAPP/<AAAA-MM-DD>/<atendente>/<contato>-<AAAA-MM-DD>-<HHhMM>.pdf
<RAIZ>/WHATSAPP/INDICE.csv
```

- **RAIZ**: configurável pelo admin; padrão = slug do workspace em
  maiúsculas só com A-Z e 0-9 (`fidelizza-mais` → `FIDELIZZAMAIS`).
- **Atendimento** = uma conversa × um dia de São Paulo (as mensagens daquela
  conversa naquele dia).
- **Atendente** = cada humano distinto que enviou mensagem (OUT,
  `senderUserId`) naquele dia, pelo nome em slug; o mesmo PDF é copiado na
  pasta de cada um quando mais de um falou. Só a IA respondeu → `IA`. Ninguém
  respondeu → o responsável pela conversa; sem responsável → `sem-atendente`.
- **Contato** = nome em slug + telefone (ou só o telefone; contato só com BSUID
  usa o BSUID em slug). **Hora** = primeira mensagem do dia.
- Nomes só com `a-z0-9-` (a raiz aceita também maiúsculas e `_`), cortados em
  50 caracteres, nunca um nome reservado do Windows (`CON`, `LPT1`…), únicos
  sem diferenciar maiúsculas: dois atendentes de mesmo nome (ou um usuário
  chamado "IA") ganham sufixo do id; dois PDFs com o mesmo caminho ganham
  `-2`, `-3`. O .zip abre igual no Windows, macOS e Linux.
- **INDICE.csv** (UTF-8 com BOM, vírgula): `arquivo` (relativo à pasta
  `WHATSAPP/`), `data`, `hora_inicio`, `atendente`, `contato`, `telefone`,
  `mensagens`, `sha256` de cada PDF. Células que começam com `=`, `+`, `-` ou
  `@` (exceto telefone) ganham `'` para o Excel não executar fórmula. O SHA-256
  do .zip inteiro fica no registro do pacote e aparece na tela.

### PDF de um atendimento

Cabeçalho com workspace, conexão, contato e telefone, atendente(s) (com "IA"
quando a IA também respondeu), dia, número de protocolo quando houver, ID da
conversa e número de mensagens; uma linha por mensagem com hora (hh:mm:ss),
remetente (contato, nome do atendente ou IA — mesmos rótulos da transcrição)
e texto, ou o marcador da mídia (`[imagem]`, `[documento]`…) com o nome do
arquivo. Mensagem apagada sai marcada `[mensagem apagada]` **e mantém o texto
que o banco de dados ainda tem** (é registro de auditoria). Rodapé com data de
geração e "Página x de y".

### Como é gerado (memória limitada)

O job `build` pagina as conversas (50 por vez, só as que têm mensagem no
período) e as mensagens de cada conversa (500 por vez), agrupando por dia.
Cada PDF é escrito direto num .zip em arquivo temporário (dependência
`yazl` 3.3.1, fixada) e só o próximo PDF é montado depois de o anterior sair
do buffer: `addReadStreamLazy` com a referência solta na primeira leitura
(com `addBuffer` o yazl manteria todos os PDFs vivos até o fim). PDFs vão
**sem compressão** no zip (já são comprimidos; menos CPU); o índice vai
comprimido. O .zip sobe por stream para o bucket `whatsapp-archives` com o
SHA-256 calculado na escrita. Pacote sem conversas no período sai só com o
índice (prova de que não houve atendimento).

### Cópia fora do servidor

Job separado `copy-to-offsite` (como o backup: falha no provedor é
reprocessada sozinha), que lê o objeto do MinIO por stream, sobe com tamanho
conhecido e confere lendo de volta (tamanho + SHA-256 por stream). Usa as
mesmas variáveis `BACKUP_OFFSITE_*`; sem elas é inerte com aviso no log. O
prefixo é **irmão** do dos backups (`steel/` → `steel-whatsapp-archives/`),
porque o prune dos backups apaga tudo sob o próprio prefixo com mais de
`BACKUP_OFFSITE_RETENTION_DAYS` — um pacote completo de 12 meses sumiria em
90 dias. O prune do arquivamento (diário, 04:50) apaga do MinIO e da cópia
externa os pacotes vencidos e mantém a linha no histórico.

### Acesso e auditoria

- Admin global (painel do workspace): ligar/desligar, pasta raiz, "Gerar
  semanal agora", "Gerar completo agora", lista e download — tudo na trilha
  do admin (`whatsapp_archive.*`).
- OWNER/ADMIN do workspace, com Comunicação habilitada: lista e download em
  **Comunicação › Configurações › Atendimento**. Download por rota autenticada
  que transmite do MinIO (a API do MinIO não é pública; não há URL
  pré-assinada). `auditMutation` em ligar, gerar e baixar.
- Um pacote do mesmo tipo por vez por workspace (`WHATSAPP_ARCHIVE_IN_PROGRESS`);
  o agendamento não duplica um período que já tem pacote.

## Consequências

- O banco recebe um .zip autoexplicativo, com integridade conferível arquivo a
  arquivo (`INDICE.csv`) e no todo (SHA-256 na tela e nos metadados).
- **Sem cifra da aplicação no pacote**: o MinIO é interno e a cópia externa usa
  SSE do provedor. Cifrar por stream exigiria um formato próprio que o banco não
  abre. Revisitar se algum banco exigir pacote cifrado (ex.: zip com senha
  AES).
- **Emoji vira `[emoji]` no PDF** e caracteres fora do Windows-1252 viram `?`:
  a fonte embutida (Helvetica) não os desenha e o servidor não carrega fontes
  de rede. Revisitar embutindo uma fonte Unicode se algum cliente reclamar.
- **Protocolo**: o PDF já tem o campo, mas o modelo de protocolo da ADR 0049
  ainda não existe; hoje sai vazio. Quando existir, o worker passa o número
  do ciclo daquele dia.
- Entram todas as conversas do workspace (inclusive excluídas/limpas na tela e
  as do WhatsApp dentro do chamado): o arquivo é o registro do que aconteceu.
  Grupos (`WhatsAppGroup`) e disparos em massa sem conversa não entram.
- O pacote completo cresce com o histórico; o worker processa em sequência e o
  disco temporário precisa comportar um pacote. Acompanhar o tamanho dos
  primeiros completos da Fidelizza+.
- Com `BACKUP_OFFSITE_PREFIX` vazio o prefixo dos pacotes fica dentro do dos
  backups e o prune dos backups os apagaria no prazo deles: configure um
  prefixo (o padrão é `steel/`).
