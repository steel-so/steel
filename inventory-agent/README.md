# steel-inventory-agent

Lightweight inventory agent for the Steel ServiceDesk (S1). It reports hardware,
network, disk/RAM usage and installed software to a workspace, which keeps the
CMDB up to date. Go, standard library only, one static binary per OS.

```bash
steel-inventory-agent install --url https://steel.example.com --token <token>   # service / scheduled task
steel-inventory-agent collect                                                  # print the report, send nothing
steel-inventory-agent once                                                     # report once and exit
steel-inventory-agent run                                                      # report now and every --interval
steel-inventory-agent update                                                   # check for a new agent release and install it
steel-inventory-agent uninstall
```

- **Token**: created in Settings > Inventory (shown once). Sent as
  `Authorization: Bearer`. A rejected token (401/403) stops `run` and is not
  retried; other failures retry with exponential backoff and again next tick.
- **Config**: `/etc/steel-inventory-agent.json`, mode `0600`.
  `STEEL_INVENTORY_URL` / `STEEL_INVENTORY_TOKEN` and flags override it.
- **Identity**: `sha256(machine-id)` (Linux `/etc/machine-id`), so reinstalling keeps the same device.
- **Wire format**: `Report` in `report.go`, mirrored by `SdInventoryReportSchema`
  (`src/schemas/sd-inventory.schema.ts`). Keep both in sync.
- **Platform code**: `collect_linux.go`,
  `collect_other.go` (portable stub so the tests run anywhere). Pure parsers live
  in `parse.go` and `flexible.go`.

## Auto-update

The agent can replace itself with the release the Steel server publishes for its
OS and architecture. There are two independent switches: the workspace setting on
the server (when off, the server never offers a release) and the local one below.

Flow, every time `run` finishes a report tick (the first check happens right after
the first report) and in the `update` command:

1. `GET /api/servicedesk/inventory/agent/version?os=&arch=&current=` with the
   Bearer token. `updateAvailable=false` ends here. A 401/403 is the usual
   `ErrUnauthorized`.
2. The binary is downloaded from `downloadPath` into `<exe>.new`, in the same
   directory as the executable, capped at 64 MiB and at the declared size. Its
   SHA-256 is computed while streaming and must equal both the manifest `sha256`
   and the `X-Content-SHA256` header (when present). On any mismatch the file is
   deleted and nothing is replaced.
3. Smoke test: `<exe>.new selftest` (10 s timeout) must exit 0 and print
   `ok <version>` with the manifest version. `selftest` reads no config and
   touches no network.
4. Swap: the current binary is renamed to `<exe>.old`, `<exe>.new` becomes the
   executable (renaming a running executable works on Linux), and
   `<exe>.update.json` records `fromVersion`, `toVersion`, `attempts: 0` and
   `createdAt`. If the second rename fails the first one is undone.
5. `run` returns and the process exits with code 0 so the supervisor starts the
   new binary: the systemd unit has `Restart=always`, so a clean exit restarts it.

Builds whose version is `dev` never update. A failed check (server down, bad
checksum, failed selftest) is logged as `update check failed` and reporting
continues.

Rollback: at the very start of `run` and `once`, if the marker's `toVersion` is the
running version the attempt counter is incremented and saved before anything else.
When it goes above 2, the new binary is considered broken: it is moved to
`<exe>.failed`, `<exe>.old` is restored, the marker is deleted and the process exits
so the supervisor starts the old binary. The first report the server accepts
deletes the marker (the update is confirmed). `<exe>.old` is kept until the next
update replaces it.

Turning it off locally: `--no-auto-update` (also stored by `install`),
`STEEL_INVENTORY_AUTO_UPDATE=false`, or `"autoUpdate": false` in the config file.
The default is on, including for config files written before this option existed.

## Develop

```bash
go vet ./... && go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.version=dev" .
```

CI (`.github/workflows/inventory-agent.yml`) checks gofmt, vets, tests on Linux
and cross-builds `linux/amd64` and `linux/arm64`.
