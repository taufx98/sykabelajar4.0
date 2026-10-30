type LayoutShiftEntry = PerformanceEntry & { value?: number; hadRecentInput?: boolean };
type ResourceTimingEntry = PerformanceResourceTiming;

export function initializePerformanceDiagnostics(): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  const enabled = import.meta.env.DEV || new URLSearchParams(window.location.search).get('sykaPerf') === '1';
  if (!enabled) return;

  const measuredPath = window.location.pathname;
  const supportedTypes = PerformanceObserver.supportedEntryTypes ?? [];
  let lcpMs = 0;
  let fcpMs = 0;
  let clsSessionStartMs = 0;
  let clsLastEntryMs = 0;
  let clsSessionValue = 0;
  let maxClsSessionValue = 0;
  let hasClsSession = false;
  let slowestObservedEventMs = 0;
  let longTaskCount = 0;
  let longestLongTaskMs = 0;
  let resourceCount = 0;
  let resourcesWithTransferSize = 0;
  let observedResourceTransferBytes = 0;
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

  observe('paint', (entries) => {
    for (const entry of entries) {
      if (entry.name === 'first-contentful-paint') fcpMs = Math.max(fcpMs, entry.startTime);
    }
  });
  observe('largest-contentful-paint', (entries) => {
    for (const entry of entries) lcpMs = Math.max(lcpMs, entry.startTime);
  });
  observe('layout-shift', (entries) => {
    for (const raw of entries) {
      const entry = raw as LayoutShiftEntry;
      if (entry.hadRecentInput || !entry.value) continue;

      const startTime = entry.startTime;
      const startsNewSession =
        !hasClsSession ||
        startTime - clsLastEntryMs >= 1_000 ||
        startTime - clsSessionStartMs >= 5_000;

      if (startsNewSession) {
        clsSessionStartMs = startTime;
        clsSessionValue = entry.value;
        hasClsSession = true;
      } else {
        clsSessionValue += entry.value;
      }
      clsLastEntryMs = startTime;
      maxClsSessionValue = Math.max(maxClsSessionValue, clsSessionValue);
    }
  });
  observe('longtask', (entries) => {
    for (const entry of entries) {
      longTaskCount += 1;
      longestLongTaskMs = Math.max(longestLongTaskMs, entry.duration);
    }
  });
  observe(
    'event',
    (entries) => {
      for (const entry of entries) slowestObservedEventMs = Math.max(slowestObservedEventMs, entry.duration);
    },
    { type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit,
  );
  observe('resource', (entries) => {
    for (const raw of entries) {
      const entry = raw as ResourceTimingEntry;
      resourceCount += 1;
      if (entry.transferSize > 0) {
        resourcesWithTransferSize += 1;
        observedResourceTransferBytes += entry.transferSize;
      }
    }
  });

  const report = () => {
    if (reported) return;
    reported = true;

    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const ttfbMs = navigation
      ? Math.max(0, navigation.responseStart - navigation.requestStart)
      : null;
    const domContentLoadedMs = navigation?.domContentLoadedEventEnd
      ? navigation.domContentLoadedEventEnd
      : null;
    const loadEventMs = navigation?.loadEventEnd ? navigation.loadEventEnd : null;

    console.info('[SYKABELAJAR performance diagnostics]', {
      path: measuredPath,
      timeToFirstByteMs: ttfbMs === null ? null : Math.round(ttfbMs),
      firstContentfulPaintMs: fcpMs ? Math.round(fcpMs) : null,
      largestContentfulPaintMs: lcpMs ? Math.round(lcpMs) : null,
      domContentLoadedMs: domContentLoadedMs === null ? null : Math.round(domContentLoadedMs),
      loadEventEndMs: loadEventMs === null ? null : Math.round(loadEventMs),
      cumulativeLayoutShift: Number(maxClsSessionValue.toFixed(4)),
      longTaskCount,
      longestLongTaskMs: Math.round(longestLongTaskMs),
      slowestObservedEventDurationMs: Math.round(slowestObservedEventMs),
      resourceCount,
      resourcesWithTransferSize,
      observedResourceTransferBytes,
      note: 'Local-only diagnostics. Event duration is a proxy, not official INP; resource transfer totals may be incomplete for cross-origin/cache entries.',
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
