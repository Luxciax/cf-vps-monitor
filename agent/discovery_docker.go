package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type dockerContainerSummary struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	ImageID string            `json:"ImageID"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Labels  map[string]string `json:"Labels"`
	Ports   []struct {
		IP          string `json:"IP"`
		PrivatePort uint16 `json:"PrivatePort"`
		PublicPort  uint16 `json:"PublicPort"`
		Type        string `json:"Type"`
	} `json:"Ports"`
	NetworkSettings struct {
		Networks map[string]json.RawMessage `json:"Networks"`
	} `json:"NetworkSettings"`
}

var dockerReadPath = regexp.MustCompile(`^/containers/[a-f0-9]{12,64}/(json|stats\?stream=false&one-shot=true)$`)

// No Docker API path or method comes from the server. All output is projected.
func dockerDiscoveryGet(ctx context.Context, path string, target any) error {
	if path != "/version" && path != "/containers/json?all=1" && !dockerReadPath.MatchString(path) {
		return errors.New("unsupported_docker_read")
	}
	prefix := ""
	if path != "/version" {
		version, ok := ctx.Value(dockerAPIVersionKey{}).(string)
		if !ok || !regexp.MustCompile(`^1\.[0-9]{2}$`).MatchString(version) {
			return errors.New("docker_api_version_not_negotiated")
		}
		prefix = "/v" + version
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+prefix+path, nil)
	if err != nil {
		return err
	}
	client := http.Client{Transport: discoveryTransport, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusForbidden {
		return os.ErrPermission
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("docker_http_%d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil {
		return err
	}
	if len(data) > 2<<20 {
		return errors.New("collection_limit")
	}
	return json.Unmarshal(data, target)
}

var dockerRead = dockerDiscoveryGet
var discoveryHostPattern = regexp.MustCompile("(?i)Host(?:SNI)?\\(`([^`]+)`\\)")
var discoveryDomainPattern = regexp.MustCompile(`(?i)^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

func dockerStableIdentity(container dockerContainerSummary) string {
	project, service := container.Labels["com.docker.compose.project"], container.Labels["com.docker.compose.service"]
	if project != "" && service != "" {
		replica := container.Labels["com.docker.compose.container-number"]
		if replica == "" {
			replica = "1"
		}
		if strings.EqualFold(container.Labels["com.docker.compose.oneoff"], "true") {
			if len(container.Names) > 0 {
				replica = "oneoff/" + strings.TrimPrefix(container.Names[0], "/")
			} else {
				replica = "oneoff/" + container.ID
			}
		}
		return project + "/" + service + "/" + replica
	}
	if len(container.Names) > 0 {
		return strings.TrimPrefix(container.Names[0], "/")
	}
	return container.ID
}
func containerAsset(container dockerContainerSummary, at string) DiscoveryAsset {
	name := dockerStableIdentity(container)
	metadata := map[string]any{"container_id": container.ID, "image": container.Image, "image_id": container.ImageID, "state": container.State, "health": "unknown"}
	if strings.Contains(container.Status, "(healthy)") {
		metadata["health"] = "healthy"
	} else if strings.Contains(container.Status, "(unhealthy)") {
		metadata["health"] = "unhealthy"
	} else if strings.Contains(container.Status, "health: starting") {
		metadata["health"] = "starting"
	}
	networks := []string{}
	for network := range container.NetworkSettings.Networks {
		if len(network) <= 128 {
			networks = append(networks, network)
		}
	}
	sort.Strings(networks)
	metadata["networks"] = networks
	ports := []map[string]any{}
	for _, port := range container.Ports {
		ports = append(ports, map[string]any{"address": port.IP, "private_port": port.PrivatePort, "public_port": port.PublicPort, "protocol": port.Type})
	}
	metadata["ports"] = ports
	asset := DiscoveryAsset{ExternalID: stableDiscoveryID("container", name), Kind: "container", Name: name, Metadata: metadata, Evidence: DiscoveryEvidence{"local Docker API projection", at, "observed"}, Relations: []DiscoveryRelation{{"host", "runs_on"}}}
	if project := container.Labels["com.docker.compose.project"]; project != "" {
		asset.Relations = append(asset.Relations, DiscoveryRelation{stableDiscoveryID("compose", project), "part_of"})
		metadata["compose_project"] = project
		metadata["compose_service"] = container.Labels["com.docker.compose.service"]
	}
	return asset
}
func (s discoverySource) collectDocker(ctx context.Context, out *DiscoverySnapshot) {
	at := out.CollectedAt
	var version struct {
		APIVersion        string `json:"ApiVersion"`
		MinimumAPIVersion string `json:"MinAPIVersion"`
		Version           string `json:"Version"`
	}
	err := dockerRead(ctx, "/version", &version)
	if err == nil {
		var negotiated string
		negotiated, err = negotiateDockerDiscoveryVersion(version.APIVersion, version.MinimumAPIVersion)
		if err == nil {
			ctx = context.WithValue(ctx, dockerAPIVersionKey{}, negotiated)
		}
	}
	var containers []dockerContainerSummary
	if err == nil {
		err = dockerRead(ctx, "/containers/json?all=1", &containers)
	}
	if err != nil {
		status, reason := discoveryErrorStatus(err)
		out.Complete = false
		out.Collectors = append(out.Collectors, DiscoveryCollector{"docker", status, reason})
		out.Configuration["docker"] = DiscoveryValue{Status: status, Value: nil, Source: "local Docker API", CollectedAt: at, Confidence: "unknown", Environment: s.platform, Reason: reason}
		return
	}
	out.Collectors = append(out.Collectors, DiscoveryCollector{"docker", "available", ""})
	out.Configuration["docker"] = DiscoveryValue{Status: "available", Value: map[string]any{"containers": len(containers), "engine_version": safeVersion(version.Version), "api_version": ctx.Value(dockerAPIVersionKey{}), "socket_local_only": true, "api_calls": "fixed GET only; local socket capability remains privileged"}, Source: "local Docker API", CollectedAt: at, Confidence: "observed", Environment: s.platform}
	sort.Slice(containers, func(i, j int) bool { return dockerStableIdentity(containers[i]) < dockerStableIdentity(containers[j]) })
	resourceTargets := discoveryContainerSamples.selectTargets(containers)
	projects := map[string]bool{}
	domains := map[string]bool{}
	detailFailures := 0
	for i, container := range containers {
		if i >= 50 || len(out.Assets) >= discoveryMaxAssets-5 {
			out.Complete = false
			out.Collectors = append(out.Collectors, DiscoveryCollector{"docker", "partial", "collection_limit"})
			break
		}
		asset := containerAsset(container, at)
		var detail struct {
			RestartCount int `json:"RestartCount"`
			Mounts       []struct {
				Source      string `json:"Source"`
				Destination string `json:"Destination"`
				Type        string `json:"Type"`
			} `json:"Mounts"`
		}
		if err := dockerRead(ctx, "/containers/"+container.ID+"/json", &detail); err == nil {
			asset.Metadata["restart_count"] = detail.RestartCount
			mounts := []map[string]string{}
			for _, m := range detail.Mounts {
				mounts = append(mounts, map[string]string{"source": m.Source, "destination": m.Destination, "type": m.Type})
				if len(mounts) >= 30 {
					break
				}
			}
			asset.Metadata["data_directories"] = mounts
		} else {
			asset.Metadata["restart_count"] = nil
			asset.Metadata["details_status"] = "unknown"
			detailFailures++
		}
		asset.Metadata["resources_status"] = "unknown"
		asset.Metadata["resources_reason"] = "not_sampled_this_run"
		if container.State != "running" {
			asset.Metadata["resources_reason"] = "container_not_running"
		}
		if resourceTargets[container.ID] {
			var stats dockerContainerStats
			if err := dockerRead(ctx, "/containers/"+container.ID+"/stats?stream=false&one-shot=true", &stats); err == nil {
				asset.Metadata["resources"] = discoveryContainerSamples.observe(container.ID, stats)
				asset.Metadata["resources_status"] = "observed"
				delete(asset.Metadata, "resources_reason")
			} else {
				_, reason := discoveryErrorStatus(err)
				asset.Metadata["resources_reason"] = reason
			}
		}
		if project := container.Labels["com.docker.compose.project"]; project != "" && !projects[project] {
			projects[project] = true
			meta := map[string]any{}
			for label, key := range map[string]string{"com.docker.compose.project.working_dir": "deployment_directory", "com.docker.compose.project.config_files": "configuration_paths", "com.docker.compose.version": "compose_version"} {
				if value := container.Labels[label]; len(value) <= 1024 && value != "" {
					meta[key] = value
				}
			}
			out.Assets = append(out.Assets, DiscoveryAsset{ExternalID: stableDiscoveryID("compose", project), Kind: "compose", Name: project, Metadata: meta, Evidence: DiscoveryEvidence{"Docker Compose allowlisted labels", at, "observed"}, Relations: []DiscoveryRelation{{"host", "runs_on"}}})
		}
		image := strings.ToLower(container.Image)
		for _, proxy := range []string{"nginx-proxy-manager", "caddy", "nginx", "traefik"} {
			if strings.Contains(image, proxy) {
				out.Assets = append(out.Assets, DiscoveryAsset{ExternalID: stableDiscoveryID("reverse_proxy", dockerStableIdentity(container)), Kind: "reverse_proxy", Name: proxy + " / " + asset.Name, Metadata: map[string]any{"runtime": proxy, "image": container.Image, "routes_status": "only_observed_labels; configuration_not_uploaded"}, Evidence: DiscoveryEvidence{"container image identity", at, "inferred"}, Relations: []DiscoveryRelation{{asset.ExternalID, "runs_on"}}})
				break
			}
		}
		for key, value := range container.Labels {
			if !strings.HasPrefix(key, "traefik.http.routers.") || !strings.HasSuffix(key, ".rule") {
				continue
			}
			for _, match := range discoveryHostPattern.FindAllStringSubmatch(value, 20) {
				domain := strings.ToLower(match[1])
				if !discoveryDomainPattern.MatchString(domain) {
					continue
				}
				id := stableDiscoveryID("domain", domain)
				asset.Relations = append(asset.Relations, DiscoveryRelation{id, "exposes"})
				if !domains[domain] {
					domains[domain] = true
					out.Assets = append(out.Assets, DiscoveryAsset{ExternalID: id, Kind: "domain", Name: domain, Metadata: map[string]any{"domain": domain, "route_evidence": "Traefik Host label; not DNS verification"}, Evidence: DiscoveryEvidence{"Docker allowlisted Traefik Host label", at, "observed"}, Relations: []DiscoveryRelation{{asset.ExternalID, "routes_to"}}})
				}
			}
		}
		out.Assets = append(out.Assets, asset)
	}
	if detailFailures > 0 {
		out.Complete = false
		out.Collectors = append(out.Collectors, DiscoveryCollector{"docker_details", "partial", "container_metadata_unavailable"})
	}
}

type dockerCPUStats struct {
	CPUUsage struct {
		TotalUsage  uint64   `json:"total_usage"`
		PerCPUUsage []uint64 `json:"percpu_usage"`
	} `json:"cpu_usage"`
	SystemCPUUsage uint64 `json:"system_cpu_usage"`
	OnlineCPUs     uint64 `json:"online_cpus"`
}
type dockerContainerStats struct {
	Read         string         `json:"read"`
	PreviousRead string         `json:"preread"`
	CPU          dockerCPUStats `json:"cpu_stats"`
	PreviousCPU  dockerCPUStats `json:"precpu_stats"`
	Memory       struct {
		Usage *uint64           `json:"usage"`
		Limit *uint64           `json:"limit"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RxBytes uint64 `json:"rx_bytes"`
		TxBytes uint64 `json:"tx_bytes"`
	} `json:"networks"`
	BlockIO struct {
		Entries []struct {
			Op    string `json:"op"`
			Value uint64 `json:"value"`
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
}

func projectContainerStats(stats dockerContainerStats) map[string]any {
	var cpuPercent *float64
	var cpuInterval *float64
	if stats.CPU.CPUUsage.TotalUsage >= stats.PreviousCPU.CPUUsage.TotalUsage && stats.PreviousCPU.SystemCPUUsage > 0 && stats.CPU.SystemCPUUsage > stats.PreviousCPU.SystemCPUUsage {
		cpus := stats.CPU.OnlineCPUs
		if cpus == 0 {
			cpus = uint64(len(stats.CPU.CPUUsage.PerCPUUsage))
		}
		if cpus > 0 {
			value := float64(stats.CPU.CPUUsage.TotalUsage-stats.PreviousCPU.CPUUsage.TotalUsage) / float64(stats.CPU.SystemCPUUsage-stats.PreviousCPU.SystemCPUUsage) * float64(cpus) * 100
			cpuPercent = &value
			currentRead, currentErr := time.Parse(time.RFC3339Nano, stats.Read)
			previousRead, previousErr := time.Parse(time.RFC3339Nano, stats.PreviousRead)
			if currentErr == nil && previousErr == nil && currentRead.After(previousRead) {
				elapsed := currentRead.Sub(previousRead).Seconds()
				cpuInterval = &elapsed
			}
		}
	}
	var memory *uint64
	if stats.Memory.Usage != nil {
		value := *stats.Memory.Usage
		cache := stats.Memory.Stats["inactive_file"]
		if inactive, ok := stats.Memory.Stats["total_inactive_file"]; ok {
			cache = inactive
		}
		if cache <= value {
			value -= cache
		}
		memory = &value
	}
	var rx, tx, read, write *uint64
	if stats.Networks != nil {
		r, t := uint64(0), uint64(0)
		for _, network := range stats.Networks {
			r += network.RxBytes
			t += network.TxBytes
		}
		rx, tx = &r, &t
	}
	if stats.BlockIO.Entries != nil {
		r, w := uint64(0), uint64(0)
		for _, entry := range stats.BlockIO.Entries {
			if strings.EqualFold(entry.Op, "read") {
				r += entry.Value
			}
			if strings.EqualFold(entry.Op, "write") {
				w += entry.Value
			}
		}
		read, write = &r, &w
	}
	return map[string]any{"sampled_at": stats.Read, "cpu_percent": cpuPercent, "cpu_sample_interval_sec": cpuInterval, "memory_bytes": memory, "memory_limit_bytes": stats.Memory.Limit, "network_rx_bytes": rx, "network_tx_bytes": tx, "disk_read_bytes": read, "disk_write_bytes": write, "counter_semantics": "cumulative; CPU is an average between real kernel samples and unavailable before two samples"}
}

type dockerSampleState struct {
	sync.Mutex
	next     int
	previous map[string]dockerContainerStats
}

var discoveryContainerSamples dockerSampleState

func (state *dockerSampleState) selectTargets(containers []dockerContainerSummary) map[string]bool {
	state.Lock()
	defer state.Unlock()
	if state.previous == nil {
		state.previous = map[string]dockerContainerStats{}
	}
	ids := []string{}
	live := map[string]bool{}
	for index, container := range containers {
		if index >= 50 {
			break
		}
		if container.State == "running" {
			ids = append(ids, container.ID)
			live[container.ID] = true
		}
	}
	for id := range state.previous {
		if !live[id] {
			delete(state.previous, id)
		}
	}
	selected := map[string]bool{}
	if len(ids) == 0 {
		return selected
	}
	count := min(10, len(ids))
	for index := 0; index < count; index++ {
		selected[ids[(state.next+index)%len(ids)]] = true
	}
	state.next = (state.next + count) % len(ids)
	return selected
}

func (state *dockerSampleState) observe(id string, stats dockerContainerStats) map[string]any {
	state.Lock()
	defer state.Unlock()
	if state.previous == nil {
		state.previous = map[string]dockerContainerStats{}
	}
	previous := state.previous[id]
	state.previous[id] = dockerContainerStats{Read: stats.Read, CPU: stats.CPU}
	if stats.PreviousCPU.SystemCPUUsage == 0 && previous.CPU.SystemCPUUsage > 0 {
		stats.PreviousCPU, stats.PreviousRead = previous.CPU, previous.Read
	}
	return projectContainerStats(stats)
}
func (s discoverySource) collectSMART(ctx context.Context, out *DiscoverySnapshot) {
	at := out.CollectedAt
	if nodeMetrics.containerized() {
		out.Configuration["smart"] = DiscoveryValue{Status: "unknown", Value: nil, Source: "smartctl", CollectedAt: at, Confidence: "unknown", Environment: s.platform, Reason: "container_scope_unverified"}
		return
	}
	entries, err := os.ReadDir(filepath.Join(s.root, "sys/block"))
	if err != nil {
		status, reason := discoveryErrorStatus(err)
		out.Configuration["smart"] = DiscoveryValue{Status: status, Value: nil, Source: "smartctl", CollectedAt: at, Confidence: "unknown", Environment: s.platform, Reason: reason}
		return
	}
	devices := []map[string]any{}
	allowed := regexp.MustCompile(`^(sd[a-z]+|nvme[0-9]+n[0-9]+|hd[a-z]+)$`)
	for _, entry := range entries {
		if !allowed.MatchString(entry.Name()) {
			continue
		}
		data, err := s.command(ctx, "smartctl", "--json=c", "--health", "/dev/"+entry.Name())
		var result struct {
			SmartStatus *struct {
				Passed bool `json:"passed"`
			} `json:"smart_status"`
		}
		status, reason := "available", ""
		var passed *bool
		if json.Unmarshal(data, &result) == nil && result.SmartStatus != nil {
			passed = &result.SmartStatus.Passed
		} else {
			status, reason = discoveryErrorStatus(err)
		}
		devices = append(devices, map[string]any{"device": "/dev/" + entry.Name(), "status": status, "passed": passed, "reason": reason})
		if len(devices) >= 8 {
			break
		}
	}
	status, reason := "available", ""
	if len(devices) == 0 {
		status = "unknown"
		reason = "no_supported_physical_disks"
	}
	out.Configuration["smart"] = DiscoveryValue{Status: status, Value: devices, Source: "smartctl --health (no tests or settings)", CollectedAt: at, Confidence: "observed", Environment: s.platform, Reason: reason}
}

type dockerAPIVersionKey struct{}

func negotiateDockerDiscoveryVersion(maximum, minimum string) (string, error) {
	minor := func(value string) int {
		if !strings.HasPrefix(value, "1.") {
			return -1
		}
		v, err := strconv.Atoi(strings.TrimPrefix(value, "1."))
		if err != nil {
			return -1
		}
		return v
	}
	maxVersion := minor(maximum)
	minVersion := minor(minimum)
	if minimum == "" {
		minVersion = 0
	}
	if maxVersion > 45 {
		maxVersion = 45
	}
	if maxVersion < 41 || minVersion < 0 || minVersion > maxVersion {
		return "", errors.New("unsupported_docker_api_version")
	}
	return "1." + strconv.Itoa(maxVersion), nil
}
