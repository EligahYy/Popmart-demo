import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** 任何渲染异常都不应变成白屏；数据仍在本机，刷新即可继续。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 只记录错误类型与堆栈，不输出订单、金额或备注
    console.error('render-error', error.name, info.componentStack?.split('\n').slice(0, 3).join(' '));
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="boot">
          <h1 className="page__title">页面出了点问题</h1>
          <p className="page__hint">
            你的收藏与账本仍保存在本机，没有被删除。可以重新加载继续使用。
          </p>
          <button type="button" className="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
