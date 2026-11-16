import { registerSW } from 'virtual:pwa-register';

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

let updateServiceWorker: UpdateServiceWorker | null = null;

/** 只在生产构建注册；开发态由 Vite HMR 接管。 */
export function initPWA(): void {
  if (import.meta.env.DEV) return;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event('pwa:need-refresh'));
    },
    onOfflineReady() {
      window.dispatchEvent(new Event('pwa:offline-ready'));
    },
  });
}

export async function applyUpdate(): Promise<void> {
  await updateServiceWorker?.(true);
}
