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

  if (error) {
    return (
      <div className="boot">
        <p>{error}</p>
        <p className="page__hint">请检查浏览器是否允许本机存储后重试。</p>
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
