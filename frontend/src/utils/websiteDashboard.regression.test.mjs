import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const listSource = readFileSync(new URL('../components/WebsiteMonitorList.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../components/website/website-assets.css', import.meta.url), 'utf8');

assert.match(listSource, /backgroundColor:\\s*`rgba\\(/, 'overlay opacity must use backgroundColor so CSS gradient layers survive');
assert.doesNotMatch(listSource, /style=\\{\\{\\s*background:\\s*`rgba\\(/, 'inline background shorthand must not replace overlay gradients');

const dashboardBlock = cssSource.match(/\\.website-dashboard-background,\\s*\\.website-dashboard-background-overlay\\s*\\{([^}]+)\\}/s)?.[1] || '';
assert.match(dashboardBlock, /position:\\s*absolute;/, 'website dashboard background must be scoped to the dashboard');
assert.doesNotMatch(dashboardBlock, /position:\\s*fixed;/, 'website dashboard background must not cover the whole app viewport');

const rootBlock = cssSource.match(/\\.website-asset-dashboard\\s*\\{([^}]+)\\}/s)?.[1] || '';
assert.match(rootBlock, /overflow:\\s*hidden;/, 'dashboard must clip blurred/scaled background edges');

assert.match(cssSource, /\\.website-asset-status\\.is-up\\s*\\{\\s*color:/, 'healthy status text must have an explicit visible color');
assert.match(cssSource, /\\.website-asset-status\\.is-down\\s*\\{\\s*color:/, 'down status text must have an explicit visible color');

console.log('website dashboard background/status regressions passed');
