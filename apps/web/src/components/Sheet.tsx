import { useEffect, useId, useRef, type ReactNode } from 'react';

/** 同时可能叠多个面板；Esc / 返回键只关最上层。 */
const sheetStack: string[] = [];

/**
 * 程序化关闭时会主动 history.back()，由此产生的 popstate 不应再关掉下一层。
 * 用一个很短的时间窗吞掉这次事件。
 */
let suppressPopUntil = 0;

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const sheetId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef<HTMLElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    sheetStack.push(sheetId);
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const marker = `mp-sheet:${sheetId}`;
    window.history.pushState({ ...(window.history.state ?? {}), mpSheet: marker }, '');

    const isTop = () => sheetStack[sheetStack.length - 1] === sheetId;

    function onPopState() {
      if (performance.now() < suppressPopUntil) return;
      if (!isTop()) return;
      closeRef.current();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !isTop()) return;
      event.stopImmediatePropagation();
      closeRef.current();
    }

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown, true);

    const frame = window.requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      target?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown, true);

      const index = sheetStack.lastIndexOf(sheetId);
      if (index >= 0) sheetStack.splice(index, 1);

      // 只在浏览器历史仍停留在本面板时回退，避免把下层一起关掉
      if (window.history.state && window.history.state.mpSheet === marker) {
        suppressPopUntil = performance.now() + 400;
        window.history.back();
      }
      previouslyFocused.current?.focus?.();
    };
  }, [sheetId]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet__header">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
