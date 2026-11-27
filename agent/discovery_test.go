package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/shirou/gopsutil/v3/disk"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDiscoveryContainerIdentitySurvivesRecreationAndProjectsSecrets(t *testing.T) {
	raw := `{"Id":"0123456789ab","Names":["/web"],"Image":"nginx:1.27","Status":"Up 2 hours (healthy)","State":"running","Labels":{"com.docker.compose.project":"home","com.docker.compose.service":"web","com.docker.compose.container-number":"1","PASSWORD":"do-not-upload-this","traefik.http.middlewares.auth.basicauth.users":"alice:credential"},"Env":["API_TOKEN=do-not-upload-this"]}`
	var container dockerContainerSummary
	if err := json.Unmarshal([]byte(raw), &container); err != nil {
		t.Fatal(err)
	}
	a := containerAsset(container, "2026-01-01T00:00:00Z")
	container.ID = "fedcba098765"
	container.Names = []string{"/renamed"}
	b := containerAsset(container, "2026-01-01T00:00:00Z")
	if a.ExternalID != b.ExternalID {
		t.Fatal("compose recreation must retain stable identity")
	}
	body, _ := json.Marshal(a)
	for _, secret := range []string{"do-not-upload-this", "PASSWORD", "API_TOKEN", "basicauth", "credential"} {
		if strings.Contains(string(body), secret) {
			t.Fatalf("projection leaked %s", secret)
		}
	}
	if a.Metadata["health"] != "healthy" {
		t.Fatal("health vocabulary not projected")
	}
}
func TestDiscoveryDockerUsesFixedReadOnlyPathAllowlist(t *testing.T) {
	for _, path := range []string{"/containers/0123456789ab/exec", "/containers/0123456789ab/logs", "/images/json", "http://127.0.0.1/admin", "/containers/../../secrets/json"} {
		if err := dockerDiscoveryGet(context.Background(), path, &struct{}{}); err == nil || err.Error() != "unsupported_docker_read" {
			t.Fatalf("unexpected allowed path %s: %v", path, err)
		}
	}
	if _, err := discoveryCommand(context.Background(), "sh", "-c", "echo no"); err == nil {
		t.Fatal("shell command accepted")
	}
}
func TestDiscoveryPermissionFailureNeverClaimsCompleteInventory(t *testing.T) {
	old := dockerRead
	defer func() { dockerRead = old }()
	dockerRead = func(context.Context, string, any) error { return os.ErrPermission }
	out := DiscoverySnapshot{Complete: true, CollectedAt: "2026-01-01T00:00:00Z", Configuration: map[string]DiscoveryValue{}}
	discoverySource{platform: "linux"}.collectDocker(context.Background(), &out)
	if out.Complete || out.Configuration["docker"].Status != "permission_denied" || len(out.Assets) != 0 {
		t.Fatalf("permission failure became data: %+v", out)
	}
}
func TestDiscoverySummariesNeverIncludeCronCommandsOrFirewallRules(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "etc/cron.d"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "etc/crontab"), []byte("SECRET=do-not-upload\n0 2 * * * root curl -H Authorization:secret https://example.com\n@reboot root echo secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	entries, err := (discoverySource{root: dir}).cronSummary()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(entries)
	if strings.Contains(string(body), "secret") || strings.Contains(string(body), "curl") || strings.Contains(string(body), "Authorization") {
		t.Fatal("cron command leaked")
	}
	firewall, err := parseFirewallSummary([]byte(`{"nftables":[{"chain":{"family":"inet","name":"input","policy":"drop","comment":"password"}},{"rule":{"expr":[{"secret":"token"}]}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	body, _ = json.Marshal(firewall)
	if strings.Contains(string(body), "token") || strings.Contains(string(body), "password") {
		t.Fatal("raw firewall data leaked")
	}
	if firewall["rule_count"] != 1 {
		t.Fatal("rule count lost")
	}
}
func TestDiscoveryMissingContainerCountersStayUnknown(t *testing.T) {
	body, _ := json.Marshal(projectContainerStats(dockerContainerStats{}))
	var result map[string]any
	_ = json.Unmarshal(body, &result)
	for _, key := range []string{"cpu_percent", "memory_bytes", "memory_limit_bytes", "network_rx_bytes", "disk_read_bytes"} {
		if result[key] != nil {
			t.Fatalf("%s falsely reported as zero: %v", key, result[key])
		}
	}
	var stats dockerContainerStats
	if err := json.Unmarshal([]byte(`{"memory_stats":{"usage":1024,"limit":2048,"stats":{"inactive_file":256}},"networks":{"eth0":{"rx_bytes":10,"tx_bytes":20}},"cpu_stats":{"cpu_usage":{"total_usage":50},"system_cpu_usage":100,"online_cpus":2},"precpu_stats":{"cpu_usage":{"total_usage":25},"system_cpu_usage":50}}`), &stats); err != nil {
		t.Fatal(err)
	}
	body, _ = json.Marshal(projectContainerStats(stats))
	_ = json.Unmarshal(body, &result)
	if result["memory_bytes"] != float64(768) || result["cpu_percent"] != float64(100) || result["network_tx_bytes"] != float64(20) {
		t.Fatalf("incorrect projected counters: %s", body)
	}
}
func TestDiscoveryReadLimitDoesNotReadUnboundedFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "large"), []byte(strings.Repeat("x", discoveryReadLimit+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := (discoverySource{root: dir}).read("/large"); err == nil {
		t.Fatal("unbounded read accepted")
	}
	if status, _ := discoveryErrorStatus(errors.New("raw-secret-error")); status != "error" {
		t.Fatal(status)
	}
}
func TestExtendedWebsiteChecksEnforceContentAndMeasureCertificate(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"ready":true}}`))
	}))
	defer server.Close()
	task := WebsiteProbeTask{ID: 1, ConfigRevision: "rev", URL: server.URL, Method: "GET", TimeoutSec: 2, ExpectedStatusMin: 200, ExpectedStatusMax: 299, CheckConfig: WebsiteCheckConfig{JSONPath: "data.ready", JSONEquals: json.RawMessage(`false`), TLSWarningDays: 90}}
	result := executeWebsiteHTTPProbeWithClient(task, server.Client())
	if result.OK || result.EffectiveReason != "json_content_mismatch" {
		t.Fatalf("content mismatch succeeded: %+v", result)
	}
	if result.Details == nil || result.Details.TLSExpiresAt == nil || result.Details.TLSDaysRemaining == nil || !result.Details.ContentChecked {
		t.Fatalf("TLS evidence missing: %+v", result.Details)
	}
	task.CheckConfig.JSONEquals = json.RawMessage(`true`)
	if result = executeWebsiteHTTPProbeWithClient(task, server.Client()); !result.OK {
		t.Fatal(result.EffectiveReason)
	}
}
func TestExtendedWebsiteChecksBlockPrivateTargetsAndUnsafeJSON(t *testing.T) {
	if reason := websiteContentFailure([]byte(`{"__proto__":{"x":1}}`), WebsiteCheckConfig{JSONPath: "__proto__.x", JSONEquals: json.RawMessage(`1`)}); reason != "invalid_json_path" {
		t.Fatal(reason)
	}
	if reason := websiteContentFailure([]byte(`{"items":[1,2]}`), WebsiteCheckConfig{JSONPath: "items.01", JSONEquals: json.RawMessage(`2`)}); reason != "json_path_missing" {
		t.Fatal("array indices must use the same canonical form as Worker checks")
	}
	for _, kind := range []string{"dns", "websocket"} {
		result := executeWebsiteProbeWithContext(context.Background(), WebsiteProbeTask{URL: "https://127.0.0.1", CheckConfig: WebsiteCheckConfig{Kind: kind}})
		if result.OK || result.EffectiveReason != "unsafe_host" {
			t.Fatalf("private %s probe allowed: %+v", kind, result)
		}
	}
	config := WebsiteCheckConfig{Maintenance: []WebsiteMaintenanceWindow{{"2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"}}}
	if !websiteMaintenanceActive(config, time.Date(2026, 1, 1, 0, 30, 0, 0, time.UTC)) || websiteMaintenanceActive(config, time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC)) {
		t.Fatal("maintenance interval boundaries incorrect")
	}
}

