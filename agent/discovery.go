package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	gnet "github.com/shirou/gopsutil/v3/net"
)

const discoveryReadLimit = 256 << 10
const discoveryMaxAssets = 200

var discoveryEnabled, discoveryDocker, discoverySmart, discoveryOnce bool
var discoveryInterval int

func init() {
	flag.BoolVar(&discoveryEnabled, "discovery", false, "Opt in to sanitized, read-only infrastructure discovery")
	flag.BoolVar(&discoveryDocker, "discovery-docker", false, "Opt in to local Docker Unix socket reads; socket access itself remains privileged")
	flag.BoolVar(&discoverySmart, "discovery-smart", false, "Opt in to fixed local SMART health reads when permitted")
	flag.BoolVar(&discoveryOnce, "discovery-once", false, "Print one sanitized discovery snapshot locally and exit without sending")
	flag.IntVar(&discoveryInterval, "discovery-interval", 1800, "Discovery interval in seconds (minimum 300)")
}

type DiscoveryEvidence struct {
	Source      string `json:"source"`
	CollectedAt string `json:"collected_at"`
	Confidence  string `json:"confidence"`
}
type DiscoveryValue struct {
	Status      string `json:"status"`
	Value       any    `json:"value"`
	Source      string `json:"source"`
	CollectedAt string `json:"collected_at"`
	Confidence  string `json:"confidence"`
	Environment string `json:"environment"`
	Reason      string `json:"reason,omitempty"`
}
type DiscoveryRelation struct {
	TargetExternalID string `json:"target_external_id"`
	Kind             string `json:"kind"`
}
type DiscoveryAsset struct {
	ExternalID string              `json:"external_id"`
	Kind       string              `json:"kind"`
	Name       string              `json:"name"`
	Metadata   map[string]any      `json:"metadata"`
	Evidence   DiscoveryEvidence   `json:"evidence"`
	Relations  []DiscoveryRelation `json:"relations,omitempty"`
}
type DiscoveryCollector struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}
type DiscoverySnapshot struct {
	SchemaVersion int                       `json:"schema_version"`
	Source        string                    `json:"source"`
	CollectedAt   string                    `json:"collected_at"`
	Complete      bool                      `json:"complete"`
	Collectors    []DiscoveryCollector      `json:"collectors"`
	Assets        []DiscoveryAsset          `json:"assets"`
	Configuration map[string]DiscoveryValue `json:"configuration"`
}

type discoverySource struct {
	root     string
	platform string
	command  func(context.Context, string, ...string) ([]byte, error)
	now      func() time.Time
	docker   bool
	smart    bool
}

func newDiscoverySource() discoverySource {
	return discoverySource{root: "/", platform: runtime.GOOS, command: discoveryCommand, now: time.Now, docker: discoveryDocker, smart: discoverySmart}
}

type limitedDiscoveryOutput struct {
	bytes.Buffer
	limit int
}

func (b *limitedDiscoveryOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, errors.New("collection_limit")
	}
	return b.Buffer.Write(p)
}

// Only collector-owned literal commands reach this boundary; no command, path,
// arguments, or environment variables are accepted from the control plane.
func discoveryCommand(parent context.Context, name string, args ...string) ([]byte, error) {
	switch name {
	case "systemctl", "sshd", "nft", "fail2ban-client", "docker", "caddy", "nginx", "smartctl":
	default:
		return nil, errors.New("unsupported_collector")
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = 100 * time.Millisecond
	var output = limitedDiscoveryOutput{limit: discoveryReadLimit}
	var stderr = limitedDiscoveryOutput{limit: 8192}
	cmd.Stdout = &output
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		if strings.Contains(strings.ToLower(stderr.String()), "permission denied") || strings.Contains(strings.ToLower(stderr.String()), "operation not permitted") {
			return nil, os.ErrPermission
		}
		if name == "smartctl" {
			return output.Bytes(), err
		}
		if name == "systemctl" && len(args) > 0 && args[0] == "is-enabled" {
			switch strings.TrimSpace(output.String()) {
			case "disabled", "masked", "masked-runtime", "static", "indirect", "generated", "transient", "linked", "linked-runtime":
				return output.Bytes(), nil
			}
		}
		return nil, err
	}
	if name == "nginx" {
		return append(output.Bytes(), stderr.Bytes()...), nil
	}
	return output.Bytes(), nil
}

