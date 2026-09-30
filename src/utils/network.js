export function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export class OfflineError extends Error {
  constructor(context = '') {
    super('设备处于离线状态');
    this.name = 'OfflineError';
    this.context = context;
    this.isExpectedOffline = true;
  }
}

export function assertOnline(context = '') {
  if (isBrowserOffline()) {
    throw new OfflineError(context);
  }
}

export function isOfflineError(error) {
  return error instanceof OfflineError || error?.isExpectedOffline === true;
}

export function logOfflineSkip(context) {
  console.debug(`[offline] 跳过: ${context}`);
}
