import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHarness, settleRender } from "./helpers/harness.mjs";

const args = process.argv.slice(2);
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const output = resolve(option("--output") || ".tmp/cvm-ui-review");
await mkdir(output, { recursive: true });
const harness = await createHarness({
  playwrightModule: option("--playwright-module"),
  browserExecutable: option("--browser-executable"),
  selection: option("--selection") || "ALL",
});
const { origin, check, finish } = harness;
const assetId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const docId = "33333333-3333-4333-8333-333333333333";
const baselineId = "44444444-4444-4444-8444-444444444444";
const fixedTime = "2026-11-27T10:00:00Z";

function configure(data) {
  const assets = [
    {
      id: assetId,
      kind: "vps",
      name: "Singapore · Edge 01",
      status: "active",
      category: "生产环境",
      tags: ["production", "sg"],
      description: "个人服务与公开站点的入口节点。此处为浏览器验证数据。",
      source: "manual",
      external_id: "vps:edge-01",
      metadata: { deployment_directory: "/srv/compose" },
      observed: {},
      url: "",
      provider: "Example Cloud",
      cost: 24,
      currency: "USD",
      billing_cycle: "yearly",
      expires_at: "2027-02-01T12:34:56Z",
      client_id: "node-a",
      created_at: fixedTime,
      updated_at: fixedTime,
    },
    {
      id: otherId,
      kind: "website",
      name: "Personal Knowledge",
      status: "active",
      category: "知识管理",
      tags: ["self-hosted"],
      description: "学习笔记与文档服务。",
      source: "discovery",
      external_id: "service:knowledge",
      metadata: {},
      observed: {},
      url: "https://knowledge.example.invalid",
      cost: null,
      created_at: fixedTime,
      updated_at: fixedTime,
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      kind: "container",
      name: "Knowledge Web Container",
      status: "active",
      category: "生产环境",
      tags: ["docker"],
      description: "容器的来源与资源证据。",
      source: "harness:fixture",
      external_id: "compose:knowledge:web",
      metadata: {},
      observed: {
        image: "example/knowledge:1.4",
        state: "running",
        health: "healthy",
        restart_count: null,
        compose_project: "knowledge",
        ports: [
          {
            address: "127.0.0.1",
            public_port: 8080,
            private_port: 3000,
            protocol: "tcp",
          },
        ],
        resources: {
          cpu_percent: null,
          cpu_sample_interval_sec: null,
          memory_bytes: 104857600,
          memory_limit_bytes: null,
          network_rx_bytes: 0,
          network_tx_bytes: 1024,
        },
      },
      observed_source: "harness:fixture",
      observed_confidence: "reported",
      observed_at: fixedTime,
      created_at: fixedTime,
      updated_at: fixedTime,
    },
    ...["Database", "Caddy", "Docker Compose", "Certificate"].map(
      (name, index) => ({
        id: `55555555-5555-4555-8555-55555555555${index}`,
        kind: ["database", "reverse_proxy", "compose", "certificate"][index],
        name,
        status: "active",
        category: "生产环境",
        tags: ["edge"],
        description: "验证数据",
        source: "agent",
        metadata: {},
        created_at: fixedTime,
        updated_at: fixedTime,
      }),
    ),
  ];
  const document = {
    id: docId,
    title: "Debian 安全初始化",
    content:
      '# Debian 安全初始化\n\n## 目标\n\n保留现有 SSH 会话并检查系统环境。\n\n## 前置条件\n\n- [ ] 具备控制台或救援入口\n- [ ] 已验证独立管理员登录\n\n## 检查\n\n```sh\ncat /etc/os-release\n```\n\n<img src=x onerror="window.__markdownExecuted=true">\n\n[危险链接](javascript:alert(1))\n\n| 项目 | 要求 |\n| --- | --- |\n| SSH | 先验证，再修改 |\n',
    category: "安全加固",
    tags: ["ssh", "debian"],
    environments: ["Debian 12", "Ubuntu 24.04"],
    risk: "high",
    asset_ids: [assetId],
    version: 1,
    created_at: fixedTime,
    updated_at: fixedTime,
  };
  const baseline = {
    id: baselineId,
    name: "Linux 基础安全",
    description: "检查 SSH、Swap 与配置时效。",
    environments: ["Debian", "Ubuntu"],
    asset_kinds: ["vps"],
    rules: [
      {
        id: "ssh-root",
        path: "ssh.value.permitrootlogin",
        operator: "eq",
        expected: "no",
        severity: "critical",
        description: "禁止 Root 密码登录",
        sop_id: docId,
      },
    ],
    exceptions: [],
    max_age_hours: 24,
    version: 1,
    created_at: fixedTime,
    updated_at: fixedTime,
  };
  const changes = [
    {
      id: "change-1",
      asset_id: assetId,
      kind: "configuration",
      summary: "SSH 配置快照已更新",
      source: "agent:edge-01",
      verification: "observed",
      before: { permitrootlogin: "prohibit-password" },
      after: { permitrootlogin: "no" },
      created_at: fixedTime,
    },
    {
      id: "change-2",
      asset_id: assetId,
      kind: "operation",
      summary: "外部 Harness 提交防火墙维护记录",
      source: "machine:codex",
      verification: "claimed",
      before: null,
      after: { summary: "已检查规则" },
      created_at: fixedTime,
    },
  ];
  let candidates = [
    {
      id: "candidate-1",
      name: "knowledge-web",
      kind: "container",
      source: "agent:edge-01",
      external_id: "docker:compose:knowledge:web",
      metadata: {
        image: "example/knowledge:1.4",
        health: "healthy",
        restart_count: 0,
      },
      evidence: { collector: "docker", observed_at: fixedTime },
      status: "pending",
      first_seen: fixedTime,
      last_seen: fixedTime,
    },
  ];
  let tokens = [
    {
      id: "token-1",
      name: "Codex — 只读上下文",
      prefix: "cvm_example",
      scopes: ["assets:read", "knowledge:read"],
      expires_at: "2027-02-01T00:00:00Z",
      revoked_at: null,
      created_at: fixedTime,
      last_used_at: fixedTime,
    },
  ];
  const page = (items, limit = 30, offset = 0) => ({
    data: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  });
  const stats = {
    availability_percent: 99.91,
    coverage_percent: 98.5,
    unknown_ms: 1296000,
    maintenance_ms: 0,
    p50_ms: 28,
    p95_ms: 64,
    p99_ms: 102,
    samples: 450,
    sample_limit: 500,
    limited: false,
    incidents: [
      {
        started_at: fixedTime,
        recovered_at: "2026-11-27T10:02:00Z",
        observed_duration_ms: 120000,
        observation_gap: false,
      },
    ],
  };
  data.observed.writes = [];
  data.handlers.push(async ({ path, request, url, body, json }) => {
    const method = request.method();
    const respond = (value, status = 200) => {
      json(value, status);
      return true;
    };
    if (path === "/api/admin/infrastructure/summary")
      return respond({
        assets_total: assets.length,
        assets_by_kind: { vps: 1, website: 1 },
        assets_by_status: { active: assets.length },
        discovery_pending: candidates.filter((x) => x.status === "pending")
          .length,
        changes_24h: changes.length,
        documents_total: 1,
      });
    if (path === "/api/admin/assets") {
      if (method === "POST") {
        const next = {
          ...assets[0],
          ...body,
          id: "66666666-6666-4666-8666-666666666666",
        };
        assets.push(next);
        data.observed.writes.push({ path, body });
        return respond(next, 201);
      }
      const q = (url.searchParams.get("q") || "").toLowerCase(),
        kind = url.searchParams.get("kind");
      return respond(
        page(
          assets.filter(
            (x) =>
              (!q || x.name.toLowerCase().includes(q)) &&
              (!kind || x.kind === kind) &&
              (!url.searchParams.has("client_id") ||
                x.client_id === url.searchParams.get("client_id")) &&
              (!url.searchParams.has("monitor_id") || x.id === otherId),
          ),
          Number(url.searchParams.get("limit") || 30),
          Number(url.searchParams.get("offset") || 0),
        ),
      );
    }
    if (
      /^\/api\/admin\/assets\/[0-9a-f-]{36}$/.test(path) &&
      method === "PATCH"
    ) {
      const asset = assets.find((asset) => path.endsWith(asset.id));
      data.observed.writes.push({ path, body });
      Object.assign(asset, body, { updated_at: fixedTime });
      return respond(asset);
    }
    if (path === "/api/admin/assets/batch") {
      data.observed.writes.push({ path, body });
      assets
        .filter((x) => body.ids.includes(x.id))
        .forEach((x) =>
          body.action === "tag"
            ? (x.tags = body.tags)
            : (x.status = "archived"),
        );
      return respond({ success: true });
    }
    if (path.endsWith("/context") && path.startsWith("/api/admin/assets/"))
      return respond({
        schema_version: "1",
        asset: assets.find((x) => path.includes(x.id)) || assets[0],
        trust: { content: "untrusted", execution_authority: "none" },
        monitors: [
          ...(path.includes(assetId) ? [{ monitor_type: "client", monitor_id: "node-a", monitor: { name: "Singapore · Edge 01", status: "up" } }] : []),
          {
            monitor_type: "website",
            monitor_id: "1",
            monitor: {
              name: "Personal Knowledge",
              status: "up",
              last_latency_ms: 28,
              last_checked_at: fixedTime,
            },
          },
        ],
        configuration: [
          {
            id: "snapshot-1",
            asset_id: assetId,
            source: "agent:edge-01",
            collected_at: fixedTime,
            created_at: fixedTime,
            confidence: "observed",
            environment: "Debian 12",
            collectors: [
              { name: "ssh", status: "ok" },
              {
                name: "firewall",
                status: "permission_denied",
                reason: "Read access unavailable",
              },
            ],
            data: {
              host: {
                status: "ok",
                value: { os: "Debian 12", kernel: "6.1", arch: "amd64" },
              },
              ssh: {
                status: "ok",
                value: { permitrootlogin: "no", passwordauthentication: "no" },
              },
              firewall: {
                status: "permission_denied",
                reason: "Insufficient permission",
              },
              docker: {
                status: "ok",
                value: { version: "27.1.0", containers: 5 },
              },
            },
          },
        ],
        relationships: [],
        changes,
        documents: [document],
        baselines: [
          {
            baseline_id: baselineId,
            baseline_version: 1,
            status: "compliant",
            results: [],
          },
        ],
        limits: { per_section: 20, max_bytes: 131072, truncated_sections: [] },
      });
    if (path.endsWith("/topology"))
      return respond({
        nodes: assets.slice(0, 2),
        edges: [
          {
            id: "edge-1",
            source_id: otherId,
            target_id: assetId,
            kind: "hosted_on",
            source: "manual",
          },
        ],
        truncated: false,
      });
    if (path.endsWith("/monitors") && method === "POST") {
      data.observed.writes.push({ path, body });
      return respond({ success: true });
    }
    if (path === "/api/admin/discovery/candidates")
      return respond(
        page(
          candidates.filter(
            (x) => x.status === (url.searchParams.get("status") || "pending"),
          ),
        ),
      );
    if (path === "/api/admin/discovery/runs")
      return respond(
        page([
          {
            id: "run-1",
            source: "agent:edge-01",
            complete: false,
            collected_at: fixedTime,
            collectors: [
              { name: "docker", status: "ok" },
              {
                name: "firewall",
                status: "permission_denied",
                reason: "Collector could not read firewall rules",
              },
            ],
          },
        ]),
      );
    if (path.endsWith("/resolve")) {
      data.observed.writes.push({ path, body });
      candidates = candidates.map((x) => ({
        ...x,
        status: body.action === "ignore" ? "ignored" : "imported",
      }));
      return respond({ success: true });
    }
    if (path === "/api/admin/changes") return respond(page(changes));
    if (path === "/api/admin/documents") return respond(page([document]));
    if (path === `/api/admin/documents/${docId}`) {
      if (method === "PATCH") {
        data.observed.writes.push({ path, body });
        if (data.observed.conflict) {
          data.observed.conflict = false;
          document.version += 1;
          document.content += "\n\n另一位管理员已补充备份验证要求。";
          return respond({ error: "文档版本冲突，草稿请保留" }, 409);
        }
        if (body.version !== document.version)
          return respond({ error: "文档版本冲突，草稿请保留" }, 409);
        Object.assign(document, body, { version: document.version + 1 });
      }
      return respond(document);
    }
    if (path.endsWith("/versions"))
      return respond(
        page(path.includes("/documents/") ? [document] : [baseline]),
      );
    if (path === "/api/admin/baselines") return respond(page([baseline]));
    if (path.endsWith("/evaluate")) {
      data.observed.writes.push({ path, body });
      return respond({
        baseline_id: baselineId,
        baseline_version: 1,
        asset_id: body.asset_id,
        snapshot_id: "snapshot-1",
        evaluated_at: fixedTime,
        status: "deviation",
        results: [
          {
            rule_id: "ssh-root",
            status: "deviation",
            actual: "yes",
            expected: "no",
            description: "禁止 Root 密码登录",
            severity: "critical",
            sop_id: docId,
            evidence: {
              source: "harness:external",
              confidence: "reported",
              collected_at: fixedTime,
            },
          },
        ],
      });
    }
    if (path === "/api/admin/account/machine-tokens") {
      if (method === "POST") {
        const record = {
          id: "token-2",
          ...body,
          prefix: "cvm_fixture",
          revoked_at: null,
          created_at: fixedTime,
          last_used_at: null,
        };
        tokens.push(record);
        data.observed.writes.push({ path, body });
        return respond(
          { token: "cvm_synthetic_fixture_never_a_real_credential", record },
          201,
        );
      }
      return respond({
        tokens,
        scopes: [
          "read",
          "write",
          "assets:read",
          "monitors:read",
          "config:read",
          "knowledge:read",
          "changes:read",
          "baselines:read",
          "discovery:write",
          "backup",
          "restore",
        ],
        legacy_env_token_configured: false,
      });
    }
    if (path.endsWith("/rotate")) {
      const token = tokens.find((x) => path.includes(x.id));
      data.observed.writes.push({ path, body });
      return respond({
        token: "cvm_synthetic_rotated_fixture_never_a_real_credential",
        record: token,
      });
    }
    if (path.endsWith("/revoke")) {
      tokens = tokens.map((x) =>
        path.includes(x.id) ? { ...x, revoked_at: fixedTime } : x,
      );
      data.observed.writes.push({ path, body });
      return respond({ success: true });
    }
    if (path === "/api/admin/search")
      return respond({
        assets: assets.slice(0, 2),
        documents: [document],
        changes: [],
        limit: 8,
        truncated: false,
      });
    if (/^\/api\/(?:admin\/)?websites\/\d+\/statistics$/.test(path))
      return respond(stats);
    return false;
  });
}
async function screenshot(page, name) {
  await settleRender(page);
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    fullPage: true,
  });
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "Viewport must not overflow horizontally",
  );
}

