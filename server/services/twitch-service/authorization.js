'use strict';

// Methods keep their original receiver and shared dependency instances.
const { fetchWithTimeout, log, OAUTH_TOKEN, OAUTH_DEVICE, OAUTH_VALIDATE, OAUTH_REVOKE, HELIX, REQUIRED_SCOPES, fetchOAuth, REDEMPTION_SCOPE, HELIX_TIMEOUT_MS } = require('./shared');

module.exports = {
  hasScope(scope) {
    return Array.isArray(this.auth?.scopes) && this.auth.scopes.includes(scope);
  },

  configured() {
    return !!this.config.twitchClientId;
  },

  async beginAuthorization() {
    if (!this.configured()) throw new Error('尚未設定 Twitch Client ID');
    if (this.deviceAuthorization) return this.publicDeviceAuthorization();
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      scopes: REQUIRED_SCOPES.join(' '),
    });
    const response = await fetchOAuth(OAUTH_DEVICE, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const data = await response.json();
    if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
      throw new Error(`無法開始 Twitch 授權：${data.message || response.status}`);
    }
    this.deviceAuthorization = {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
      intervalMs: Math.max(5, Number(data.interval || 5)) * 1000,
    };
    this.pollDeviceAuthorization();
    return this.publicDeviceAuthorization();
  },

  publicDeviceAuthorization() {
    if (!this.deviceAuthorization) return null;
    return {
      userCode: this.deviceAuthorization.userCode,
      verificationUri: this.deviceAuthorization.verificationUri,
    };
  },

  async pollDeviceAuthorization() {
    const pending = this.deviceAuthorization;
    if (!pending || this.closed) return;
    if (Date.now() >= pending.expiresAt) {
      this.deviceAuthorization = null;
      log.warn('Twitch Device Code 已過期，請從面板重新開始授權');
      return;
    }
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      scope: REQUIRED_SCOPES.join(' '),
      device_code: pending.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    try {
      const response = await fetchOAuth(OAUTH_TOKEN, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      const data = await response.json();
      if (response.ok && data.access_token) {
        this.deviceAuthorization = null;
        await this.saveValidatedToken(data);
        this.disconnectEventSub();
        this.connectEventSub();
        return;
      }
      if (data.message === 'slow_down') pending.intervalMs += 5000;
      if (!['authorization_pending', 'slow_down'].includes(data.message)) {
        this.deviceAuthorization = null;
        log.warn(`Twitch Device Code 授權失敗：${data.message || response.status}`);
        return;
      }
    } catch (err) {
      log.warn(`Twitch Device Code 輪詢失敗：${err.message}`);
    }
    setTimeout(() => this.pollDeviceAuthorization(), pending.intervalMs);
  },

  async refreshToken() {
    if (this.tokenRefreshInFlight) return this.tokenRefreshInFlight;
    this.tokenRefreshInFlight = this._refreshToken();
    try { return await this.tokenRefreshInFlight; }
    finally { this.tokenRefreshInFlight = null; }
  },

  async _refreshToken() {
    if (!this.auth || !this.auth.refreshToken) throw new Error('沒有可更新的 Twitch 授權，請重新連線');
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      grant_type: 'refresh_token',
      refresh_token: this.auth.refreshToken,
    });
    const response = await fetchOAuth(OAUTH_TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(`Twitch 授權更新失敗：${data.message || response.status}`);
    await this.saveValidatedToken(data);
  },

  async saveValidatedToken(token) {
    const response = await fetchOAuth(OAUTH_VALIDATE, { headers: { Authorization: `OAuth ${token.access_token}` } });
    const user = await response.json();
    if (!response.ok || !user.user_id) throw new Error('Twitch 授權驗證失敗');
    this.auth = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
      scopes: Array.isArray(token.scope) ? token.scope
        : Array.isArray(user.scopes) ? user.scopes
          : Array.isArray(this.auth?.scopes) ? this.auth.scopes : [],
      userId: user.user_id,
      userLogin: user.login || '',
    };
    this.authStore.save(this.auth);
    log.info(`Twitch 已授權頻道：${this.auth.userLogin || this.auth.userId}`);
  },

  async ensureToken() {
    if (!this.configured() || !this.auth) return false;
    // 預留 2 分鐘，避免訂閱/回覆聊天時剛好過期。
    if (!this.auth.expiresAt || this.auth.expiresAt - Date.now() < 2 * 60 * 1000) {
      if (!this.ensureRefreshInFlight) {
        this.ensureRefreshInFlight = Promise.resolve().then(() => this.refreshToken())
          .finally(() => { this.ensureRefreshInFlight = null; });
      }
      try { await this.ensureRefreshInFlight; } catch (err) {
        log.warn(err.message);
        return false;
      }
    }
    return true;
  },

  async revokeAccessToken(auth) {
    if (!auth?.accessToken || !this.configured()) return { attempted: false, revoked: false, alreadyInvalid: false };
    const body = new URLSearchParams({ client_id: this.config.twitchClientId, token: auth.accessToken });
    const response = await fetchOAuth(OAUTH_REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      timeout: 5000,
    });
    if (response.ok) return { attempted: true, revoked: true, alreadyInvalid: false };
    if (response.status === 400) return { attempted: true, revoked: false, alreadyInvalid: true };
    throw new Error(`Twitch 解除遠端授權失敗（${response.status}）`);
  },

  async deauthorize({ revoke = (auth) => this.revokeAccessToken(auth) } = {}) {
    const previousAuth = this.auth;
    if (!this.authStore.clear()) {
      throw new Error('無法清除本機 Twitch 授權資料；請確認資料夾權限後再試一次。');
    }
    this.deviceAuthorization = null;
    this.disconnectEventSub();
    this.auth = null;
    this.notifyStatusChange();

    let remote = { attempted: false, revoked: false, alreadyInvalid: false };
    let remoteError = '';
    try {
      remote = await revoke(previousAuth);
    } catch (err) {
      remoteError = String(err?.message || '無法連線 Twitch 取消遠端授權');
      log.warn(`本機 Twitch 授權已清除，但遠端撤銷失敗：${remoteError}`);
    }

    return {
      localCleared: true,
      remoteRevoked: !!remote?.revoked,
      remoteAlreadyInvalid: !!remote?.alreadyInvalid,
      remoteError,
      pendingRequestsPreserved: this.pendingRequests.size,
    };
  },

  async helix(path, options = {}) {
    const headers = {
      'Client-Id': this.config.twitchClientId,
      Authorization: `Bearer ${this.auth.accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    };
    return fetchWithTimeout(`${HELIX}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }, HELIX_TIMEOUT_MS);
  },

  async requireRedemptionAuthorization() {
    if (!await this.ensureToken()) throw new Error('Twitch 授權已失效，請重新連接 Twitch');
    if (!this.hasScope(REDEMPTION_SCOPE)) throw new Error('需要重新連接 Twitch，授權忠誠點數管理權限');
  },
};
