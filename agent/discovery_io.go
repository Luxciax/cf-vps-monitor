package main

import (
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
)

type discoveryIOState struct {
	sync.Mutex
	at       time.Time
	counters map[string]disk.IOCountersStat
}

var discoveryDiskIO discoveryIOState

func (state *discoveryIOState) observe(counters map[string]disk.IOCountersStat, at time.Time) map[string]any {
	state.Lock()
	defer state.Unlock()
	elapsed := at.Sub(state.at).Seconds()
	names := make([]string, 0, len(counters))
	for name := range counters {
		if !strings.HasPrefix(name, "loop") && !strings.HasPrefix(name, "ram") {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	result := map[string]any{}
	for _, name := range names {
		c := counters[name]
		item := map[string]any{"read_bytes": c.ReadBytes, "write_bytes": c.WriteBytes, "read_ops": c.ReadCount, "write_ops": c.WriteCount, "io_time_ms": c.IoTime, "read_iops": nil, "write_iops": nil, "read_bytes_per_sec": nil, "write_bytes_per_sec": nil, "sample_interval_sec": nil}
		if old, ok := state.counters[name]; ok && !state.at.IsZero() && elapsed > 0 && c.ReadBytes >= old.ReadBytes && c.WriteBytes >= old.WriteBytes && c.ReadCount >= old.ReadCount && c.WriteCount >= old.WriteCount {
			item["read_iops"] = float64(c.ReadCount-old.ReadCount) / elapsed
			item["write_iops"] = float64(c.WriteCount-old.WriteCount) / elapsed
			item["read_bytes_per_sec"] = float64(c.ReadBytes-old.ReadBytes) / elapsed
			item["write_bytes_per_sec"] = float64(c.WriteBytes-old.WriteBytes) / elapsed
			item["sample_interval_sec"] = elapsed
		}
		result[name] = item
		if len(result) >= 64 {
			break
		}
	}
	state.at = at
	state.counters = counters
	return result
}
