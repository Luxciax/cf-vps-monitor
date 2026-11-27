import { useCallback, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import NodeCard from './NodeCard';
import type { PublicBootstrapPayload } from '../utils/publicBootstrap';
import { useTheme } from '../contexts/ThemeContext';
import { normalizeDisplayTheme } from '../utils/displayTheme';
import { normalizeDashboardBackground } from './WebsiteMonitorList';

const PREVIEW_DOCUMENT = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https: data:; font-src \'self\' data:; script-src \'none\'; base-uri \'none\'; form-action \'none\'"></head><body><div id="theme-preview-root"></div></body></html>';

/** Trusted parent React renders public components into a document that never runs uploaded scripts. */
export default function ThemePreviewFrame({ bootstrap, css, themeShort, config }: { bootstrap: PublicBootstrapPayload; css: string; themeShort: string; config: Record<string, unknown> }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const rootRef = useRef<Root | null>(null);
  const documentRef = useRef<Document | null>(null);
  const { isDark } = useTheme();
  const displayTheme = normalizeDisplayTheme(themeShort);

  const updatePreview = useCallback(() => {
    const previewDocument = frameRef.current?.contentDocument;
    const container = previewDocument?.getElementById('theme-preview-root');
    if (!previewDocument || !container) return;
    if (documentRef.current !== previewDocument) {
      rootRef.current?.unmount();
      documentRef.current = previewDocument;
      for (const source of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
        if (source.id === 'cf-monitor-active-theme-css' || source.id === 'cf-monitor-theme-css-preview') continue;
        previewDocument.head.appendChild(source.cloneNode(true));
      }
      const customStyle = previewDocument.createElement('style');
      customStyle.id = 'theme-preview-custom-css';
      previewDocument.head.appendChild(customStyle);
      previewDocument.body.style.margin = '0';
      rootRef.current = createRoot(container);
    }
    previewDocument.documentElement.className = isDark ? 'dark' : 'light';
    previewDocument.documentElement.setAttribute('data-theme-appearance', isDark ? 'dark' : 'light');
    previewDocument.documentElement.setAttribute('data-monitor-theme', displayTheme);
    const style = previewDocument.getElementById('theme-preview-custom-css');
    if (style) style.textContent = css;
    const clients = (bootstrap.clients || bootstrap.nodes || []).slice(0, 6);
    const online = new Set(bootstrap.live?.online || []);
    const background = normalizeDashboardBackground(config);
    rootRef.current?.render(
      <MemoryRouter>
        <Theme appearance={isDark ? 'dark' : 'light'} accentColor={displayTheme === 'aurora' ? 'purple' : 'violet'} grayColor="slate" scaling="100%" radius="medium" panelBackground="translucent">
          <div className="layout">
            <main className="main-content">
              <nav className="nav-bar"><div className="nav-brand-title">{bootstrap.settings?.site_title || 'CF VPS Monitor'}</div></nav>
              <div className="monitor-dashboard-page" style={{ padding: 16 }}>
                <div className="node-card-grid">
                  {clients.map(client => <NodeCard key={client.uuid} client={client} online={online.has(client.uuid)} live={bootstrap.live?.data?.[client.uuid]} includeHidden={false} />)}
                </div>
                {clients.length === 0 && <p>暂无公开服务器</p>}
              </div>
              <section className={`website-asset-dashboard${background.enabled ? ' has-dashboard-background' : ' has-no-dashboard-background'}`} style={{ minHeight: 180 }} aria-label="网站背景预览">
                {background.enabled && <>
                  <div className="website-dashboard-background" aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(background.image)})`, backgroundPosition: background.position, backgroundSize: background.size, filter: background.blur ? `blur(${background.blur}px) scale(1.03)` : undefined }} />
                  <div className="website-dashboard-background-overlay" aria-hidden="true" style={{ backgroundColor: `rgba(5, 9, 17, ${background.overlay})` }} />
                </>}
                <div className="website-asset-dashboard-content">
                  <h2>网站背景预览</h2>
                  <p>当前编辑的背景、遮罩和模糊设置。保存后应用到公开网站页面。</p>
                </div>
              </section>
            </main>
          </div>
        </Theme>
      </MemoryRouter>,
    );
  }, [bootstrap, css, config, displayTheme, isDark]);

  useEffect(() => { updatePreview(); }, [updatePreview]);
  useEffect(() => () => {
    const root = rootRef.current;
    rootRef.current = null;
    documentRef.current = null;
    queueMicrotask(() => root?.unmount());
  }, []);

  return <iframe ref={frameRef} title="前台主题预览" sandbox="allow-same-origin" srcDoc={PREVIEW_DOCUMENT} onLoad={updatePreview} style={{ width: '100%', height: 440, border: '1px solid var(--gray-6)', borderRadius: 8 }} />;
}
