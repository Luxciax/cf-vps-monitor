package main

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var nginxServerNameDirective = regexp.MustCompile(`(?m)^\s*server_name\s+([^;]+);`)

func configuredDomains(text, kind string) []string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if pos := strings.Index(line, "#"); pos >= 0 {
			lines[i] = line[:pos]
		}
	}
	candidates := []string{}
	if kind == "nginx" {
		for _, match := range nginxServerNameDirective.FindAllStringSubmatch(strings.Join(lines, "\n"), 100) {
			candidates = append(candidates, strings.Fields(match[1])...)
		}
	} else {
		depth := 0
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if depth == 0 && strings.HasSuffix(trimmed, "{") {
				candidates = append(candidates, strings.Fields(strings.ReplaceAll(strings.TrimSuffix(trimmed, "{"), ",", " "))...)
			}
			depth += strings.Count(line, "{") - strings.Count(line, "}")
			if depth < 0 {
				depth = 0
			}
		}
	}
	domains := map[string]bool{}
	for _, candidate := range candidates {
		candidate = strings.Trim(candidate, "\"'")
		if strings.Contains(candidate, "$") || strings.Contains(candidate, "{") || strings.HasPrefix(candidate, "~") {
			continue
		}
		if strings.Contains(candidate, "://") {
			parsed, err := url.Parse(candidate)
			if err != nil || parsed.User != nil || parsed.RawQuery != "" {
				continue
			}
			candidate = parsed.Hostname()
		} else if pos := strings.LastIndex(candidate, ":"); pos > 0 {
			candidate = candidate[:pos]
		}
		candidate = strings.ToLower(strings.TrimSuffix(candidate, "."))
		candidate = strings.TrimPrefix(candidate, "*.")
		if discoveryDomainPattern.MatchString(candidate) {
			domains[candidate] = true
		}
	}
	result := make([]string, 0, len(domains))
	for domain := range domains {
		result = append(result, domain)
	}
	sort.Strings(result)
	if len(result) > 100 {
		return result[:100]
	}
	return result
}
func (s discoverySource) collectReverseProxies(_ context.Context, out *DiscoverySnapshot) {
	for _, entry := range []struct {
		kind  string
		files []string
		dirs  []string
	}{{"nginx", []string{"/etc/nginx/nginx.conf"}, []string{"/etc/nginx/conf.d", "/etc/nginx/sites-enabled"}}, {"caddy", []string{"/etc/caddy/Caddyfile"}, []string{}}} {
		files := append([]string{}, entry.files...)
		for _, dir := range entry.dirs {
			names, err := os.ReadDir(filepath.Join(s.root, strings.TrimPrefix(dir, "/")))
			if err != nil {
				continue
			}
			for _, name := range names {
				if !name.IsDir() && !strings.HasPrefix(name.Name(), ".") {
					files = append(files, filepath.ToSlash(filepath.Join(dir, name.Name())))
				}
				if len(files) >= 40 {
					break
				}
			}
		}
		seen := map[string]string{}
		paths := []string{}
		var failure error
		for _, path := range files {
			data, err := s.read(path)
			if err != nil {
				if !errors.Is(err, os.ErrNotExist) {
					failure = err
				}
				continue
			}
			paths = append(paths, path)
			for _, domain := range configuredDomains(string(data), entry.kind) {
				if _, exists := seen[domain]; !exists {
					seen[domain] = path
				}
			}
		}
		if len(paths) == 0 {
			status, reason := "unavailable", "no_readable_standard_configuration"
			if failure != nil {
				status, reason = discoveryErrorStatus(failure)
			}
			out.Collectors = append(out.Collectors, DiscoveryCollector{entry.kind + "_routes", status, reason})
			continue
		}
		proxyID := stableDiscoveryID("reverse_proxy", entry.kind+":host")
		out.Assets = append(out.Assets, DiscoveryAsset{ExternalID: proxyID, Kind: "reverse_proxy", Name: entry.kind, Metadata: map[string]any{"runtime": entry.kind, "configuration_paths": paths, "effective_configuration": "unknown: custom includes, dynamic config, and container files require external evidence"}, Evidence: DiscoveryEvidence{"standard local config projection", out.CollectedAt, "partial"}, Relations: []DiscoveryRelation{{"host", "runs_on"}}})
		domains := make([]string, 0, len(seen))
		for domain := range seen {
			domains = append(domains, domain)
		}
		sort.Strings(domains)
		for _, domain := range domains {
			if len(out.Assets) >= discoveryMaxAssets {
				out.Complete = false
				break
			}
			out.Assets = append(out.Assets, DiscoveryAsset{ExternalID: stableDiscoveryID("domain", domain), Kind: "domain", Name: domain, Metadata: map[string]any{"domain": domain, "configuration_path": seen[domain], "dns_verified": false}, Evidence: DiscoveryEvidence{"local " + entry.kind + " domain directive; runtime activation unverified", out.CollectedAt, "partial"}, Relations: []DiscoveryRelation{{proxyID, "routes_to"}}})
		}
		out.Collectors = append(out.Collectors, DiscoveryCollector{entry.kind + "_routes", "partial", "only_standard_paths_and_literal_domains"})
		out.Complete = false
	}
}
