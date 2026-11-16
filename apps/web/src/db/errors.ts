/** 把底层错误转成用户能理解的一句话。 */
export function describeError(error: unknown, fallback = '操作失败，请重试'): string {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return '本机存储空间不足，请先导出备份或清理空间';
    }
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'MAINTENANCE') return '数据正在恢复中，请稍后再试';
    if (code === 'IDEMPOTENCY_CONFLICT') return '这次提交与上一次内容不一致，请重新打开表单';
    return error.message.trim() === '' ? fallback : error.message;
  }
  return fallback;
}
