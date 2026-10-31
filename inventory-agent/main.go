// Command steel-inventory-agent collects hardware, software and disk/RAM
// usage from the machine it runs on and reports it to a Steel workspace
// (ServiceDesk > Inventory). Standard library only, one static binary per OS.
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// version is stamped at build time: -ldflags "-X main.version=1.2.3".
var version = "dev"

const usage = `steel-inventory-agent %s

Usage:
  steel-inventory-agent <command> [flags]

Commands:
  run         report now, then every interval until stopped (default)
  once        report once and exit (for external schedulers)
  collect     print the report as JSON without sending it
  update      check for a new agent release and install it (no report)
  install     install as a systemd service (needs --url and --token)
  uninstall   remove the service / scheduled task and the config
  version     print the version

Flags (run, once, install):
  --url       Steel base URL, e.g. https://steel.example.com
  --token     inventory token created in Settings > Inventory
  --interval  time between reports, e.g. 6h (minimum 15m, default 6h)
  --config    config file path (default %s)
  --no-auto-update  do not replace this binary with newer releases

The URL and token can also come from STEEL_INVENTORY_URL and
STEEL_INVENTORY_TOKEN, and auto-update can be turned off with
STEEL_INVENTORY_AUTO_UPDATE=false. Flags win over the environment, which wins
over the config file.
`

func main() {
	os.Exit(runCLI(os.Args[1:], os.Stdout, os.Stderr))
}

// settings are the resolved options of one invocation.
type settings struct {
	cfg        Config
	configPath string
}

