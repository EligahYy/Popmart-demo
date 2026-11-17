import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** 渲染错误不清空数据，提供重新加载入口。 */
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
            此页面错误不会清空已保存的收藏与账本。可以重新加载继续使用。
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
