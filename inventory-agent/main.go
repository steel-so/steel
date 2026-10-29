// Command steel-inventory-agent collects hardware, software and disk/RAM
// usage from the machine it runs on and reports it to a Steel workspace
// (ServiceDesk > Inventory). Standard library only, one static binary per OS.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand"
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
  once        report once and exit (used by the Windows scheduled task)
  collect     print the report as JSON without sending it
  install     install as a service / scheduled task (needs --url and --token)
  uninstall   remove the service / scheduled task and the config
  version     print the version

Flags (run, once, install):
  --url       Steel base URL, e.g. https://steel.example.com
  --token     inventory token created in Settings > Inventory
  --interval  time between reports, e.g. 6h (minimum 15m, default 6h)
  --config    config file path (default %s)

The URL and token can also come from STEEL_INVENTORY_URL and
STEEL_INVENTORY_TOKEN. Flags win over the environment, which wins over the
config file.
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
	)
	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	s := &settings{configPath: *configFlag}
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
	if *urlFlag != "" {
		s.cfg.URL = *urlFlag
	}
	if *tokenFlag != "" {
		s.cfg.Token = *tokenFlag
	}
	if *intervalFlag != "" {
		s.cfg.Interval = *intervalFlag
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
	case "run", "once", "install":
		// handled below
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n", command)
		fmt.Fprintf(stderr, usage, version, defaultConfigPath())
		return 2
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
		return 0
	default: // run
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := runLoop(ctx, &s.cfg, collect, httpClient(), stdout); err != nil && !errors.Is(err, context.Canceled) {
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

// runLoop reports now (after a small random delay so a fleet restarted
// together does not hit the server at once) and then every interval. A token
// rejection stops the loop; any other failure is logged and retried next tick.
func runLoop(ctx context.Context, cfg *Config, collectFn collector, client *http.Client, out io.Writer) error {
	interval, err := cfg.IntervalDuration()
	if err != nil {
		return err
	}
	if err := sleep(ctx, time.Duration(rand.Int63n(int64(2*time.Minute)))); err != nil {
		return err
	}
	for {
		if err := reportOnce(ctx, cfg, collectFn, client, out); err != nil {
			var unauthorized ErrUnauthorized
			if errors.As(err, &unauthorized) {
				return err
			}
			fmt.Fprintln(out, "report failed:", err)
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
