import { Surface } from '../../shared/ui';

export function HomePage() {
  return (
    <div className="home-page" data-home-page="shell">
      <div className="home-page__frame">
        <nav className="home-nav" data-home-nav="top">
          <div className="home-nav__brand">
            <span className="home-nav__logo">agent-co</span>
            <span className="home-nav__tag">协作式 AI 工作台</span>
          </div>
          <div className="home-nav__links">
            <a className="home-nav__link" href="/chat.html">进入控制台</a>
            <a className="home-nav__link" href="/admin.html">管理入口</a>
          </div>
        </nav>

        <header className="home-hero" data-home-hero="intro">
          <div className="home-hero__copy">
            <p className="home-hero__eyebrow">为开发者和小团队打磨</p>
            <h1 className="home-hero__title">多智能体协作，从提示到交付保持清晰。</h1>
            <p className="home-hero__lead">
              把会话、执行记录、工具链与任务上下文集中在同一视窗里，让每一次推理都有来龙去脉。
              从单人原型到多人交付，都能保持节奏。
            </p>
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
                href="/admin.html"
              >
                查看协作配置
              </a>
            </div>
            <div className="home-hero__meta">
              <div className="home-hero__meta-item">内容优先 · 轻量协作</div>
              <div className="home-hero__meta-item">可追踪 · 可回放 · 可复用</div>
            </div>
          </div>

          <Surface className="home-workflow" data-home-workflow="preview" tone="elevated">
            <div className="home-workflow__header">
              <div>
                <p className="home-workflow__title">实时工作流</p>
                <p className="home-workflow__subtitle">把推理与执行状态放在一条清晰时间线里</p>
              </div>
              <span className="home-workflow__badge">Live</span>
            </div>
            <div className="home-workflow__steps">
              <div className="home-workflow__step">
                <span className="home-workflow__step-index">01</span>
                <div>
                  <p className="home-workflow__step-title">定义任务</p>
                  <p className="home-workflow__step-desc">用自然语言说明目标与边界。</p>
                </div>
              </div>
              <div className="home-workflow__step">
                <span className="home-workflow__step-index">02</span>
                <div>
                  <p className="home-workflow__step-title">调度智能体</p>
                  <p className="home-workflow__step-desc">分配角色，观察各自的行动轨迹。</p>
                </div>
              </div>
              <div className="home-workflow__step">
                <span className="home-workflow__step-index">03</span>
                <div>
                  <p className="home-workflow__step-title">回看结果</p>
                  <p className="home-workflow__step-desc">同步时间线、状态与产物输出。</p>
                </div>
              </div>
            </div>
            <div className="home-workflow__log">
              <span className="home-workflow__log-label">agent-co.runtime</span>
              <code>task: "spec → plan → ship" · status: stable</code>
            </div>
          </Surface>
        </header>

        <section className="home-section" data-home-section="capabilities">
          <div className="home-section__eyebrow">核心体验</div>
          <div className="home-section__grid">
            <div className="home-section__item">
              <h2 className="home-section__title">内容驱动的协作流程</h2>
              <p className="home-section__desc">
                不用堆叠卡片，也不需要重复解释上下文。对话、结果、事件与附件保持在同一视图，阅读优先。
              </p>
              <ul className="home-section__list">
                <li>对话与动作同屏呈现</li>
                <li>状态变化清晰可见</li>
                <li>信息层级稳定一致</li>
              </ul>
            </div>
            <div className="home-section__item">
              <h2 className="home-section__title">适合小团队的可控节奏</h2>
              <p className="home-section__desc">
                每个会话都带着任务历史与参与者标签，小团队能够快速对齐进度，减少上下文切换。
              </p>
              <ul className="home-section__list">
                <li>会话记录可追溯</li>
                <li>协作角色可配置</li>
                <li>状态同步更可靠</li>
              </ul>
            </div>
            <div className="home-section__item">
              <h2 className="home-section__title">开发者友好的控制台语义</h2>
              <p className="home-section__desc">
                兼容命令行与工作台习惯，把工具链和模型调用留在清晰的系统边界内，便于迭代。
              </p>
              <ul className="home-section__list">
                <li>API 与 WebSocket 统一</li>
                <li>调试信息集中管理</li>
                <li>部署与本地环境一致</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="home-section" data-home-section="trust">
          <div className="home-section__eyebrow">适合你使用的理由</div>
          <div className="home-trust">
            <div className="home-trust__item">
              <h3 className="home-trust__title">从单人到协作</h3>
              <p className="home-trust__desc">单人原型也能快速切换为团队协作，不用替换工具。</p>
            </div>
            <div className="home-trust__item">
              <h3 className="home-trust__title">稳定的输入输出</h3>
              <p className="home-trust__desc">对话、工作流、产物输出都有稳定的结构，便于复盘与分享。</p>
            </div>
            <div className="home-trust__item">
              <h3 className="home-trust__title">轻量但可靠</h3>
              <p className="home-trust__desc">不靠浮夸视觉取胜，交互克制，让你专注于任务本身。</p>
            </div>
          </div>
        </section>

        <footer className="home-footer">
          <div className="home-footer__copy">agent-co · 为开发者与小团队打造的 AI 协作控制台</div>
          <div className="home-footer__links">
            <a href="/chat.html">进入聊天</a>
            <a href="/admin.html">管理入口</a>
            <a href="/deps-monitor.html">系统监控</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
