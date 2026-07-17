export default function Header() {
  return (
    <header className="header">
      <div className="header__inner">
        <div className="header__brand">
          <img src="/gt-logo.png" alt="Georgia Tech" className="header__logo" />
          <div className="header__divider" aria-hidden="true" />
          <div className="header__wordmark">
            <span className="header__title">CIOSynthesis</span>
            <span className="header__subtitle">CIOS report analysis</span>
          </div>
        </div>
        <span className="header__badge">
          <span className="header__badge-dot" />
          gpt-4o-mini
        </span>
      </div>
    </header>
  );
}
