import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { getOwnedIps, getSpaceName, type OwnedIpView } from '../../db/queries.js';
import { StyleImage } from '../../components/StyleImage.js';
import { usePersonalMedia } from '../../media/usePersonalMedia.js';
import { chooseCover, sessionSeed } from '../../domain/ipCover.js';
import { Cloud, Flower, Shelf } from './Decor.js';
import { GreetingPlayer } from './GreetingPlayer.js';

export function HomePage({ refreshKey }: { refreshKey: number }) {
  const { db, datasetId, sharedVersion } = useRuntime();
  const [views, setViews] = useState<OwnedIpView[] | null>(null);
  const [spaceName, setSpaceName] = useState('红彤彤收纳');
  const [greeting, setGreeting] = useState(false);
  const [showInstallHint, setShowInstallHint] = useState(
    () => localStorage.getItem('mp-install-dismissed') !== '1',
  );
  const idleMedia = usePersonalMedia('idle', refreshKey);
  const greetingPoster = usePersonalMedia('greetingPoster', refreshKey);
  const greetingVideo = usePersonalMedia('greeting', refreshKey);
  const restMedia = greetingPoster ?? idleMedia;
  const [greetingActive, setGreetingActive] = useState(false);
  const finishGreeting = useCallback(() => setGreetingActive(false), []);

  useEffect(() => {
    let cancelled = false;
    getOwnedIps(db, datasetId).then((next) => {
      if (!cancelled) setViews(next);
    });
    getSpaceName(db, datasetId).then((name) => {
      if (!cancelled) setSpaceName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, sharedVersion, refreshKey]);

  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(() => setGreeting(false), 2200);
    return () => window.clearTimeout(timer);
  }, [greeting]);

  const seed = useMemo(() => sessionSeed(sessionStorage, Date.now()), []);

  const covers = useMemo(() => {
    const map = new Map<string, { url: string; assetId: string | null } | null>();
    for (const view of views ?? []) {
      const last = localStorage.getItem(`mp-last-cover:${view.ip.id}`);
      const chosen = chooseCover(view.ip.id, view.covers, seed, last);
      if (chosen) localStorage.setItem(`mp-last-cover:${view.ip.id}`, chosen.url);
      map.set(view.ip.id, chosen);
    }
    return map;
  }, [views, seed]);

  const totals = useMemo(() => {
    const rows = views ?? [];
    return {
      ip: rows.length,
      styles: rows.reduce((total, row) => total + row.styleCount, 0),
      held: rows.reduce((total, row) => total + row.heldTotal, 0),
    };
  }, [views]);

  return (
    <main className="page page--home">
      <header className="home-top">
        <span className="home-top__brand">MY POPMART</span>
        <NavLink to="/settings" className="home-top__link">
          设置
        </NavLink>
      </header>

      <section className={`home-hero${greeting ? ' home-hero--greet' : ''}`} aria-label="我的主页">
        <div className="home-hero__intro">
          <p className="home-hero__eyebrow">我的小窝</p>
          <h1 className="home-hero__title">{spaceName}</h1>
          {views !== null && views.length > 0 ? (
            <div className="home-stats">
              <span className="home-stat home-stat--rose">{totals.held} 只</span>
              <span className="home-stat home-stat--sage">{totals.ip} 个 IP</span>
              <span className="home-stat home-stat--lavender">{totals.styles} 款</span>
            </div>
          ) : (
            <p className="home-hero__meta">点下面的 ＋ 迎来第一位宝宝</p>
          )}
        </div>

        <div className="home-scene">
          <Cloud className="home-decor home-decor--cloud-a" />
          <Cloud className="home-decor home-decor--cloud-b" />
          <Flower className="home-decor home-decor--flower-a" petal="#f6b7c6" center="#f2d178" />
          <Flower className="home-decor home-decor--flower-b" petal="#c9c2ee" center="#f4cf7c" />
          <Flower className="home-decor home-decor--flower-c" petal="#d8e3b2" center="#f0a86b" />

          <Shelf className="home-scene__shelf" />
          <div className="home-scene__veil" aria-hidden="true" />

          {restMedia ? (
            <button
              type="button"
              className="home-figure"
              onClick={() => {
                setGreeting(true);
                if (greetingVideo) setGreetingActive(true);
              }}
              aria-label="和我的形象打招呼"
            >
              <span className="home-figure__frame">
                <span className="home-figure__zoom">
                  {greetingVideo ? (
                    <GreetingPlayer
                      url={greetingVideo.url}
                      playing={greetingActive}
                      onFinished={finishGreeting}
                    />
                  ) : restMedia ? (
                    restMedia.kind === 'video' ? (
                      <video className="home-figure__media" src={restMedia.url} autoPlay muted loop playsInline />
                    ) : (
                      <img className="home-figure__media" src={restMedia.url} alt="我的形象" />
                    )
                  ) : null}
                </span>
              </span>
            </button>
          ) : (
            <div className="home-figure-placeholder">
              在设置里
              <br />
              放上你的形象
            </div>
          )}
        </div>
      </section>

      {showInstallHint ? (
        <div className="install-hint install-hint--slim">
          <span>添加到主屏幕，像 App 一样打开</span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              localStorage.setItem('mp-install-dismissed', '1');
              setShowInstallHint(false);
            }}
          >
            知道了
          </button>
        </div>
      ) : null}

      {views !== null && views.length === 0 ? (
        <p className="home-empty-hint">
          还没有宝宝入住。
          <br />
          点底部中间的 ＋，导入你的第一个系列。
        </p>
      ) : null}

      {views !== null && views.length > 0 ? (
        <>
          <h2 className="home-section-title">我的 IP</h2>
          <section className="ip-grid" aria-label="已拥有的 IP">
            {views.map((view) => (
              <Link key={view.ip.id} to={`/ip/${view.ip.id}`} className="ip-card">
                <div className="ip-card__media">
                  <StyleImage
                    url={covers.get(view.ip.id)?.url ?? view.coverUrl}
                    assetId={covers.get(view.ip.id)?.assetId ?? view.coverAssetId}
                    alt={view.ip.displayName}
                    placeholder="暂无图片"
                    width={768}
                  />
                  <span className="ip-card__count">{view.heldTotal}</span>
                </div>
                <div className="ip-card__body">
                  <h3 className="ip-card__title">{view.ip.displayName}</h3>
                  <p className="list__meta">
                    {view.seriesCount} 个系列 · {view.styleCount} 款
                  </p>
                </div>
              </Link>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
