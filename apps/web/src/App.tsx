import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { RuntimeProvider, useRuntime } from './app/RuntimeProvider.js';
import { ErrorBoundary } from './app/ErrorBoundary.js';
import { AddPanel } from './features/add/AddPanel.js';
import { CollectionPage } from './features/collection/CollectionPage.js';
import { HomePage } from './features/home/HomePage.js';
import { LedgerPage } from './features/ledger/LedgerPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { applyUpdate } from './app/pwa.js';
import { usePersonalMedia } from './media/usePersonalMedia.js';

function NotFoundPage() {
  return (
    <main className="page">
      <h1 className="page__title">页面不存在</h1>
      <p className="page__hint">请返回小窝。</p>
    </main>
  );
}

function Shell() {
  const { db } = useRuntime();
  const [sharedConnected, setSharedConnected] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updateReady, setUpdateReady] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const { key: locationKey } = useLocation();
  // A route change also picks up uploads made in local mode. Loaded URLs stay
  // in the shell, so returning home does not rebuild the media from storage.
  const mediaRefresh = `${db.shared ? '' : locationKey}:${online}`;
  const poster = usePersonalMedia('greetingPoster', mediaRefresh);
  const idle = usePersonalMedia('idle', mediaRefresh);
  const greeting = usePersonalMedia('greeting', mediaRefresh, poster.settled);

  useEffect(() => {
    const connection = (event: Event) => setSharedConnected((event as CustomEvent<boolean>).detail);
    window.addEventListener('shared:connection', connection);
    return () => window.removeEventListener('shared:connection', connection);
  }, []);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    function onNeedRefresh() {
      setUpdateReady(true);
    }
    function onOfflineReady() {
      setToast('应用已可离线打开');
    }
    window.addEventListener('pwa:need-refresh', onNeedRefresh);
    window.addEventListener('pwa:offline-ready', onOfflineReady);
    return () => {
      window.removeEventListener('pwa:need-refresh', onNeedRefresh);
      window.removeEventListener('pwa:offline-ready', onOfflineReady);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <>
      {db.shared ? (
        <div className="shared-banner" role="status">
          {sharedConnected ? '共享展示空间 · 修改会对所有访客可见' : '共享空间暂时断开 · 正在重连，保存修改需要联网'}
        </div>
      ) : null}
      <Routes>
        <Route
          path="/"
          element={<HomePage
            refreshKey={refreshKey}
            restMedia={poster.media ?? idle.media}
            greeting={greeting}
            showPlaceholder={poster.settled && idle.settled && greeting.settled &&
              !poster.hasAsset && !idle.hasAsset && !greeting.hasAsset}
          />}
        />
        <Route path="/ip/:ipId" element={<CollectionPage />} />
        <Route path="/ledger" element={<LedgerPage refreshKey={refreshKey} />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <nav className="tabbar" aria-label="主导航">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `tabbar__link${isActive ? ' tabbar__link--active' : ''}`}
        >
          我的小窝
        </NavLink>
        <button
          type="button"
          className="tabbar__add"
          onClick={() => setAddOpen(true)}
          aria-label="欢迎新宝宝"
        >
          ＋
        </button>
        <NavLink
          to="/ledger"
          className={({ isActive }) => `tabbar__link${isActive ? ' tabbar__link--active' : ''}`}
        >
          捂一下钱包？
        </NavLink>
      </nav>

      {!online ? (
        <div className="offline-banner" role="status">
          {db.shared ? '当前离线：已加载内容仍可查看，保存修改需要联网' : '当前离线：已保存的数据仍可查看，导入新系列需要联网'}
        </div>
      ) : null}

      {updateReady ? (
        <div className="update-banner" role="alert">
          <span>新版本已就绪</span>
          <button type="button" className="link-button" onClick={() => void applyUpdate()}>
            立即更新
          </button>
          <button type="button" className="icon-button" aria-label="稍后更新" onClick={() => setUpdateReady(false)}>
            ✕
          </button>
        </div>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}

      {addOpen ? (
        <AddPanel
          onClose={() => setAddOpen(false)}
          refreshKey={refreshKey}
          onSaved={(message) => {
            setRefreshKey((value) => value + 1);
            setToast(message);
          }}
          onToast={(message) => setToast(message)}
        />
      ) : null}

    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <RuntimeProvider>
        <Shell />
      </RuntimeProvider>
    </ErrorBoundary>
  );
}
