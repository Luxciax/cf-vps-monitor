package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type WebsiteMaintenanceWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}
type WebsiteCheckConfig struct {
	Kind           string                     `json:"kind,omitempty"`
	Keyword        string                     `json:"keyword,omitempty"`
	KeywordAbsent  bool                       `json:"keyword_absent,omitempty"`
	JSONPath       string                     `json:"json_path,omitempty"`
	JSONEquals     json.RawMessage            `json:"json_equals,omitempty"`
	DNSType        string                     `json:"dns_type,omitempty"`
	DNSExpected    []string                   `json:"dns_expected,omitempty"`
	TLSWarningDays int                        `json:"tls_warning_days,omitempty"`
	Maintenance    []WebsiteMaintenanceWindow `json:"maintenance,omitempty"`
	SilencedUntil  string                     `json:"silenced_until,omitempty"`
}
type WebsiteCheckDetails struct {
	TLSExpiresAt     *string  `json:"tls_expires_at,omitempty"`
	TLSDaysRemaining *int     `json:"tls_days_remaining,omitempty"`
	TLSStatus        string   `json:"tls_status,omitempty"`
	DNSAnswers       []string `json:"dns_answers,omitempty"`
	ContentChecked   bool     `json:"content_checked,omitempty"`
}

func websiteMaintenanceActive(config WebsiteCheckConfig, now time.Time) bool {
	for _, window := range config.Maintenance {
		start, err1 := time.Parse(time.RFC3339, window.Start)
		end, err2 := time.Parse(time.RFC3339, window.End)
		if err1 == nil && err2 == nil && !now.Before(start) && now.Before(end) {
			return true
		}
	}
	return false
}
func websiteContentFailure(body []byte, config WebsiteCheckConfig) string {
	if config.Keyword != "" && strings.Contains(string(body), config.Keyword) == config.KeywordAbsent {
		return "keyword_mismatch"
	}
	if config.JSONPath != "" {
		var value, expected any
		if json.Unmarshal(body, &value) != nil {
			return "invalid_json_content"
		}
		if json.Unmarshal(config.JSONEquals, &expected) != nil {
			return "invalid_json_expectation"
		}
		parts := strings.Split(config.JSONPath, ".")
		if len(parts) > 8 {
			return "invalid_json_path"
		}
		for _, part := range parts {
			if part == "__proto__" || part == "constructor" || part == "prototype" {
				return "invalid_json_path"
			}
			switch current := value.(type) {
			case map[string]any:
				var ok bool
				value, ok = current[part]
				if !ok {
					return "json_path_missing"
				}
			case []any:
				index, err := strconv.Atoi(part)
				if err != nil || index < 0 || index >= len(current) || strconv.Itoa(index) != part {
					return "json_path_missing"
				}
				value = current[index]
			default:
				return "json_path_missing"
			}
		}
		if !reflect.DeepEqual(value, expected) {
			return "json_content_mismatch"
		}
	}
	return ""
}
func websiteCertificateDetails(state *tls.ConnectionState, warningDays int) *WebsiteCheckDetails {
	details := &WebsiteCheckDetails{TLSStatus: "unknown"}
	if state == nil || len(state.PeerCertificates) == 0 {
		return details
	}
	expiry := state.PeerCertificates[0].NotAfter.UTC().Format(time.RFC3339)
	days := int(math.Floor(time.Until(state.PeerCertificates[0].NotAfter).Hours() / 24))
	details.TLSExpiresAt, details.TLSDaysRemaining, details.TLSStatus = &expiry, &days, "valid"
	if warningDays > 0 && days <= warningDays {
		details.TLSStatus = "expiring"
	}
	return details
}

func applyWebsiteHTTPChecks(task WebsiteProbeTask, response *http.Response, result WebsiteProbeResult) WebsiteProbeResult {
	result.Details = websiteCertificateDetails(response.TLS, task.CheckConfig.TLSWarningDays)
	if task.CheckConfig.Keyword == "" && task.CheckConfig.JSONPath == "" {
		return result
	}
	result.Details.ContentChecked = true
	body, err := io.ReadAll(io.LimitReader(response.Body, (256<<10)+1))
	reason := ""
	if err != nil {
		reason = probeFailureReason(err)
	} else if len(body) > 256<<10 {
		reason = "content_too_large"
	} else {
		reason = websiteContentFailure(body, task.CheckConfig)
	}
	if reason != "" {
		result.OK = false
		result.EffectiveStatus = "down"
		result.EffectiveReason = reason
		result.Error = stringPtr(reason)
	}
	return result
}
func executeWebsiteProbeWithContext(ctx context.Context, task WebsiteProbeTask) WebsiteProbeResult {
	switch task.CheckConfig.Kind {
	case "dns":
		return executeWebsiteDNSProbe(ctx, task)
	case "websocket":
		return executeWebsiteWebSocketProbe(ctx, task)
	}
	if strings.EqualFold(task.Method, "TCP") {
		return executeWebsiteTCPProbeWithContext(ctx, task)
	}
	return executeWebsiteHTTPProbeWithContext(ctx, task)
}
func unsafeWebsiteHost(host string) bool {
	if isBlockedTargetHost(host) {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return isBlockedTargetIP(ip)
	}
	return false
}

