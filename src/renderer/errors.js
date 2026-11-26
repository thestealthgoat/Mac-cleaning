// Collect uncaught renderer errors so they can be surfaced in dev snapshots and the console.
window.__siltErrors = [];
window.addEventListener('error', (e) => window.__siltErrors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__siltErrors.push(String(e.reason && e.reason.message ? e.reason.message : e.reason)));
