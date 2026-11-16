(function () {
  'use strict';

  const stylesheet = document.getElementById('display-google-fonts');
  if (!stylesheet) return;
  // CSP allows same-origin scripts, not inline event attributes. Keep the
  // download nonblocking, then activate the CSS from this external script.
  const activate = () => { stylesheet.media = 'all'; };
  stylesheet.addEventListener('load', activate, { once: true });
  // A cached stylesheet may have loaded before this deferred script ran.
  if (stylesheet.sheet) activate();
})();
