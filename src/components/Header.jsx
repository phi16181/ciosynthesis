import { useEffect, useState } from "react";

export default function Header() {
  const [user, setUser] = useState(null); // { userDetails } | null

  useEffect(() => {
    fetch("/.auth/me")
      .then((r) => r.json())
      .then((data) => setUser(data?.clientPrincipal ?? null))
      .catch(() => setUser(null));
  }, []);

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
        <div className="header__right">
          {user && (
            <span className="header__user">
              {user.userDetails}
              <a className="header__signout" href="/.auth/logout?post_logout_redirect_uri=/">
                Sign out
              </a>
            </span>
          )}

        </div>
      </div>
    </header>
  );
}