func TestDiscoveryIOPSUseObservedDeltasAndKeepResetsUnknown(t *testing.T) {
	state := discoveryIOState{}
	first := map[string]disk.IOCountersStat{"sda": {ReadCount: 10, WriteCount: 20, ReadBytes: 100, WriteBytes: 200}}
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if state.observe(first, at)["sda"].(map[string]any)["read_iops"] != nil {
		t.Fatal("first sample must not invent a rate")
	}
	second := map[string]disk.IOCountersStat{"sda": {ReadCount: 30, WriteCount: 60, ReadBytes: 500, WriteBytes: 1000}}
	result := state.observe(second, at.Add(10*time.Second))["sda"].(map[string]any)
	if result["read_iops"] != float64(2) || result["write_iops"] != float64(4) || result["read_bytes_per_sec"] != float64(40) {
		t.Fatalf("incorrect measured rates: %+v", result)
	}
	if state.observe(first, at.Add(20*time.Second))["sda"].(map[string]any)["read_iops"] != nil {
		t.Fatal("device counter reset must remain unknown")
	}
}

func TestDiscoveryProxyProjectionKeepsDomainsButNoCredentialsOrCommands(t *testing.T) {
	nginx := `# server_name secret.example.net;
server_name example.com www.example.com *.sub.example.com;
proxy_set_header Authorization "Bearer SECRET";
ssl_certificate_key /private/key.pem;
server_name $dynamic ~^regex.example.org;
`
	got := configuredDomains(nginx, "nginx")
	if strings.Join(got, ",") != "example.com,sub.example.com,www.example.com" {
		t.Fatalf("wrong literal domains: %v", got)
	}
	caddy := `{
 email administrator@example.com
}
example.com, www.example.com {
 reverse_proxy localhost:3000
 header Authorization SECRET
}
{$PRIVATE_DOMAIN} {
 respond secret
}`
	if got := configuredDomains(caddy, "caddy"); strings.Join(got, ",") != "example.com,www.example.com" {
		t.Fatalf("wrong Caddy domains: %v", got)
	}
	a := DiscoveryAsset{ExternalID: "a", Metadata: map[string]any{"first": true}, Relations: []DiscoveryRelation{{"proxy", "routes_to"}}}
	b := DiscoveryAsset{ExternalID: "a", Metadata: map[string]any{"second": true}, Relations: []DiscoveryRelation{{"proxy", "routes_to"}, {"container", "routes_to"}}}
	merged := mergeDiscoveryAssets([]DiscoveryAsset{a, b})
	if len(merged) != 1 || len(merged[0].Relations) != 2 || merged[0].Metadata["second"] != true {
		t.Fatal("domain discovery duplicated identities or lost evidence")
	}
}