await check(
  "CVM-01",
  "Desktop inventory, create asset, and command palette",
  async (page, data) => {
    configure(data);
    await page.addInitScript(() =>
      localStorage.setItem("cf-monitor-theme", "light"),
    );
    await page.goto(`${origin}/admin/infrastructure`);
    await page
      .getByRole("heading", { name: "基础设施", exact: true })
      .waitFor();
    await page.getByText("Singapore · Edge 01", { exact: true }).waitFor();
    await noOverflow(page);
    await screenshot(page, "desktop-assets-light");
    await page.getByRole("button", { name: "添加资产", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名称", { exact: true }).fill("Fixture new API");
    await dialog.getByLabel("类型", { exact: true }).selectOption("api");
    await dialog.getByRole("button", { name: "保存资产" }).click();
    await page.getByText("Fixture new API", { exact: true }).waitFor();
    assert.equal(data.observed.writes[0].body.kind, "api");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("knowledge");
    await page
      .getByRole("option")
      .filter({ hasText: "Personal Knowledge" })
      .waitFor();
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: "Singapore · Edge 01", exact: true })
      .waitFor();
    data.observed.creation = true;
  },
);
await check(
  "CVM-02",
  "Discovery evidence and import use confirmed candidate id",
  async (page, data) => {
    configure(data);
    await page.goto(`${origin}/admin/discovery`);
    await page.getByRole("heading", { name: "knowledge-web" }).waitFor();
    await page.getByRole("button", { name: "查看证据" }).click();
    await page
      .getByRole("dialog")
      .getByText("发现证据 · knowledge-web")
      .waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await screenshot(page, "desktop-discovery");
    await page.getByRole("button", { name: "导入资产" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page.getByRole("heading", { name: "收件箱已清空" }).waitFor();
    assert.equal(data.observed.writes[0].body.action, "import");
  },
);
await check(
  "CVM-03",
  "Markdown is inert and edit conflict preserves draft",
  async (page, data) => {
    configure(data);
    await page.goto(`${origin}/admin/knowledge?document=${docId}`);
    await page
      .getByRole("heading", { name: "Debian 安全初始化", exact: true })
      .first()
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.__markdownExecuted),
      undefined,
    );
    assert.equal(
      await page.locator('.infra-markdown a[href^="javascript:"]').count(),
      0,
    );
    await screenshot(page, "desktop-knowledge");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByRole("checkbox", { name: "VPS", exact: true }).check();
    await page
      .getByLabel("标题", { exact: true })
      .fill("Saved draft after conflict");
    data.observed.conflict = true;
    await page.getByRole("button", { name: "保存版本" }).click();
    await page
      .getByRole("alert")
      .getByText("文档版本冲突，草稿请保留")
      .waitFor();
    assert.equal(
      await page.getByLabel("标题", { exact: true }).inputValue(),
      "Saved draft after conflict",
    );
    await page
      .getByRole("button", { name: "与服务器当前版本比较", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "服务器 · v2", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "基于当前版本继续编辑草稿", exact: true })
      .click();
    await page.getByRole("button", { name: "保存版本" }).click();
    await page
      .getByRole("heading", { name: "Saved draft after conflict" })
      .waitFor();
    assert.equal(data.observed.writes[0].body.version, 1);
    assert.equal(data.observed.writes[1].body.version, 2);
    assert.deepEqual(data.observed.writes[1].body.asset_kinds, ["vps"]);
  },
);
await check(
  "CVM-04",
  "Baseline evaluation and scoped token lifecycle",
  async (page, data) => {
    configure(data);
    await page.goto(`${origin}/admin/baselines`);
    await page.getByRole("button", { name: "检测", exact: true }).click();
    await page.getByLabel("目标资产", { exact: true }).selectOption(assetId);
    await page.getByRole("button", { name: "运行只读检测" }).click();
    await page.getByText("禁止 Root 密码登录", { exact: true }).waitFor();
    assert.equal(data.observed.writes[0].body.asset_id, assetId);
    await page.getByText("待探针观测验证", { exact: true }).waitFor();
    await screenshot(page, "desktop-baseline-result");
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.goto(`${origin}/admin/api`);
    await page.getByRole("button", { name: "创建 Token", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("Fixture harness");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "创建 Token", exact: true })
      .click();
    await page.getByRole("textbox", { name: "新建的 Machine Token" }).waitFor();
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(localStorage).includes("cvm_synthetic_fixture"),
      ),
      false,
    );
    await page.getByRole("button", { name: "已保存，关闭" }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "新建的 Machine Token" }).count(),
      0,
    );
    const firstTokenRow = page
      .getByRole("row")
      .filter({ hasText: "Codex — 只读上下文" });
    await firstTokenRow
      .getByRole("button", { name: "轮换", exact: true })
      .click();
    await page.getByRole("button", { name: "轮换凭据", exact: true }).click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "新建的 Machine Token" })
        .inputValue(),
      "cvm_synthetic_rotated_fixture_never_a_real_credential",
    );
    await page.getByRole("button", { name: "已保存，关闭" }).click();
    await firstTokenRow
      .getByRole("button", { name: "吊销", exact: true })
      .click();
    await page
      .getByRole("button", { name: "吊销此 Token", exact: true })
      .click();
    await firstTokenRow.getByText("已吊销", { exact: true }).waitFor();
    assert.equal(
      data.observed.writes.some((write) =>
        write.path.endsWith("/token-1/rotate"),
      ),
      true,
    );
    assert.equal(
      data.observed.writes.some((write) =>
        write.path.endsWith("/token-1/revoke"),
      ),
      true,
    );
    await screenshot(page, "desktop-api-tokens");
  },
);
await check(
  "CVM-05",
  "Mobile navigation, configuration evidence and dark surfaces",
  async (page, data) => {
    configure(data);
    await page.addInitScript(() =>
      localStorage.setItem("cf-monitor-theme", "dark"),
    );
    await page.goto(`${origin}/admin/infrastructure`);
    await page
      .getByRole("heading", { name: "基础设施", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "卡片视图" }).click();
    await page.getByText("Singapore · Edge 01", { exact: true }).waitFor();
    await noOverflow(page);
    await screenshot(page, "mobile-assets-dark");
    await page
      .getByRole("link", { name: "Singapore · Edge 01", exact: true })
      .click();
    await page.getByRole("tab", { name: "配置", exact: true }).click();
    await page.getByRole("heading", { name: "采集能力" }).waitFor();
    await noOverflow(page);
    await screenshot(page, "mobile-configuration-dark");
    await page.getByRole("button", { name: "打开菜单" }).click();
    const sidebar = page.getByRole("dialog", { name: "管理菜单" });
    await sidebar.getByRole("link", { name: "运维知识库" }).click();
    await page
      .getByRole("heading", { name: "运维知识库", exact: true })
      .waitFor();
    await noOverflow(page);
  },
  { width: 390 },
);
await check(
  "CVM-06",
  "Public websites retain unknown history and expose bounded statistics",
  async (page, data) => {
    configure(data);
    data.websites[0].checks = [
      {
        checked_at: fixedTime,
        ok: true,
        latency_ms: null,
        source_type: "worker",
      },
    ];
    await page.goto(`${origin}/?view=websites`);
    await page
      .getByRole("button", { name: "查看 Synthetic website 详情" })
      .waitFor();
    assert.equal(
      await page.locator(".website-heartbeat-segment.is-inferred").count(),
      0,
    );
    await screenshot(page, "public-websites-desktop");
    await page
      .getByRole("button", { name: "查看 Synthetic website 详情" })
      .click();
    await page.getByRole("heading", { name: "可用率与延迟" }).waitFor();
    await page.getByText("99.91%", { exact: true }).waitFor();
    await screenshot(page, "public-website-statistics");
  },
);
await check(
  "CVM-07",
  "Mobile website monitor policy round-trip",
  async (page, data) => {
    configure(data);
    data.websites[0].check_config = {
      kind: "http",
      keyword: "ready",
      tls_warning_days: 14,
      maintenance: [
        { start: "2026-12-01T01:00:00Z", end: "2026-12-01T02:00:00Z" },
      ],
    };
    await page.goto(`${origin}/admin/websites`);
    await page
      .getByText("Synthetic website", { exact: true })
      .first()
      .waitFor();
    const edit = page.getByRole("button", { name: /编辑/ }).first();
    await edit.click();
    await page.getByRole("heading", { name: "检测内容与维护策略" }).waitFor();
    await page.getByLabel("探测类型", { exact: true }).selectOption("dns");
    await page.getByLabel("DNS 记录类型", { exact: true }).selectOption("AAAA");
    await page.getByLabel("期望记录", { exact: true }).fill("2001:db8::1");
    await noOverflow(page);
    await screenshot(page, "mobile-monitor-policy");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const saved = data.calls.find(
      (call) => call.path === "/api/admin/websites/edit",
    );
    assert.equal(saved.body.check_config.kind, "dns");
    assert.equal(saved.body.check_config.dns_type, "AAAA");
    assert.deepEqual(saved.body.check_config.dns_expected, ["2001:db8::1"]);
    assert.equal(saved.body.check_config.tls_warning_days, 14);
    assert.deepEqual(saved.body.check_config.maintenance, [
      { start: "2026-12-01T01:00:00Z", end: "2026-12-01T02:00:00Z" },
    ]);
    await page.goto(`${origin}/admin/websites?monitor=1`);
    await page.getByRole("link", { name: "资产、配置与关系" }).waitFor();
    await page.getByRole("link", { name: "资产、配置与关系" }).click();
    await page
      .getByRole("heading", { name: "Personal Knowledge", exact: true })
      .waitFor();
    await noOverflow(page);
    await screenshot(page, "mobile-website-linked-asset");
  },
  { width: 390 },
);
await check(
  "CVM-08",
  "Asset grouping, bulk tags and VPS monitor reverse link",
  async (page, data) => {
    configure(data);
    await page.addInitScript(() =>
      localStorage.setItem("cf-monitor-theme", "light"),
    );
    await page.goto(`${origin}/admin/infrastructure`);
    await page.getByText("Singapore · Edge 01", { exact: true }).waitFor();
    await page
      .getByRole("checkbox", { name: "选择 Singapore · Edge 01", exact: true })
      .check();
    await page.getByRole("button", { name: "批量标签", exact: true }).click();
    await page
      .getByLabel("批量标签", { exact: true })
      .fill("reviewed, production");
    await page
      .getByRole("button", { name: "替换所选标签", exact: true })
      .click();
    await page.getByText("reviewed", { exact: true }).waitFor();
    await page
      .getByRole("button", {
        name: "快速编辑 Singapore · Edge 01",
        exact: true,
      })
      .click();
    assert.equal(await page.getByRole("dialog").getByRole("combobox", { name: "类型", exact: true }).isDisabled(), true);
    await page
      .getByRole("dialog")
      .getByLabel("说明", { exact: true })
      .fill("Updated note without changing exact expiry");
    await page.getByRole("button", { name: "保存资产", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      data.observed.writes.find((write) => write.path.endsWith(assetId)).body
        .expires_at,
      "2027-02-01T12:34:56Z",
    );
    assert.deepEqual(data.observed.writes[0].body.tags, [
      "reviewed",
      "production",
    ]);
    await page.getByRole("button", { name: "布局选项", exact: true }).click();
    await page
      .getByRole("menuitemradio", { name: "按分类", exact: true })
      .click();
    await page.locator(".infra-group-row").first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get("group"), "category");
    await screenshot(page, "desktop-assets-grouped");
    await page.goto(`${origin}/instance/node-a`);
    await page
      .getByRole("link", { name: "资产、配置与关系", exact: true })
      .waitFor();
    await screenshot(page, "desktop-vps-assets-entry");
    await page
      .getByRole("link", { name: "资产、配置与关系", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Singapore · Edge 01", exact: true })
      .waitFor();
    await page.getByText("服务器固定绑定", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "解除 Singapore · Edge 01 的关联", exact: true }).count(), 0);
    await page.getByRole("tab", { name: "关系拓扑", exact: true }).click();
    await page
      .getByText("Personal Knowledge", { exact: true })
      .first()
      .waitFor();
    await noOverflow(page);
    await screenshot(page, "desktop-asset-topology");
    await page
      .getByRole("combobox", { name: "拓扑查询方向" })
      .selectOption("downstream");
    await page.getByRole("heading", { name: /潜在影响范围/ }).waitFor();
    assert.equal(
      data.calls.some(
        (call) =>
          call.path.endsWith("/topology") &&
          call.search.includes("direction=downstream"),
      ),
      true,
    );
  },
);
await check(
  "CVM-09",
  "Read failures never become empty success or widen exported AI context",
  async (page, data) => {
    let failingAssets = true;
    data.handlers.push(async ({ path, url, json }) => {
      if (
        (path === "/api/admin/assets" && failingAssets) ||
        (path.endsWith("/context") && url.searchParams.has("fields"))
      ) {
        await json({ error: "Synthetic infrastructure unavailable" }, 503);
        return true;
      }
      return false;
    });
    configure(data);
    await page.goto(`${origin}/admin/infrastructure`);
    await page
      .getByRole("alert")
      .getByText("Synthetic infrastructure unavailable")
      .waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "还没有符合条件的资产" }).count(),
      0,
    );
    failingAssets = false;
    await page
      .getByRole("alert")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await page.getByText("Singapore · Edge 01", { exact: true }).waitFor();
    await page.goto(`${origin}/admin/assets/${assetId}?tab=context`);
    await page
      .getByRole("checkbox", { name: "documents", exact: true })
      .uncheck();
    await page.getByRole("button", { name: "加载范围", exact: true }).click();
    await page
      .getByRole("alert")
      .getByText("Synthetic infrastructure unavailable")
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "导出 JSON", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "复制", exact: true })
        .isDisabled(),
      true,
    );
    await screenshot(page, "desktop-context-failure");
  },
);
await check(
  "CVM-10",
  "Independent administrator recovery stays disabled by default and submits no database secret",
  async (page, data) => {
    data.authenticated = false;
    let enabled = false;
    data.handlers.push(async ({ path, body, json }) => {
      if (path === "/api/admin/recovery/status") {
        await json({ enabled, admin_present: false, recoverable: enabled });
        return true;
      }
      if (path === "/api/admin/recovery") {
        data.observed.recovery = body;
        await json({ success: true });
        return true;
      }
      return false;
    });
    await page.goto(`${origin}/login`);
    await page.getByRole("button", { name: "忘记密码", exact: true }).click();
    await page.getByText(/当前未启用管理员恢复/).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "创建管理员", exact: true })
        .isDisabled(),
      true,
    );
    enabled = true;
    await page.reload();
    await page
      .getByLabel("独立管理员恢复凭据", { exact: true })
      .fill("synthetic-recovery-credential");
    await page.getByLabel("用户名", { exact: true }).fill("fixture-owner");
    await page
      .getByLabel("新密码", { exact: true })
      .fill("synthetic-strong-password-123");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).waitFor();
    assert.equal(
      data.observed.recovery.recovery_token,
      "synthetic-recovery-credential",
    );
    assert.equal(
      Object.keys(data.observed.recovery).some((key) =>
        /supabase|secret_key/.test(key),
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(localStorage).includes("synthetic-recovery"),
      ),
      false,
    );
  },
);
await check(
  "CVM-11",
  "Container discovery preserves evidence provenance and missing metrics",
  async (page, data) => {
    configure(data);
    await page.goto(
      `${origin}/admin/assets/66666666-6666-4666-8666-666666666666`,
    );
    await page
      .getByRole("heading", { name: "Knowledge Web Container", exact: true })
      .waitFor();
    const discovered = page.locator("section").filter({
      has: page.getByRole("heading", { name: "最近发现", exact: true }),
    });
    await discovered.getByText("外部报告", { exact: true }).waitFor();
    await discovered
      .getByText("CPU（采样周期平均）", { exact: true })
      .waitFor();
    assert.match(await discovered.innerText(), /待探针观测验证/);
    assert.match(await discovered.innerText(), /未知/);
    assert.doesNotMatch(await discovered.innerText(), /0\.0%/);
    await noOverflow(page);
    await screenshot(page, "desktop-container-evidence");
  },
);
for (const [device, width, appearance] of [
  ["desktop", 1280, "light"],
  ["mobile", 390, "dark"],
]) {
  await check(
    `CVM-12-${device}`,
    "Modern Monitor public grids preserve theme settings and render measured states",
    async (page, data) => {
      data.authenticated = false;
      data.settings = {
        ...data.settings,
        site_title: "CVM",
        site_subtitle: "示例基础设施 · 浏览器验证数据",
        site_logo_url: "/cvm-visual-fixture.svg",
        active_theme: "monitor",
      };
      await page.route("**/cvm-visual-fixture.svg", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="16" fill="#6e56cf"/><path d="M18 22h28M18 32h28M18 42h28" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="40" cy="22" r="3" fill="#bdb4fe"/><circle cx="26" cy="32" r="3" fill="#bdb4fe"/><circle cx="40" cy="42" r="3" fill="#bdb4fe"/></svg>',
        }),
      );
      const current = Date.now();
      const originalClient = data.clients[0];
      data.clients = [
        "Singapore · Edge",
        "Frankfurt · Core",
        "Tokyo · Services",
        "US · Backup",
      ].map((name, index) => ({
        ...originalClient,
        uuid: `node-${index}`,
        name,
        region: ["SG", "DE", "JP", "US"][index],
        group: index === 3 ? "备份与恢复" : "公开服务",
        tags: index === 3 ? "backup;private" : "production;personal",
        cpu_name: [
          "AMD EPYC 7B13",
          "Intel Xeon",
          "AMD EPYC 7543",
          "Intel Xeon",
        ][index],
        cpu_cores: [2, 4, 2, 2][index],
        mem_total: 4 * 1024 ** 3,
        disk_total: 80 * 1024 ** 3,
        swap_total: 1024 ** 3,
        price: [4, 7, 5, 2.5][index],
        billing_cycle: 30,
        currency: "$",
        expired_at: "2027-02-01T00:00:00Z",
        public_remark: [
          "网站与反向代理入口",
          "个人 API 与文档服务",
          "媒体与同步服务",
          "每日备份节点",
        ][index],
      }));
      const readings = Object.fromEntries(
        data.clients.map((client, index) => [
          client.uuid,
          {
            cpu: [12.6, 36.8, 7.4, 0][index],
            ram: [1.3, 2.1, 0.8, 1.1][index] * 1024 ** 3,
            ram_total: 4 * 1024 ** 3,
            disk: [24.3, 37.1, 12.6, 51.2][index] * 1024 ** 3,
            disk_total: 80 * 1024 ** 3,
            swap: 0,
            swap_total: 1024 ** 3,
            load: [0.15, 0.82, 0.12, 0.1][index],
            net_in: [262144, 1048576, 65536, 0][index],
            net_out: [131072, 524288, 32768, 0][index],
            net_total_up: 53 * 1024 ** 3,
            net_total_down: 78 * 1024 ** 3,
            connections: 112,
            connections_udp: 4,
            uptime: 1234567,
            time: new Date(current).toISOString(),
            lastReportTime: current - (index === 3 ? 15 * 60000 : 0),
          },
        ]),
      );
      const live = {
        online: data.clients.slice(0, 3).map((client) => client.uuid),
        data: Object.fromEntries(Object.entries(readings).slice(0, 3)),
        last_known: { "node-3": readings["node-3"] },
        clients: data.clients
          .slice(0, 3)
          .map((client) => ({
            uuid: client.uuid,
            name: client.name,
            lastReportTime: current,
          })),
        timestamp: current,
        count: 3,
        metadata_version: "cvm-visual-fixture",
      };
      const originalWebsite = data.websites[0];
      data.websites = [
        "Knowledge Hub",
        "Photos",
        "Personal API",
        "Git Services",
        "Media Library",
        "Infrastructure Status",
      ].map((name, index) => ({
        ...originalWebsite,
        id: index + 1,
        name,
        url: `https://${["docs", "photos", "api", "git", "media", "status"][index]}.example.invalid`,
        description: [
          "运维笔记、配置标准与日常维护 SOP。",
          "私人照片归档与家庭共享。",
          "为个人工作流提供统一 API。",
          "项目源码与部署记录入口。",
          "媒体资源与家庭播放服务。",
          "基础设施公开状态与维护公告。",
        ][index],
        category: ["博客", "存储", "API", "管理", "媒体", "工具"][index],
        tags: ["personal", index === 2 ? "API" : "self-hosted"],
        server_uuid: `node-${index % 3}`,
        deployment: index === 5 ? "Cloudflare Worker" : "Docker Compose",
        status: index === 4 ? "paused" : index === 2 ? "down" : "up",
        enabled: index !== 4,
        last_latency_ms: index === 4 ? null : [28, 42, 780, 36, 0, 19][index],
        last_checked_at: new Date(current).toISOString(),
        last_status_code: index === 2 ? 502 : 200,
        last_raw_status_code: index === 2 ? 502 : 200,
        checks:
          index === 4
            ? []
            : Array.from({ length: 36 }, (_, i) => ({
                checked_at: new Date(current - i * 120000).toISOString(),
                ok: !(index === 2 && i < 5),
                effective_status: index === 2 && i < 5 ? "down" : "up",
                latency_ms: [28, 42, 780, 36, 0, 19][index],
                source_type: "worker",
              })),
      }));
      data.handlers.push(async ({ path, json }) => {
        if (path === "/api/theme/manifest/monitor") {
          await json({ config: { dashboardBackgroundEnabled: false } });
          return true;
        }
        if (path === "/api/public/bootstrap") {
          await json({
            clients: data.clients,
            nodes: data.clients,
            settings: data.settings,
            live,
            metadata_version: "cvm-visual-fixture",
          });
          return true;
        }
        if (path === "/api/live/clients") {
          await json(live);
          return true;
        }
        return false;
      });
      await page.addInitScript(
        ({ appearance }) => {
          localStorage.setItem("cf-monitor-theme", appearance);
          localStorage.setItem("cf-monitor-display-theme", "monitor");
          localStorage.setItem("cf-monitor-display-theme-source", "local");
        },
        { appearance },
      );
      await page.goto(origin);
      await page
        .getByText("Singapore · Edge", { exact: true })
        .first()
        .waitFor();
      await page.locator(".node-card").first().waitFor();
      await noOverflow(page);
      assert.equal(
        await page.locator("html").getAttribute("data-monitor-theme"),
        "monitor",
      );
      await screenshot(page, `public-monitor-vps-${device}-${appearance}`);
      await page.goto(`${origin}/?view=websites`);
      await page
        .getByRole("button", { name: "查看 Knowledge Hub 详情", exact: true })
        .waitFor();
      await page
        .locator(".website-asset-dashboard.has-no-dashboard-background")
        .waitFor();
      assert.equal(await page.locator(".website-asset-card").count(), 6);
      await noOverflow(page);
      await screenshot(page, `public-monitor-websites-${device}-${appearance}`);
    },
    { width },
  );
}
await check(
  "CVM-13",
  "Theme preferences preview the unsaved target inside a script-disabled frame before explicit saving",
  async (page, data) => {
    const themes = ["monitor", "aurora"].map((short) => ({
      short,
      name: short === "monitor" ? "Monitor" : "Aurora",
      description: "浏览器验证主题",
      version: "1",
      author: "Fixture",
      preview_url: "",
      active: short === "monitor",
      deletable: false,
      configurable: true,
      config: { dashboardBackgroundEnabled: true },
      custom_css: "",
      manifest: { name: short, short, configuration: { data: [{ key: "dashboardBackgroundEnabled", name: "启用网站背景", type: "switch", default: true }] } },
    }));
    data.handlers.push(async ({ path, body, json }) => {
      if (path === "/api/admin/themes") {
        await json({ active_theme: "monitor", data: themes });
        return true;
      }
      if (path === "/api/admin/themes/preview") {
        await json({ short: body.short, config: body.config, css: body.custom_css });
        return true;
      }
      if (path === "/api/admin/themes/settings") {
        Object.assign(themes.find((theme) => theme.short === body.short), body);
        await json({ success: true });
        return true;
      }
      return false;
    });
    await page.addInitScript(() => {
      localStorage.setItem("cf-monitor-theme", "light");
      localStorage.setItem("cf-monitor-display-theme", "monitor");
    });
    await page.goto(`${origin}/admin/themes`);
    await page.getByRole("button", { name: "导出 Aurora 主题配置", exact: true }).waitFor();
    const downloadPending = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 Aurora 主题配置", exact: true }).click();
    const downloaded = await downloadPending;
    const stream = await downloaded.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const preferences = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(preferences.schema_version, 1);
    assert.equal(preferences.short, "aurora");
    preferences.config.dashboardBackgroundEnabled = false;
    preferences.custom_css = '.node-card { border-radius: 27px !important; }\n/* </style><script>window.__themePreviewExecuted=true</script> */';
    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: "aurora.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(preferences)) });
    await page.getByRole("dialog", { name: "配置主题", exact: true }).waitFor();
    assert.equal(data.calls.filter((call) => call.path === "/api/admin/themes/settings").length, 0);
    await page.getByRole("button", { name: "预览", exact: true }).click();
    const preview = page.frameLocator('iframe[title="前台主题预览"]');
    await preview.locator(".node-card").waitFor();
    await preview.locator(".website-asset-dashboard.has-no-dashboard-background").waitFor();
    assert.equal(await preview.locator("html").getAttribute("data-monitor-theme"), "aurora");
    assert.equal(await preview.locator("html").getAttribute("data-theme-appearance"), "light");
    assert.equal(await preview.locator(".node-card").evaluate((element) => getComputedStyle(element).borderRadius), "27px");
    assert.equal(await preview.locator("script").count(), 0);
    assert.equal(await page.evaluate(() => window.__themePreviewExecuted), undefined);
    assert.equal(await page.locator('iframe[title="前台主题预览"]').getAttribute("sandbox"), "allow-same-origin");
    assert.equal(await page.locator("html").getAttribute("data-monitor-theme"), "monitor");
    assert.equal(data.calls.filter((call) => call.path === "/api/admin/themes/settings").length, 0);
    assert.equal(data.calls.some((call) => call.path === "/api/theme/active.css" && call.search.includes("preview=")), false);
    await page.locator('iframe[title="前台主题预览"]').scrollIntoViewIfNeeded();
    await screenshot(page, "desktop-theme-preview");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const saved = data.calls.filter((call) => call.path === "/api/admin/themes/settings");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].body.short, "aurora");
    assert.equal(saved[0].body.config.dashboardBackgroundEnabled, false);
    assert.equal(saved[0].body.custom_css, preferences.custom_css);
    assert.equal(data.calls.some((call) => call.path === "/api/admin/themes/set"), false);
  },
);
await writeFile(
  resolve(output, "README.txt"),
  "Screenshots use synthetic intercepted API data against current Vite source. They do not show or modify production infrastructure.\n",
);
await finish();
