import { Surface } from '../../shared/ui';
import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';
import { resolveAdminPageUrl } from '../../shared/config/admin-url';
import { ThemeToggle } from '../../shared/theme/theme';

export function HomePage() {
  const adminPageUrl = resolveAdminPageUrl({
    config: getMergedRuntimeConfig(),
    location: typeof window === 'undefined' ? undefined : window.location
  });

  return (
    <div className="home-page" data-home-page="shell">
      <div className="home-page__frame">
        <nav className="home-nav" data-home-nav="top">
          <div className="home-nav__brand">
            <span className="home-nav__logo">agent-co</span>
          </div>
          <div className="home-nav__actions">
            <ThemeToggle />
            <div className="home-nav__links">
              <a className="home-nav__link" href="/chat.html">进入控制台</a>
              <a className="home-nav__link" href={adminPageUrl}>管理入口</a>
            </div>
          </div>
        </nav>

        <header className="home-hero" data-home-hero="intro">
          <div className="home-hero__copy">
            <h1 className="home-hero__title">开始协作。</h1>
            <div className="home-hero__actions">
              <a
                className="ui-button home-hero__button"
                data-variant="primary"
                data-home-cta="primary"
                href="/chat.html"
              >
                立即开始聊天
              </a>
              <a
                className="ui-button home-hero__button"
                data-variant="secondary"
                data-home-cta="secondary"
                href={adminPageUrl}
              >
                管理
              </a>
            </div>
          </div>

          <Surface className="home-workflow" data-home-workflow="preview" tone="elevated">
            <div className="home-workflow__header">
              <div>
                <p className="home-workflow__title">Workflow</p>
              </div>
              <span className="home-workflow__badge">Live</span>
            </div>
            <div className="home-workflow__log">
              <span className="home-workflow__log-label">agent-co.runtime</span>
              <code>task: "spec → plan → ship" · status: stable</code>
            </div>
          </Surface>
        </header>
      </div>
    </div>
  );
}