func parseSettings(name string, args []string, stderr io.Writer) (*settings, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	var (
		urlFlag      = fs.String("url", "", "Steel base URL")
		tokenFlag    = fs.String("token", "", "inventory token")
		intervalFlag = fs.String("interval", "", "time between reports")
		configFlag   = fs.String("config", defaultConfigPath(), "config file path")
		noUpdateFlag = fs.Bool("no-auto-update", false, "do not replace this binary with newer releases")
	)
	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	s := &settings{configPath: *configFlag, cfg: Config{AutoUpdate: true}}
	if existing, err := loadConfig(s.configPath); err == nil {
		s.cfg = *existing
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if v := os.Getenv("STEEL_INVENTORY_URL"); v != "" {
		s.cfg.URL = v
	}
	if v := os.Getenv("STEEL_INVENTORY_TOKEN"); v != "" {
		s.cfg.Token = v
	}
	if v, set := envAutoUpdate(); set {
		s.cfg.AutoUpdate = v
	}
	if *urlFlag != "" {
		s.cfg.URL = *urlFlag
	}
	if *tokenFlag != "" {
		s.cfg.Token = *tokenFlag
	}
	if *intervalFlag != "" {
		s.cfg.Interval = *intervalFlag
	}
	if *noUpdateFlag {
		s.cfg.AutoUpdate = false
	}
	if err := s.cfg.Validate(); err != nil {
		return nil, err
	}
	return s, nil
}

func runCLI(args []string, stdout, stderr io.Writer) int {
	command := "run"
	if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
		command, args = args[0], args[1:]
	}

	switch command {
	case "version":
		fmt.Fprintln(stdout, version)
		return 0
	case "help":
		fmt.Fprintf(stdout, usage, version, defaultConfigPath())
		return 0
	case "selftest":
		// Smoke test run on a freshly downloaded binary before it replaces the
		// current one: no config, no network.
		fmt.Fprintf(stdout, "ok %s\n", version)
		return 0
	case "collect":
		report, err := collect()
		if err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		report.clamp()
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		return 0
	case "uninstall":
		if err := uninstallService(stdout); err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		return 0
	case "run", "once", "install", "update":
		// handled below
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n", command)
		fmt.Fprintf(stderr, usage, version, defaultConfigPath())
		return 2
	}

	// A new version that keeps dying before its first accepted report is rolled
	// back here, before anything else can fail.
	exe := ""
	if command == "run" || command == "once" || command == "update" {
		exe = resolveExecutable()
		if exe != "" && command != "update" {
			rolledBack, err := rollbackIfFailed(exe, version)
			if err != nil {
				fmt.Fprintln(stderr, "update rollback:", err)
			}
			if rolledBack {
				fmt.Fprintf(stdout, "version %s failed to start, restored the previous binary\n", version)
				if command == "once" {
					return 1
				}
				return 0 // the supervisor starts the restored binary
			}
		}
	}

	s, err := parseSettings(command, args, stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		fmt.Fprintln(stderr, "error:", err)
		return 2
	}

	switch command {
	case "install":
		if err := installService(&s.cfg, s.configPath, stdout); err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		return 0
	case "once":
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := reportOnce(ctx, &s.cfg, collect, httpClient(), stdout); err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		confirmAcceptedUpdate(exe, stderr)
		return 0
	case "update":
		if !s.cfg.AutoUpdate {
			fmt.Fprintln(stdout, "auto-update is disabled")
			return 0
		}
		if exe == "" {
			fmt.Fprintln(stderr, "error: cannot locate the running executable")
			return 1
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		err := checkForUpdate(ctx, &s.cfg, httpClient(), exe, version, stdout)
		if err != nil && !errors.Is(err, errRestartRequested) {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		if err == nil {
			fmt.Fprintln(stdout, "no update to install")
		}
		return 0
	default: // run
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		client := httpClient()
		hooks := loopHooks{}
		if exe != "" {
			hooks.onReported = func() { confirmAcceptedUpdate(exe, stderr) }
			if s.cfg.AutoUpdate {
				hooks.afterTick = func(ctx context.Context) error {
					return checkForUpdate(ctx, &s.cfg, client, exe, version, stdout)
				}
			}
		}
		err := runLoopWith(ctx, &s.cfg, collect, client, stdout, hooks)
		if errors.Is(err, errRestartRequested) {
			// Update applied: exit cleanly so the supervisor (systemd
			// Restart=always) starts the new binary.
			return 0
		}
		if err != nil && !errors.Is(err, context.Canceled) {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}
		return 0
	}
}

func httpClient() *http.Client {
	return &http.Client{Timeout: 90 * time.Second}
}

type collector func() (*Report, error)

// reportOnce collects and sends one report, retrying transient failures.
func reportOnce(ctx context.Context, cfg *Config, collectFn collector, client *http.Client, out io.Writer) error {
	report, err := collectFn()
	if err != nil {
		return fmt.Errorf("collect: %w", err)
	}
	report.clamp()
	if err := sendWithRetry(ctx, client, cfg, report, 4, 30*time.Second); err != nil {
		return fmt.Errorf("send: %w", err)
	}
	fmt.Fprintf(out, "%s reported %s (%d disks, %d programs)\n",
		time.Now().Format(time.RFC3339), report.Hostname, len(report.Disks), len(report.Software))
	return nil
}

// confirmAcceptedUpdate drops the update marker once a report was accepted.
func confirmAcceptedUpdate(exe string, stderr io.Writer) {
	if exe == "" {
		return
	}
	if err := confirmUpdate(exe); err != nil {
		fmt.Fprintln(stderr, "update marker:", err)
	}
}

// loopHooks are the optional extension points of the run loop.
type loopHooks struct {
	// onReported runs once, after the first report the server accepted.
	onReported func()

	// afterTick runs after every report tick (accepted or not). An
	// errRestartRequested result stops the loop; any other error is logged.
	afterTick func(ctx context.Context) error
}

// initialDelay is the wait before the first report; a variable for tests.
var initialDelay = startJitter

// runLoop reports now (after a small random delay so a fleet restarted
// together does not hit the server at once) and then every interval. A token
// rejection stops the loop; any other failure is logged and retried next tick.
func runLoop(ctx context.Context, cfg *Config, collectFn collector, client *http.Client, out io.Writer) error {
	return runLoopWith(ctx, cfg, collectFn, client, out, loopHooks{})
}

func runLoopWith(ctx context.Context, cfg *Config, collectFn collector, client *http.Client, out io.Writer, hooks loopHooks) error {
	interval, err := cfg.IntervalDuration()
	if err != nil {
		return err
	}
	if err := sleep(ctx, initialDelay()); err != nil {
		return err
	}
	confirmed := false
	for {
		if err := reportOnce(ctx, cfg, collectFn, client, out); err != nil {
			var unauthorized ErrUnauthorized
			if errors.As(err, &unauthorized) {
				return err
			}
			fmt.Fprintln(out, "report failed:", err)
		} else if !confirmed {
			confirmed = true
			if hooks.onReported != nil {
				hooks.onReported()
			}
		}
		if hooks.afterTick != nil {
			// A failed update check never stops reporting.
			if err := hooks.afterTick(ctx); err != nil {
				if errors.Is(err, errRestartRequested) {
					return err
				}
				fmt.Fprintln(out, "update check failed:", err)
			}
		}
		if err := sleep(ctx, interval); err != nil {
			return err
		}
	}
}

func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// startJitter is a random delay of up to two minutes.
func startJitter() time.Duration {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(2*time.Minute)))
	if err != nil {
		return 0
	}
	return time.Duration(n.Int64())
}
