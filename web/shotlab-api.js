// ShotLab API client. Loaded before support.js so window.SL is ready when the
// app boots. All calls use cookie sessions (credentials:'include').
(function () {
  const BASE = (window.SHOTLAB_API || 'http://localhost:4000').replace(/\/$/, '');

  async function req(method, path, body, isForm) {
    const opts = { method, credentials: 'include', headers: {} };
    if (isForm) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(BASE + path, opts);
    } catch (e) {
      throw new SLError('NETWORK', 'Cannot reach the server. Is the API running?');
    }
    let json = null;
    try {
      json = await res.json();
    } catch (_) {}
    if (!res.ok) {
      const err = (json && json.error) || {};
      throw new SLError(err.code || 'ERROR', err.message || `Request failed (${res.status})`, res.status, err.details);
    }
    return json;
  }

  class SLError extends Error {
    constructor(code, message, status, details) {
      super(message);
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  const SL = {
    base: BASE,
    SLError,
    // ---- auth ----
    me: () => req('GET', '/auth/me'),
    signup: (name, email, password) => req('POST', '/auth/signup', { name, email, password }),
    login: (email, password) => req('POST', '/auth/login', { email, password }),
    logout: () => req('POST', '/auth/logout'),
    guest: () => req('POST', '/auth/guest'),
    resetRequest: (email) => req('POST', '/auth/reset/request', { email }),
    resetConfirm: (token, newPassword) => req('POST', '/auth/reset/confirm', { token, newPassword }),
    changePassword: (currentPassword, newPassword) => req('POST', '/auth/change-password', { currentPassword, newPassword }),
    updateProfile: (name) => req('PATCH', '/auth/profile', { name }),
    googleConfig: () => req('GET', '/auth/google/config'),
    google: (credential) => req('POST', '/auth/google', { credential }),
    // ---- ai ----
    generate: (payload) => req('POST', '/ai/generate', payload),
    score: (prompt, lang) => req('POST', '/ai/score', { prompt, lang }),
    improve: (prompt, lang) => req('POST', '/ai/improve', { prompt, lang }),
    // ---- uploads ----
    upload: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return req('POST', '/uploads', fd, true);
    },
    // ---- data ----
    templates: () => req('GET', '/templates'),
    createTemplate: (t) => req('POST', '/templates', t),
    updateTemplate: (id, t) => req('PATCH', '/templates/' + id, t),
    deleteTemplate: (id) => req('DELETE', '/templates/' + id),
    saved: () => req('GET', '/saved'),
    createSaved: (s) => req('POST', '/saved', s),
    deleteSaved: (id) => req('DELETE', '/saved/' + id),
    favorites: () => req('GET', '/favorites'),
    addFavorite: (promptId) => req('POST', '/favorites/' + encodeURIComponent(promptId)),
    removeFavorite: (promptId) => req('DELETE', '/favorites/' + encodeURIComponent(promptId)),
    history: () => req('GET', '/history'),
    addHistory: (type, label) => req('POST', '/history', { type, label }),
    clearHistory: () => req('DELETE', '/history'),
    library: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return req('GET', '/library' + (q ? '?' + q : ''));
    },
  };

  window.SL = SL;
})();
