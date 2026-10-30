# SYKABELAJAR 4.0 — Stage 5 Performance Baseline

Date: 31 October 2026 (Asia/Jakarta)  
Baseline source: GitHub Actions CI build on 30 October 2026 UTC  
Main commit: \`8f654625fa34f18da56f126ddf07056888ec1187\`  
CI run: [#1699](https://github.com/taufx98/sykabelajar4.0/actions/runs/41118860765)

## Scope and safeguards

This stage adds measurement and regression guards. It does not redesign screens, alter navigation or exam flows, change Supabase schema/RPC/RLS, or modify production records. No external analytics endpoint is used. Browser diagnostics are opt-in and write only to the local browser console.

## Measured build baseline

The CI Vite build emitted the following asset sizes:

| Asset | Raw size | Gzip size | Loading scope |
|---|---:|---:|---|
| Application entry JavaScript | 623.81 kB | 178.64 kB | Initial application bundle |
| Global CSS | 110.20 kB | 18.18 kB | Initial application stylesheet |
| Initial JS + CSS | 734.01 kB | 196.82 kB | Initial static asset payload |
| Admin dashboard lazy chunk | 374.89 kB | 110.74 kB | Loaded when the admin dashboard route is opened |

The admin dashboard chunk is large, but it is route-lazy and is not part of the ordinary initial entry payload. It is recorded as a follow-up investigation rather than split further without runtime evidence.

These are compressed build-artifact measurements, not Lighthouse scores or real-user Core Web Vitals. No authenticated production browser session or representative field dataset was available during this measurement, so LCP, INP, CLS and API latency are not claimed as measured production values.

## CI asset budgets

The build is now checked against these gzip budgets:

| Metric | Limit |
|---|---:|
| Application entry JavaScript | 200.00 kB |
| All generated CSS combined | 50.00 kB |
| Initial entry JavaScript + CSS | 220.00 kB |

The limits preserve reasonable headroom over the measured baseline while catching accidental growth in the first-load payload. Lazy chunks are reported for visibility, but are not currently blocked by an arbitrary per-route limit.

Run locally with:

\`\`\`sh
npm run test:performance-budget
npm run build
npm run check:performance
\`\`\`

## Opt-in browser diagnostics

Append \`?sykaPerf=1\` to a page URL, for example:

\`\`\`
https://sykabelajar.my.id/?sykaPerf=1
\`\`\`

Open the browser developer console, use the page normally, then switch away from the tab or leave/reload the page to flush the diagnostic report.

The report can include:

- Time to First Byte (TTFB), First Contentful Paint (FCP), Largest Contentful Paint (LCP)
- Cumulative Layout Shift (CLS), calculated using the maximum layout-shift session window
- Long-task count and longest observed long task
- Slowest observed event duration as an interaction diagnostic proxy
- Resource count and transfer bytes visible to the browser timing API

The event-duration value is not official INP. Resource transfer bytes can be incomplete for cross-origin resources without Timing-Allow-Origin and for cache hits. Unsupported browser PerformanceObserver entry types are skipped safely. Diagnostics are local-only, not transmitted to SYKABELAJAR or a third party.

## Stage 5 follow-up criteria

1. Collect comparable browser measurements on representative desktop and mobile devices.
2. Compare public landing/home, competition detail, messages, and the admin dashboard separately.
3. Profile slow interactions and Supabase request waterfalls before changing React rendering, caches, realtime subscriptions, or data queries.
4. Keep a proposed optimization only when before/after measurements improve beyond normal run variance and the existing regression suite remains green.