func executeWebsiteDNSProbe(parent context.Context, task WebsiteProbeTask) WebsiteProbeResult {
	started := time.Now()
	target, err := url.Parse(task.URL)
	if err != nil || target.Hostname() == "" || unsafeWebsiteHost(target.Hostname()) {
		return websiteProbeError(task, 0, "unsafe_host")
	}
	ctx, cancel := context.WithTimeout(parent, websiteProbeTimeout(task))
	defer cancel()
	hostname := target.Hostname()
	kind := task.CheckConfig.DNSType
	if kind == "" {
		kind = "A"
	}
	answers := []string{}
	switch kind {
	case "A", "AAAA":
		network := "ip4"
		if kind == "AAAA" {
			network = "ip6"
		}
		var values []net.IP
		values, err = net.DefaultResolver.LookupIP(ctx, network, hostname)
		for _, ip := range values {
			answers = append(answers, ip.String())
		}
	case "CNAME":
		var value string
		value, err = net.DefaultResolver.LookupCNAME(ctx, hostname)
		if !strings.EqualFold(strings.TrimSuffix(value, "."), hostname) {
			answers = append(answers, value)
		}
	case "MX":
		var values []*net.MX
		values, err = net.DefaultResolver.LookupMX(ctx, hostname)
		for _, mx := range values {
			answers = append(answers, strconv.Itoa(int(mx.Pref))+" "+mx.Host)
		}
	case "NS":
		var values []*net.NS
		values, err = net.DefaultResolver.LookupNS(ctx, hostname)
		for _, ns := range values {
			answers = append(answers, ns.Host)
		}
	case "TXT":
		answers, err = net.DefaultResolver.LookupTXT(ctx, hostname)
	default:
		return websiteProbeError(task, 0, "invalid_dns_type")
	}
	if err != nil {
		reason := "dns_error"
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
			reason = "dns_nxdomain"
		}
		if ctx.Err() != nil {
			reason = "timeout"
		}
		return websiteProbeError(task, time.Since(started).Milliseconds(), reason)
	}
	sort.Strings(answers)
	if len(answers) > 100 {
		answers = answers[:100]
	}
	reason := "dns_answer_match"
	ok := len(answers) > 0
	if !ok {
		reason = "dns_no_answers"
	}
	normalize := func(value string) string {
		if kind == "CNAME" || kind == "MX" || kind == "NS" {
			return strings.ToLower(strings.TrimSuffix(value, "."))
		}
		if kind == "AAAA" || kind == "A" {
			if ip := net.ParseIP(value); ip != nil {
				return ip.String()
			}
		}
		return value
	}
	for _, expected := range task.CheckConfig.DNSExpected {
		found := false
		for _, answer := range answers {
			if normalize(expected) == normalize(answer) {
				found = true
				break
			}
		}
		if !found {
			ok = false
			reason = "dns_answer_mismatch"
		}
	}
	for i := range answers {
		answers[i] = boundedDiscoveryText(answers[i], 512)
	}
	result := WebsiteProbeResult{MonitorID: task.ID, ConfigRevision: task.ConfigRevision, OK: ok, EffectiveStatus: "up", EffectiveReason: reason, LatencyMS: time.Since(started).Milliseconds(), Details: &WebsiteCheckDetails{DNSAnswers: answers}}
	if !ok {
		result.EffectiveStatus = "down"
		result.Error = stringPtr(reason)
	}
	return result
}
func executeWebsiteWebSocketProbe(parent context.Context, task WebsiteProbeTask) WebsiteProbeResult {
	started := time.Now()
	target, err := url.Parse(task.URL)
	if err != nil || target.Hostname() == "" || target.User != nil || unsafeWebsiteHost(target.Hostname()) {
		return websiteProbeError(task, 0, "unsafe_host")
	}
	switch target.Scheme {
	case "https", "wss":
		target.Scheme = "wss"
	case "http", "ws":
		target.Scheme = "ws"
	default:
		return websiteProbeError(task, 0, "invalid_url")
	}
	timeout := websiteProbeTimeout(task)
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	dialer := websocket.Dialer{HandshakeTimeout: timeout, NetDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		return dialPublicTCP(ctx, network, host, port, timeout)
	}}
	conn, response, err := dialer.DialContext(ctx, target.String(), http.Header{"User-Agent": []string{"cf-vps-monitor-agent/" + Version}})
	if response != nil && response.Body != nil {
		defer response.Body.Close()
	}
	if err != nil {
		return websiteProbeError(task, time.Since(started).Milliseconds(), "websocket_handshake_failed")
	}
	defer conn.Close()
	_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "availability probe complete"), time.Now().Add(time.Second))
	details := &WebsiteCheckDetails{TLSStatus: "unknown"}
	if tlsConnection, ok := conn.UnderlyingConn().(*tls.Conn); ok {
		state := tlsConnection.ConnectionState()
		details = websiteCertificateDetails(&state, task.CheckConfig.TLSWarningDays)
	}
	return WebsiteProbeResult{MonitorID: task.ID, ConfigRevision: task.ConfigRevision, OK: true, EffectiveStatus: "up", EffectiveReason: "websocket_handshake", LatencyMS: time.Since(started).Milliseconds(), Details: details}
}