func TestDiscoveryDockerVersionNegotiationSupportsOldAndNewDaemons(t *testing.T) {
	for _, item := range []struct{ maximum, minimum, expected string }{{"1.57", "1.40", "1.45"}, {"1.52", "1.44", "1.45"}, {"1.41", "1.12", "1.41"}} {
		got, err := negotiateDockerDiscoveryVersion(item.maximum, item.minimum)
		if err != nil || got != item.expected {
			t.Fatalf("%+v: %s %v", item, got, err)
		}
	}
	for _, item := range []struct{ maximum, minimum string }{{"1.40", "1.12"}, {"1.60", "1.50"}, {"../../exec", "1.40"}} {
		if _, err := negotiateDockerDiscoveryVersion(item.maximum, item.minimum); err == nil {
			t.Fatal("unsupported or unsafe API accepted")
		}
	}
}

func TestDiscoveryBoundsPreserveIdentityAndUnknownInsteadOfRejectingReport(t *testing.T) {
	out := DiscoverySnapshot{Complete: true, Configuration: map[string]DiscoveryValue{
		"cron": {Status: "available", Value: strings.Repeat("x", 140000), Confidence: "observed"},
		"ssh":  {Status: "available", Value: map[string]string{"permitrootlogin": "no"}, Confidence: "observed"},
	}, Assets: []DiscoveryAsset{{ExternalID: "stable", Name: strings.Repeat("中文", 200), Metadata: map[string]any{"oversized": strings.Repeat("x", 33000)}}}}
	boundDiscoverySnapshot(&out)
	if out.Complete || out.Assets[0].ExternalID != "stable" || len(out.Assets[0].Name) > 200 || out.Configuration["cron"].Value != nil || out.Configuration["cron"].Confidence != "unknown" || out.Configuration["ssh"].Value == nil {
		t.Fatalf("large discovery report was not safely bounded: %+v", out)
	}
	if out.Assets[0].Metadata["collection_status"] != "partial" {
		t.Fatal("oversized metadata must have an explicit partial state")
	}
	large := DiscoverySnapshot{Complete: true, Configuration: map[string]DiscoveryValue{}}
	for index := 0; index < discoveryMaxAssets; index++ {
		large.Assets = append(large.Assets, DiscoveryAsset{ExternalID: fmt.Sprintf("asset-%d", index), Name: "bounded", Metadata: map[string]any{"observation": strings.Repeat("x", 8000)}})
	}
	boundDiscoverySnapshot(&large)
	encoded, err := json.Marshal(large)
	if err != nil || len(encoded) > 512<<10 || large.Complete || len(large.Assets) == 0 {
		t.Fatal("the entire discovery envelope must fit the authenticated route limit")
	}
}

func TestDiscoveryContainerSamplingRotatesAndUsesOnlyObservedCPUDeltas(t *testing.T) {
	state := dockerSampleState{}
	containers := []dockerContainerSummary{}
	for index := 0; index < 12; index++ {
		containers = append(containers, dockerContainerSummary{ID: fmt.Sprintf("%012x", index), State: "running"})
	}
	first := state.selectTargets(containers)
	second := state.selectTargets(containers)
	if len(first) != 10 || len(second) != 10 || !second[containers[10].ID] || !second[containers[11].ID] {
		t.Fatal("bounded resource sampling must not starve later containers")
	}
	var stats dockerContainerStats
	stats.Read = "2026-01-01T00:00:00Z"
	stats.CPU.CPUUsage.TotalUsage, stats.CPU.SystemCPUUsage, stats.CPU.OnlineCPUs = 10, 100, 2
	if value, _ := state.observe("one", stats)["cpu_percent"].(*float64); value != nil {
		t.Fatal("initial resource sample invented CPU utilization")
	}
	stats.Read = "2026-01-01T00:30:00Z"
	stats.CPU.CPUUsage.TotalUsage, stats.CPU.SystemCPUUsage = 35, 200
	observed := state.observe("one", stats)
	if *observed["cpu_percent"].(*float64) != 50 || *observed["cpu_sample_interval_sec"].(*float64) != 1800 {
		t.Fatalf("CPU ratio or actual sample interval incorrect: %+v", observed)
	}
	if value, _ := state.observe("recreated-container", stats)["cpu_percent"].(*float64); value != nil {
		t.Fatal("new runtime identity reused old container CPU counters")
	}
}
