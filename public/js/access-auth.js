/* Global access credential helper shared by the desktop panel and controller. */
const AccessAuth = (() => {
  const CONTROLLER_KEY = 'elitesand-controller-token';
  let panelSourceToken = '';
  let pairingError = '';

  function getControllerToken() {
    try { return localStorage.getItem(CONTROLLER_KEY) || ''; } catch (_) { return ''; }
  }
  function setControllerToken(value) {
    try { if (value) localStorage.setItem(CONTROLLER_KEY, value); else localStorage.removeItem(CONTROLLER_KEY); } catch (_) { /* storage disabled */ }
  }
  function headers() {
    const value = getControllerToken();
    return value ? { 'X-Elitesand-Controller': value } : {};
  }
  function sourceToken() { return panelSourceToken || new URLSearchParams(window.location.search).get('source') || ''; }
  function setSourceToken(value) { panelSourceToken = typeof value === 'string' ? value : ''; }
  function sourceUrl(path, { preview = false, relative = false } = {}) {
    const url = new URL(path, window.location.origin);
    if (preview) url.searchParams.set('preview', '1');
    const source = sourceToken();
    if (source && !preview) url.searchParams.set('source', source);
    return relative ? `${url.pathname}${url.search}` : url.toString();
  }
  async function completePairingFromUrl() {
    const url = new URL(window.location.href);
    const pair = url.searchParams.get('pair');
    if (!pair) return false;
    try {
      const response = await fetch('/api/access/pairing/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair }), cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.controllerToken) throw new Error(body.error || 'Pairing failed');
      setControllerToken(body.controllerToken);
      url.searchParams.delete('pair');
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      return true;
    } catch (error) {
      pairingError = error.message || 'Pairing failed';
      return false;
    }
  }
  const ready = completePairingFromUrl();
  return { getControllerToken, setControllerToken, headers, sourceToken, setSourceToken, sourceUrl, ready: () => ready, pairingError: () => pairingError };
})();
