import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';

const tabs = [
  { to: '/', label: 'ホーム', d: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10' },
  { to: '/review', label: '復習', d: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4' },
  { to: '/cards', label: 'カード', d: 'M4 7h16v12H4zM4 7l2-3h12l2 3' },
  { to: '/practice', label: '問題', d: 'M9 7h8M9 12h8M9 17h5M5 7h.01M5 12h.01M5 17h.01' },
  { to: '/materials', label: '資料', d: 'M6 4h8l4 4v12H6zM14 4v4h4' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { pathname } = useLocation();

  return (
    <div className="app">
      <header className="topbar">
        <strong style={{ color: 'var(--accent)' }}>SC</strong>
        <h1>情報処理安全確保支援士 学習</h1>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={signOut}>
          ログアウト
        </button>
      </header>

      <main className="main">{children}</main>

      <nav className="tabbar">
        {tabs.map((t) => {
          const active =
            t.to === '/'
              ? pathname === '/'
              : pathname === t.to || pathname.startsWith(t.to + '/');
          return (
            <NavLink key={t.to} to={t.to} className={active ? 'active' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={t.d} />
              </svg>
              {t.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