func discoveryErrorStatus(err error) (string, string) {
	if errors.Is(err, os.ErrPermission) {
		return "permission_denied", "insufficient_local_permissions"
	}
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, exec.ErrNotFound) {
		return "unavailable", "not_installed_or_absent"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "error", "collection_timeout"
	}
	return "error", "collection_failed"
}

func (s discoverySource) read(name string) ([]byte, error) {
	path := filepath.Join(s.root, filepath.FromSlash(strings.TrimPrefix(name, "/")))
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("not_a_regular_file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, discoveryReadLimit+1))
	if len(data) > discoveryReadLimit {
		return nil, errors.New("collection_limit")
	}
	return data, err
}
func stableDiscoveryID(kind, identity string) string {
	sum := sha256.Sum256([]byte(identity))
	return kind + ":" + hex.EncodeToString(sum[:16])
}
func (s discoverySource) collect(ctx context.Context) DiscoverySnapshot {
	at := s.now().UTC().Format(time.RFC3339)
	out := DiscoverySnapshot{SchemaVersion: 1, Source: "agent", CollectedAt: at, Complete: true, Assets: []DiscoveryAsset{}, Collectors: []DiscoveryCollector{}, Configuration: map[string]DiscoveryValue{}}
	put := func(key string, value any, source, confidence string, err error) {
		status, reason := "available", ""
		if err != nil {
			status, reason = discoveryErrorStatus(err)
			value = nil
			confidence = "unknown"
			out.Complete = false
		}
		out.Configuration[key] = DiscoveryValue{Status: status, Value: value, Source: source, CollectedAt: at, Confidence: confidence, Environment: s.platform, Reason: reason}
		out.Collectors = append(out.Collectors, DiscoveryCollector{Name: key, Status: status, Reason: reason})
	}
	unknown := func(key, reason string) {
		out.Configuration[key] = DiscoveryValue{Status: "unknown", Value: nil, Source: "agent", CollectedAt: at, Confidence: "unknown", Environment: s.platform, Reason: reason}
	}
	hostMeta := map[string]any{"platform": s.platform, "architecture": runtime.GOARCH}
	if info, err := host.InfoWithContext(ctx); err == nil {
		hostMeta["os"] = info.Platform
		hostMeta["os_version"] = info.PlatformVersion
		hostMeta["kernel"] = info.KernelVersion
		hostMeta["virtualization"] = info.VirtualizationSystem
	}
	out.Assets = append(out.Assets, DiscoveryAsset{ExternalID: "host", Kind: "vps", Name: clientNameOrHost(), Metadata: hostMeta, Evidence: DiscoveryEvidence{Source: "host", CollectedAt: at, Confidence: "observed"}})
	put("system", hostMeta, "host", "observed", nil)
	zone, offset := s.now().Zone()
	timezone := map[string]any{"name": zone, "utc_offset_seconds": offset}
	if data, err := s.read("/etc/timezone"); err == nil {
		if value := strings.TrimSpace(string(data)); regexp.MustCompile(`^[A-Za-z0-9_+/-]{1,100}$`).MatchString(value) {
			timezone["zone_id"] = value
		}
	}
	put("timezone", timezone, "system clock and timezone identifier when available", "observed", nil)
	unknown("backups", "external_harness_evidence_required")
	unknown("deployment_directories", "reported_only_by_compose_labels_or_external_harness")
	if s.platform != "linux" {
		for _, key := range []string{"ssh", "firewall", "fail2ban", "security_updates", "bbr", "swap", "systemd", "timers", "cron", "smart", "docker"} {
			unknown(key, "unsupported_platform")
		}
		out.Complete = false
		boundDiscoverySnapshot(&out)
		return out
	}
	if data, err := s.read("/etc/os-release"); err == nil {
		put("os_release", parseKeyValues(string(data), map[string]bool{"ID": true, "VERSION_ID": true, "PRETTY_NAME": true, "ID_LIKE": true}, "="), "/etc/os-release", "observed", nil)
	} else {
		put("os_release", nil, "/etc/os-release", "unknown", err)
	}
	data, err := s.command(ctx, "sshd", "-T")
	put("ssh", parseKeyValues(string(data), map[string]bool{"permitrootlogin": true, "passwordauthentication": true, "pubkeyauthentication": true, "permitemptypasswords": true, "kbdinteractiveauthentication": true, "port": true, "maxauthtries": true, "clientaliveinterval": true, "x11forwarding": true}, " "), "sshd -T (default context; Match rules may differ)", "observed", err)
	data, err = s.command(ctx, "nft", "--json", "list", "ruleset")
	firewall, parseErr := parseFirewallSummary(data)
	if err == nil {
		err = parseErr
	}
	put("firewall", firewall, "nft --json list ruleset", "observed", err)
	data, err = s.command(ctx, "fail2ban-client", "status")
	jails := []string{}
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if pos := strings.Index(line, "Jail list:"); pos >= 0 {
				for _, j := range strings.Split(line[pos+10:], ",") {
					if value := strings.TrimSpace(j); value != "" && len(value) < 100 {
						jails = append(jails, value)
					}
				}
			}
		}
	}
	put("fail2ban", map[string]any{"jails": jails}, "fail2ban-client status", "observed", err)
	data, err = s.read("/proc/sys/net/ipv4/tcp_congestion_control")
	put("bbr", strings.TrimSpace(string(data)), "/proc/sys/net/ipv4/tcp_congestion_control", "observed", err)
	data, err = s.read("/proc/swaps")
	put("swap", parseSwapSummary(string(data)), "/proc/swaps", "observed", err)
	data, err = s.command(ctx, "systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend", "--plain")
	services := parseSystemdUnits(string(data))
	put("systemd", services, "systemctl list-units", "observed", err)
	if err == nil {
		for _, service := range services {
			if len(out.Assets) >= discoveryMaxAssets {
				out.Complete = false
				break
			}
			unit := service["unit"].(string)
			out.Assets = append(out.Assets, DiscoveryAsset{ExternalID: stableDiscoveryID("service", unit), Kind: "service", Name: unit, Metadata: service, Evidence: DiscoveryEvidence{"systemctl list-units", at, "observed"}, Relations: []DiscoveryRelation{{"host", "runs_on"}}})
		}
	}
	data, err = s.command(ctx, "systemctl", "list-timers", "--all", "--no-pager", "--no-legend")
	put("timers", parseTimerNames(string(data)), "systemctl list-timers (unit names only)", "observed", err)
	data, err = s.command(ctx, "systemctl", "is-enabled", "apt-daily-upgrade.timer")
	put("security_updates", map[string]any{"apt_daily_upgrade_timer": strings.TrimSpace(string(data)), "package_policy": "unknown"}, "systemctl is-enabled apt-daily-upgrade.timer", "partial", err)
	cron, err := s.cronSummary()
	put("cron", cron, "/etc/crontab and /etc/cron.d (schedule/count only)", "partial", err)
	interfaces, err := gnet.InterfacesWithContext(ctx)
	type networkInterface struct {
		Name      string   `json:"name"`
		Addresses []string `json:"addresses"`
		MTU       int      `json:"mtu"`
	}
	network := []networkInterface{}
	for _, iface := range interfaces {
		addrs := []string{}
		for _, addr := range iface.Addrs {
			addrs = append(addrs, addr.Addr)
		}
		network = append(network, networkInterface{iface.Name, addrs, iface.MTU})
	}
	put("network", network, "network interfaces", "observed", err)
	connections, err := gnet.ConnectionsWithContext(ctx, "inet")
	listeners := []map[string]any{}
	for _, c := range connections {
		if c.Status == "LISTEN" || (c.Type == 2 && c.Raddr.Port == 0) {
			listeners = append(listeners, map[string]any{"address": c.Laddr.IP, "port": c.Laddr.Port, "protocol": map[uint32]string{1: "tcp", 2: "udp"}[c.Type]})
			if len(listeners) >= 128 {
				break
			}
		}
	}
	put("listeners", listeners, "kernel socket table (no process arguments)", "observed", err)
	mounts, err := disk.PartitionsWithContext(ctx, false)
	mountSummary := []map[string]any{}
	for _, m := range mounts {
		mountSummary = append(mountSummary, map[string]any{"device": m.Device, "mountpoint": m.Mountpoint, "filesystem": m.Fstype})
		if len(mountSummary) >= 64 {
			break
		}
	}
	put("mounts", mountSummary, "mounted filesystems (no mount options)", "observed", err)
	if nodeMetrics.containerized() {
		unknown("disk_io", "container_scope_unverified")
	} else {
		counters, err := disk.IOCountersWithContext(ctx)
		ioSummary := map[string]any{}
		if err == nil {
			ioSummary = discoveryDiskIO.observe(counters, s.now())
		}
		put("disk_io", ioSummary, "kernel disk counters; rates are averages between consecutive discovery snapshots", "observed", err)
	}
	for _, entry := range []struct {
		name string
		args []string
	}{{"docker", []string{"--version"}}, {"caddy", []string{"version"}}, {"nginx", []string{"-v"}}} {
		data, err := s.command(ctx, entry.name, entry.args...)
		version := safeVersion(string(data))
		put("runtime_"+entry.name, version, entry.name+" version", "observed", err)
	}
	data, err = s.command(ctx, "docker", "compose", "version", "--short")
	put("runtime_compose", safeVersion(string(data)), "docker compose version", "observed", err)
	s.collectReverseProxies(ctx, &out)
	if s.docker {
		s.collectDocker(ctx, &out)
	} else {
		unknown("docker", "disabled_locally; Docker socket permissions are equivalent to host control")
		out.Complete = false
		out.Collectors = append(out.Collectors, DiscoveryCollector{"docker", "disabled", "disabled_locally"})
	}
	if s.smart {
		s.collectSMART(ctx, &out)
	} else {
		unknown("smart", "disabled_locally_or_virtual_hardware")
	}
	out.Assets = mergeDiscoveryAssets(out.Assets)
	if len(out.Assets) > discoveryMaxAssets {
		out.Assets = out.Assets[:discoveryMaxAssets]
		out.Complete = false
		out.Collectors = append(out.Collectors, DiscoveryCollector{"inventory", "partial", "collection_limit"})
	}
	boundDiscoverySnapshot(&out)
	return out
}
func clientNameOrHost() string {
	if clientName != "" {
		return clientName
	}
	value, _ := os.Hostname()
	return value
}
func safeVersion(value string) string {
	line := strings.SplitN(strings.TrimSpace(value), "\n", 2)[0]
	if len(line) > 160 {
		line = line[:160]
	}
	return line
}
func parseKeyValues(text string, allowed map[string]bool, separator string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, separator, 2)
		if len(parts) != 2 || !allowed[parts[0]] {
			continue
		}
		value := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
		if len(value) <= 160 {
			out[parts[0]] = value
		}
	}
	return out
}
func parseSwapSummary(text string) []map[string]any {
	out := []map[string]any{}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) != 5 || f[0] == "Filename" {
			continue
		}
		size, e1 := strconv.ParseInt(f[2], 10, 64)
		used, e2 := strconv.ParseInt(f[3], 10, 64)
		if e1 == nil && e2 == nil {
			out = append(out, map[string]any{"path": f[0], "kind": f[1], "size_kib": size, "used_kib": used})
		}
	}
	return out
}
func parseSystemdUnits(text string) []map[string]any {
	out := []map[string]any{}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(strings.TrimPrefix(strings.TrimSpace(line), "●"))
		if len(f) < 4 || !strings.HasSuffix(f[0], ".service") {
			continue
		}
		out = append(out, map[string]any{"unit": f[0], "load": f[1], "active": f[2], "sub": f[3]})
		if len(out) >= 120 {
			break
		}
	}
	return out
}
func parseTimerNames(text string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, word := range strings.Fields(text) {
		if strings.HasSuffix(word, ".timer") && !seen[word] {
			seen[word] = true
			out = append(out, word)
		}
	}
	sort.Strings(out)
	if len(out) > 100 {
		return out[:100]
	}
	return out
}
func parseFirewallSummary(data []byte) (map[string]any, error) {
	var root struct {
		Nftables []map[string]json.RawMessage `json:"nftables"`
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	chains := []map[string]any{}
	rules := 0
	for _, item := range root.Nftables {
		if _, ok := item["rule"]; ok {
			rules++
		}
		if raw, ok := item["chain"]; ok {
			var chain map[string]any
			if json.Unmarshal(raw, &chain) == nil {
				safe := map[string]any{}
				for _, key := range []string{"family", "table", "name", "type", "hook", "policy"} {
					if val, ok := chain[key]; ok {
						safe[key] = val
					}
				}
				chains = append(chains, safe)
			}
		}
	}
	return map[string]any{"chains": chains, "rule_count": rules}, nil
}
func (s discoverySource) cronSummary() ([]map[string]any, error) {
	names := []string{"/etc/crontab"}
	entries, dirErr := os.ReadDir(filepath.Join(s.root, "etc/cron.d"))
	if dirErr == nil {
		for _, entry := range entries {
			if !entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
				names = append(names, "/etc/cron.d/"+entry.Name())
			}
			if len(names) >= 64 {
				break
			}
		}
	}
	out := []map[string]any{}
	var firstErr error
	for _, name := range names {
		data, err := s.read(name)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		schedules := []string{}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) >= 2 && map[string]bool{"@reboot": true, "@yearly": true, "@annually": true, "@monthly": true, "@weekly": true, "@daily": true, "@midnight": true, "@hourly": true}[fields[0]] {
				schedules = append(schedules, fields[0])
			} else if len(fields) >= 7 && validDiscoveryCronSchedule(fields[:5]) {
				schedules = append(schedules, strings.Join(fields[:5], " "))
			}
		}
		out = append(out, map[string]any{"file": name, "schedules": schedules, "commands_omitted": true})
	}
	if len(out) == 0 {
		return out, firstErr
	}
	return out, nil
}

