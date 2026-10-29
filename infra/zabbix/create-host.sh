#!/usr/bin/env bash
# Imports the "Steel Server Disk" template and creates the Zabbix host that monitors
# the Steel application server. Dry run by default: pass --apply to write.
#
#   ZBX_URL=http://10.10.100.108/zabbix ZBX_TOKEN=<api token> \
#   HOST_NAME=steel-homologacao HOST_IP=10.10.100.145 \
#   bash infra/zabbix/create-host.sh [--apply]
#
# The token is a Zabbix API token (Users > API tokens) with write access to hosts and
# templates. It is read from the environment and never stored.
set -euo pipefail

: "${ZBX_URL:?set ZBX_URL, e.g. http://10.10.100.108/zabbix}"
: "${ZBX_TOKEN:?set ZBX_TOKEN}"
: "${HOST_NAME:?set HOST_NAME}"
: "${HOST_IP:?set HOST_IP}"
HOST_GROUP="${HOST_GROUP:-Steel}"
APPLY=false; [ "${1:-}" = "--apply" ] && APPLY=true
DIR="$(cd "$(dirname "$0")" && pwd)"
API="$ZBX_URL/api_jsonrpc.php"

call() { # method, params-json
  curl -fsS -m 20 -X POST "$API" \
    -H 'Content-Type: application/json-rpc' \
    -H "Authorization: Bearer $ZBX_TOKEN" \
    -d "$(jq -cn --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",method:$m,params:$p,id:1}')" \
  | jq -e 'if .error then error(.error.data // .error.message) else .result end'
}

echo "Zabbix $(curl -fsS -m 10 -X POST "$API" -H 'Content-Type: application/json-rpc' \
  -d '{"jsonrpc":"2.0","method":"apiinfo.version","params":[],"id":1}' | jq -r .result)"
echo "Host: $HOST_NAME ($HOST_IP), group: $HOST_GROUP, apply: $APPLY"
$APPLY || { echo "dry run: nothing written (use --apply)"; exit 0; }

call configuration.import "$(jq -cn --rawfile src "$DIR/steel-server-disk.template.yaml" \
  '{format:"yaml",rules:{template_groups:{createMissing:true},templates:{createMissing:true,updateExisting:true},items:{createMissing:true,updateExisting:true},triggers:{createMissing:true,updateExisting:true}},source:$src}')" >/dev/null
echo "template imported"

GID=$(call hostgroup.get "$(jq -cn --arg n "$HOST_GROUP" '{filter:{name:[$n]},output:["groupid"]}')" | jq -r '.[0].groupid // empty')
[ -n "$GID" ] || GID=$(call hostgroup.create "$(jq -cn --arg n "$HOST_GROUP" '{name:$n}')" | jq -r '.groupids[0]')
TID=$(call template.get '{"filter":{"host":["Steel Server Disk"]},"output":["templateid"]}' | jq -r '.[0].templateid')

if [ "$(call host.get "$(jq -cn --arg h "$HOST_NAME" '{filter:{host:[$h]},output:["hostid"]}')" | jq length)" -gt 0 ]; then
  echo "host $HOST_NAME already exists: nothing to create"; exit 0
fi
call host.create "$(jq -cn --arg h "$HOST_NAME" --arg ip "$HOST_IP" --arg g "$GID" --arg t "$TID" \
  '{host:$h,interfaces:[{type:1,main:1,useip:1,ip:$ip,dns:"",port:"10050"}],groups:[{groupid:$g}],templates:[{templateid:$t}]}')" >/dev/null
echo "host $HOST_NAME created with template Steel Server Disk"
