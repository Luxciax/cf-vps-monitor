import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { productionModule } from "./helpers/production-module.mjs";
const require = createRequire(new URL("../package.json", import.meta.url));
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const markdown = productionModule("src/infrastructure/Markdown.tsx");

test("knowledge preview rejects executable links and preserves raw HTML as inert text", () => {
  for (const target of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.invalid/a",
    "/\\evil.invalid/a",
    "java\u0000script:alert(1)",
  ])
    assert.equal(markdown.safeDocumentLink(target), null);
  assert.equal(
    markdown.safeDocumentLink("https://docs.example.invalid/path"),
    "https://docs.example.invalid/path",
  );
  const html = renderToStaticMarkup(
    React.createElement(markdown.default, {
      content:
        "# SOP\n\n<script>window.owned=true</script>\n\n[run](javascript:alert)\n\n```sh\necho safe\n```",
    }),
  );
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<pre/);
});

test("missing heartbeat history remains unknown and null latency is never zero", () => {
  const module = productionModule("src/components/WebsiteHeartbeatBar.tsx", {
    react: {
      ...React,
      useLayoutEffect: () => {},
      useRef: () => ({ current: null }),
      useState: () => [null, () => {}],
    },
  });
  const html = renderToStaticMarkup(
    module.default({
      checks: [
        { checked_at: "2026-11-27T00:00:00Z", ok: true, latency_ms: null },
      ],
      max: 8,
      fallbackStatus: "up",
    }),
  );
  assert.equal(
    (html.match(/website-heartbeat-segment is-up/g) || []).length,
    1,
  );
  assert.equal(
    (html.match(/website-heartbeat-segment is-empty/g) || []).length,
    7,
  );
  assert.equal(html.includes("is-inferred"), false);
  assert.equal(html.includes("0ms"), false);
  assert.match(html, /延迟未知/);
});