var discoveryTransport = &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
	return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", "/var/run/docker.sock")
}, DisableKeepAlives: true}

func applyDiscoveryEnv() {
	for _, entry := range []struct {
		flag, env string
		target    *bool
	}{{"discovery", "CF_MONITOR_DISCOVERY", &discoveryEnabled}, {"discovery-docker", "CF_MONITOR_DISCOVERY_DOCKER", &discoveryDocker}, {"discovery-smart", "CF_MONITOR_DISCOVERY_SMART", &discoverySmart}} {
		if !flagWasSet(entry.flag) {
			if value := os.Getenv(entry.env); value != "" {
				parsed, err := strconv.ParseBool(value)
				if err != nil {
					log.Fatalf("invalid %s", entry.env)
				}
				*entry.target = parsed
			}
		}
	}
	if !flagWasSet("discovery-interval") {
		if value := os.Getenv("CF_MONITOR_DISCOVERY_INTERVAL"); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil {
				log.Fatal("invalid CF_MONITOR_DISCOVERY_INTERVAL")
			}
			discoveryInterval = parsed
		}
	}
	if discoveryInterval < 300 {
		discoveryInterval = 300
	}
}
func runDiscoveryReporter(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(discoveryInterval) * time.Second)
	defer ticker.Stop()
	for {
		collectionCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		snapshot := newDiscoverySource().collect(collectionCtx)
		cancel()
		sendCtx, sendCancel := context.WithTimeout(ctx, 20*time.Second)
		payload, err := json.Marshal(snapshot)
		if err == nil && len(payload) <= 512<<10 {
			request, buildErr := http.NewRequestWithContext(sendCtx, http.MethodPost, serverURL+"/api/clients/discovery", bytes.NewReader(payload))
			err = buildErr
			if err == nil {
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("Authorization", "Bearer "+token)
				client := http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
				response, sendErr := client.Do(request)
				err = sendErr
				if response != nil {
					response.Body.Close()
					if response.StatusCode < 200 || response.StatusCode >= 300 {
						err = fmt.Errorf("HTTP %d", response.StatusCode)
					}
				}
			}
		} else if err == nil {
			err = errors.New("sanitized snapshot exceeds upload limit")
		}
		sendCancel()
		if err != nil {
			log.Printf("read-only discovery delivery failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func validDiscoveryCronSchedule(fields []string) bool {
	pattern := regexp.MustCompile(`^[0-9*/,\-]+$`)
	for _, field := range fields {
		if !pattern.MatchString(field) {
			return false
		}
	}
	return true
}

func mergeDiscoveryAssets(assets []DiscoveryAsset) []DiscoveryAsset {
	result := make([]DiscoveryAsset, 0, len(assets))
	indices := map[string]int{}
	for _, asset := range assets {
		if index, exists := indices[asset.ExternalID]; exists {
			for key, value := range asset.Metadata {
				if _, found := result[index].Metadata[key]; !found {
					result[index].Metadata[key] = value
				}
			}
			for _, relation := range asset.Relations {
				found := false
				for _, existing := range result[index].Relations {
					if existing == relation {
						found = true
						break
					}
				}
				if !found {
					result[index].Relations = append(result[index].Relations, relation)
				}
			}
		} else {
			indices[asset.ExternalID] = len(result)
			result = append(result, asset)
		}
	}
	return result
}

// Match the server's bounded envelope. An unusually large local installation
// remains useful partial evidence instead of causing the entire report to fail.
func boundDiscoverySnapshot(out *DiscoverySnapshot) {
	limited := false
	for i := range out.Assets {
		asset := &out.Assets[i]
		asset.Name = boundedDiscoveryText(asset.Name, 200)
		if asset.Name == "" {
			asset.Name = asset.ExternalID
		}
		if len(asset.Relations) > 30 {
			asset.Relations = asset.Relations[:30]
			limited = true
		}
		encoded, err := json.Marshal(asset.Metadata)
		if err != nil || len(encoded) > 32768 {
			asset.Metadata = map[string]any{"collection_status": "partial", "reason": "metadata_size_limit"}
			limited = true
		}
	}
	for {
		encoded, err := json.Marshal(out.Configuration)
		if err == nil && len(encoded) <= 131072 {
			break
		}
		largestKey, largestSize := "", 0
		for key, value := range out.Configuration {
			if value.Value == nil {
				continue
			}
			data, marshalErr := json.Marshal(value.Value)
			if marshalErr != nil {
				largestKey = key
				break
			}
			if len(data) > largestSize {
				largestKey, largestSize = key, len(data)
			}
		}
		if largestKey == "" {
			break
		}
		value := out.Configuration[largestKey]
		value.Status, value.Confidence, value.Reason = "partial", "unknown", "configuration_size_limit"
		value.Value = nil
		out.Configuration[largestKey] = value
		limited = true
	}
	envelope := *out
	envelope.Assets = []DiscoveryAsset{}
	base, _ := json.Marshal(envelope)
	remaining := (512 << 10) - len(base) - 256 // Reserve the partial-collection marker.
	for index := range out.Assets {
		asset := &out.Assets[index]
		encoded, _ := json.Marshal(asset)
		if len(encoded)+1 > remaining {
			asset.Metadata = map[string]any{"collection_status": "partial", "reason": "snapshot_size_limit"}
			encoded, _ = json.Marshal(asset)
			limited = true
		}
		if len(encoded)+1 > remaining {
			out.Assets = out.Assets[:index]
			break
		}
		remaining -= len(encoded) + 1
	}
	if limited {
		out.Complete = false
		out.Collectors = append(out.Collectors, DiscoveryCollector{"projection_limits", "partial", "bounded_server_envelope"})
	}
}

func boundedDiscoveryText(value string, limit int) string {
	value = strings.ToValidUTF8(value, "")
	if len(value) <= limit {
		return value
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}
