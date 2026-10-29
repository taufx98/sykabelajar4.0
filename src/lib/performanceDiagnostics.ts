type LayoutShiftEntry = PerformanceEntry & { value?: number; hadRecentInput?: boolean };

export function initializePerformanceDiagnostics(): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  const enabled = import.meta.env.DEV || new URLSearchParams(window.location.search).get('sykaPerf') === '1';
  if (!enabled) return;

  const supportedTypes = PerformanceObserver.supportedEntryTypes ?? [];
  let lcpMs = 0;
  let cls = 0;
  let slowestObservedInteractionMs = 0;
  let reported = false;
  const observers: PerformanceObserver[] = [];

  const observe = (
    type: string,
    callback: (entries: PerformanceEntry[]) => void,
    options: PerformanceObserverInit = { type, buffered: true } as PerformanceObserverInit,
  ) => {
    if (!supportedTypes.includes(type)) return;
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe(options);
      observers.push(observer);
    } catch {
      // Gracefully skip entry types unsupported by the current browser.
    }
  };

  observe('largest-contentful-paint', (entries) => {
    for (const entry of entries) lcpMs = Math.max(lcpMs, entry.startTime);
  });
  observe('layout-shift', (entries) => {
    for (const raw of entries) {
      const entry = raw as LayoutShiftEntry;
      if (!entry.hadRecentInput) cls += entry.value ?? 0;
    }
  });
  observe(
    'event',
    (entries) => {
      for (const entry of entries) slowestObservedInteractionMs = Math.max(slowestObservedInteractionMs, entry.duration);
    },
    { type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit,
  );

  const report = () => {
    if (reported) return;
    reported = true;
    console.info('[SYKABELAJAR performance diagnostics]', {
      path: window.location.pathname,
      largestContentfulPaintMs: Math.round(lcpMs),
      cumulativeLayoutShift: Number(cls.toFixed(4)),
      slowestObservedInteractionMs: Math.round(slowestObservedInteractionMs),
      note: 'Local-only diagnostics; interaction duration is a proxy, not official INP.',
    });
    observers.forEach((observer) => observer.disconnect());
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', report);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') report();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', report, { once: true });
}
