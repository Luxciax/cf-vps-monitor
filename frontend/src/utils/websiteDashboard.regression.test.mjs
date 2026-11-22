import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const listSource = readFileSync(new URL('../components/WebsiteMonitorList.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../components/website/website-assets.css', import.meta.url), 'utf8');

assert.match(listSource, /backgroundColor:\\s*`rgba\\(/, 'overlay opacity must use backgroundColor so CSS gradient layers survive');
assert.doesNotMatch(listSource, /style=\\{\\{\\s*background:\\s*`rgba\\(/, 'inline background shorthand must not replace overlay gradients');

const dashboardBlock = cssSource.match(/\\.website-dashboard-background,\\s*\\.website-dashboard-background-overlay\\s*\\{([^}]+)\\}/s)?.[1] || '';
assert.match(dashboardBlock, /position:\\s*fixed;/, 'website dashboard background must stay viewport-sized on long dashboards');
assert.match(dashboardBlock, /inset:\\s*64px 0 0;/, 'desktop background must start below the sticky navbar');

const rootBlock = cssSource.match(/\\.website-asset-dashboard\\s*\\{([^}]+)\\}/s)?.[1] || '';
assert.match(rootBlock, /overflow:\\s*visible;/, 'dashboard must not clip the fixed viewport background layer');

assert.match(cssSource, /@media[\\s\\S]*inset:\\s*104px 0 0;/, 'mobile background must start below the taller navbar');

assert.match(cssSource, /\\.website-asset-status\\.is-up\\s*\\{\\s*color:/, 'healthy status text must have an explicit visible color');
assert.match(cssSource, /\\.website-asset-status\\.is-down\\s*\\{\\s*color:/, 'down status text must have an explicit visible color');

console.log('website dashboard background/status regressions passed');
