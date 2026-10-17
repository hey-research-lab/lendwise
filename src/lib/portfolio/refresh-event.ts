/** Fired when a bridge transfer lands, so a mounted portfolio reloads its balances. */
export const PORTFOLIO_REFRESH_EVENT = 'lendwise:portfolio-refresh'

export function requestPortfolioRefresh(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PORTFOLIO_REFRESH_EVENT))
}
