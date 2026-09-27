'use strict';

/**
 * PO Token provider candidates are supply-chain policy, not runtime installers.
 *
 * The preferred entry is intentionally metadata-only for now: Elitesand does
 * not auto-download, execute, or redistribute the provider until its packaging
 * and GPL compliance path is implemented and reviewed separately.
 */
const PREFERRED_POT_PROVIDER = Object.freeze({
  id: 'bgutil-ytdlp-pot-provider',
  version: '2.0.0',
  upstream: 'https://github.com/Brainicism/bgutil-ytdlp-pot-provider',
  license: 'GPL-3.0-only',
  mode: 'http',
  host: '127.0.0.1',
  port: 4416,
  minNodeMajor: 20,
  client: 'mweb',
  tokenContext: 'gvs',
  autoInstall: false,
  bundled: false,
  status: 'preselected',
});

const POT_PROVIDER_CANDIDATES = Object.freeze([
  PREFERRED_POT_PROVIDER,
]);

function getPreferredPotProvider() {
  return { ...PREFERRED_POT_PROVIDER };
}

module.exports = {
  PREFERRED_POT_PROVIDER,
  POT_PROVIDER_CANDIDATES,
  getPreferredPotProvider,
};
