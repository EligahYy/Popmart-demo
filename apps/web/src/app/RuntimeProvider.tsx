import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntime, type Runtime } from './runtime.js';

const RuntimeContext = createContext<Runtime | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRuntime()
      .then((value) => {
        if (!cancelled) setRuntime(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '本机数据库初始化失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runtime?.db.shared) return;
    const { db } = runtime;
    const update = (event: Event) => {
      const { datasetId } = (event as CustomEvent<{ datasetId: string }>).detail;
      setRuntime((previous) => previous ? { ...previous, datasetId, sharedVersion: (previous.sharedVersion ?? 0) + 1 } : previous);
    };
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void db.shared?.refresh().then(() => {
        window.dispatchEvent(new CustomEvent('shared:connection', { detail: true }));
      }).catch(() => {
        window.dispatchEvent(new CustomEvent('shared:connection', { detail: false }));
      });
    };
    window.addEventListener('shared:data', update);
    window.addEventListener('focus', refresh);
    const interval = window.setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('shared:data', update);
      window.removeEventListener('focus', refresh);
      window.clearInterval(interval);
    };
  }, [runtime?.db]);

  if (error) {
    return (
      <div className="boot">
        <p>{error}</p>
        <button type="button" className="button" onClick={() => window.location.reload()}>重新连接</button>
      </div>
    );
  }

  if (!runtime) {
    return <div className="boot">正在打开你的小窝…</div>;
  }

  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeProvider is missing');
  return runtime;
}
