// VantraRun API client. It keeps the same surface the app used with the Base44 SDK
// (api.entities.Run.list(), api.auth.me(), api.functions.invoke(), ...), so pages
// and components didn't need rewriting — only their import changed.
//
// VITE_API_URL points at the API. Leave it empty in development: Vite proxies
// /api and /uploads to the local server (see vite.config.js).

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'fitpro_access_token';

export const apiUrl = (path) => API_URL + path;

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
    // Some components read err.response.data.error (axios style).
    this.response = { status, data };
  }
}

function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode); the session lasts until reload
  }
}

export async function request(method, path, body, { raw = false, headers = {} } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach VantraRun. Check your connection and try again.", 0, null);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

const opts = (o) => (typeof o === 'string' ? { sort: o } : o || {});

function entity(name) {
  const base = `/api/entities/${encodeURIComponent(name)}`;
  const query = (q, o) => {
    const { sort, limit, skip } = opts(o);
    return request('POST', `${base}/query`, { q: q || {}, sort, limit, skip });
  };
  return {
    list: (o) => query({}, o),
    filter: (q, o) => query(q, o),
    get: (id) => request('GET', `${base}/${encodeURIComponent(id)}`),
    create: (data) => request('POST', base, data),
    bulkCreate: (rows) => request('POST', `${base}/bulk`, rows),
    update: (id, data) => request('PUT', `${base}/${encodeURIComponent(id)}`, data),
    bulkUpdate: (rows) => request('PUT', `${base}/bulk`, rows),
    updateMany: (q, data) => request('POST', `${base}/update-many`, { q, data }),
    delete: (id) => request('DELETE', `${base}/${encodeURIComponent(id)}`),
    deleteMany: (q) => request('POST', `${base}/delete-many`, { q }),
  };
}

// Same-origin path for a returnTo value (full URLs are reduced to their path).
function toPath(target) {
  try {
    const url = new URL(target || '/', window.location.origin);
    const path = `${url.pathname}${url.search}`;
    // "//host" would be a protocol-relative redirect off-site.
    if (url.origin !== window.location.origin || path.startsWith('//') || path.includes('\\')) return '/';
    return path;
  } catch {
    return '/';
  }
}

const auth = {
  getToken,
  setToken,
  me: () => request('GET', '/api/auth/me'),
  async isAuthenticated() {
    if (!getToken()) return false;
    try {
      await auth.me();
      return true;
    } catch {
      return false;
    }
  },
  updateMe: (data) => request('PUT', '/api/auth/me', data),
  async login({ email, password }) {
    const result = await request('POST', '/api/auth/login', { email, password });
    setToken(result.access_token);
    return result;
  },
  register: ({ email, password, full_name, invite_code }) =>
    request('POST', '/api/auth/register', { email, password, full_name, invite_code }),
  verifyOtp: ({ email, otpCode }) => request('POST', '/api/auth/verify-otp', { email, otp_code: otpCode }),
  resendOtp: (email) => request('POST', '/api/auth/resend-otp', { email }),
  async changePassword({ currentPassword, newPassword }) {
    const result = await request('POST', '/api/auth/change-password', { currentPassword, newPassword });
    // Changing the password signs out other devices and issues this one a new token.
    if (result?.access_token) setToken(result.access_token);
    return result;
  },
  resetPasswordRequest: (email) => request('POST', '/api/auth/reset-password-request', { email }),
  resetPassword: ({ resetToken, newPassword }) => request('POST', '/api/auth/reset-password', { resetToken, newPassword }),
  async deleteAccount(password) {
    const result = await request('DELETE', '/api/auth/me', { password });
    setToken(null);
    return result;
  },
  options: () => request('GET', '/api/auth/options'),
  loginWithProvider: async () => {
    throw new ApiError("Google sign-in isn't set up yet. Use your email and password.", 501, null);
  },
  // Clears the session and goes to the login page (or redirectUrl).
  logout(redirectUrl) {
    request('POST', '/api/auth/logout').catch(() => {});
    setToken(null);
    window.location.assign(redirectUrl ? toPath(redirectUrl) : '/login');
  },
  redirectToLogin(returnTo) {
    if (window.location.pathname === '/login') return;
    const path = toPath(returnTo || window.location.href);
    window.location.assign(path === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(path)}`);
  },
};

export const api = {
  auth,
  entities: new Proxy({}, { get: (_, name) => (typeof name === 'string' ? entity(name) : undefined) }),
  functions: {
    // Resolves to { data } like the Base44 SDK did.
    invoke: async (name, body) => ({ data: await request('POST', `/api/functions/${encodeURIComponent(name)}`, body || {}) }),
  },
  integrations: {
    Core: {
      UploadPublicFile: ({ file }) =>
        request('POST', '/api/uploads', file, {
          raw: true,
          headers: { 'Content-Type': file?.type || 'application/octet-stream' },
        }),
    },
  },
  app: {
    getPublicSettings: () => request('GET', '/api/app/public-settings'),
  },
};
