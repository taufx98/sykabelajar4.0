export function notifyHomeNavigationClick(to: string): void {
  if (to === '/home' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('syka:home-click'));
  }
}
