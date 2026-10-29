# steel-inventory-agent

Lightweight inventory agent for the Steel ServiceDesk (S1). It reports hardware,
network, disk/RAM usage and installed software to a workspace, which keeps the
CMDB up to date. Go, standard library only, one static binary per OS.

```bash
steel-inventory-agent install --url https://steel.example.com --token <token>   # service / scheduled task
steel-inventory-agent collect                                                  # print the report, send nothing
steel-inventory-agent once                                                     # report once and exit
steel-inventory-agent run                                                      # report now and every --interval
steel-inventory-agent uninstall
```

- **Token**: created in Settings > Inventory (shown once). Sent as
  `Authorization: Bearer`. A rejected token (401/403) stops `run` and is not
  retried; other failures retry with exponential backoff and again next tick.
- **Config**: `/etc/steel-inventory-agent.json` (Linux) or
  `%ProgramData%\SteelInventoryAgent\config.json` (Windows), mode `0600`.
  `STEEL_INVENTORY_URL` / `STEEL_INVENTORY_TOKEN` and flags override it.
- **Identity**: `sha256(machine-id)` (Linux `/etc/machine-id`, Windows
  `MachineGuid`), so reinstalling keeps the same device.
- **Wire format**: `Report` in `report.go`, mirrored by `SdInventoryReportSchema`
  (`src/schemas/sd-inventory.schema.ts`). Keep both in sync.
- **Platform code**: `collect_linux.go`, `collect_windows.go` (one PowerShell run),
  `collect_other.go` (portable stub so the tests run anywhere). Pure parsers live
  in `parse.go` and `flexible.go`.

## Develop

```bash
go vet ./... && go test ./...
GOOS=windows GOARCH=amd64 go build -o steel-inventory-agent.exe .
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.version=dev" .
```

CI (`.github/workflows/inventory-agent.yml`) checks gofmt, vets, tests on Linux
and Windows and cross-builds `linux/amd64`, `linux/arm64` and `windows/amd64`.
Windows binaries are not code signed yet (pending product decision).
