# Zabbix — disco do servidor do Steel

Template **Steel Server Disk** e script para criar o host que monitora o servidor da aplicação.

## O que alerta

| Gatilho | Quando | Severidade |
| ------- | ------ | ---------- |
| Disco em `/` ≥ 80% | volta ao normal abaixo de 75% | Warning |
| Disco em `/` ≥ 90% | volta ao normal abaixo de 85% | High |

O servidor da aplicação já parou por disco cheio (imagens Docker acumuladas dos deploys): o Postgres não consegue gravar o checkpoint e entra em loop. O alerta de 80% dá tempo de rodar `docker image prune -a -f` antes disso.

## Criar o host

Pré-requisitos: o **Zabbix agent** instalado e liberado (porta 10050) no servidor, e um **token de API** do Zabbix (Usuários > Tokens de API) com escrita em hosts e templates.

```bash
ZBX_URL=http://10.10.100.108/zabbix ZBX_TOKEN=<token> \
HOST_NAME=steel-homologacao HOST_IP=10.10.100.145 \
bash infra/zabbix/create-host.sh           # simulação
bash infra/zabbix/create-host.sh --apply   # grava (importa o template e cria o host)
```

Sem o script, importe `steel-server-disk.template.yaml` em Coleta de dados > Templates > Importar e crie o host à mão com esse template.

## Enviar o alerta ao Steel

O Steel já abre chamado a partir do Zabbix (ServiceDesk › Configurações › Monitoramento; ver `content/docs/servicedesk/monitoramento.mdx`). Crie uma origem do tipo Zabbix, copie a URL e configure um tipo de mídia **Webhook** no Zabbix com ela. Depois crie uma ação (Alertas > Ações) para eventos do template `Steel Server Disk` usando essa mídia. O chamado liga ao item da CMDB pelo nome ou IP do host.
