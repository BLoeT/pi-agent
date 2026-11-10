import { constantEqual, validUserId } from './security.js';

export function authentication({ token, username, password, getUser }) {
  if (!token || token.length < 32 || !validUserId(username) || !password || password.length < 16) {
    throw new Error('Sichere RIBO_INTERNAL_TOKEN / RIBO_WEB_USER / RIBO_WEB_PASSWORD konfigurieren');
  }
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    if (req.path === '/health' && req.method === 'GET') return next();
    const authorization = req.get('authorization') || '';
    if (constantEqual(authorization, `Bearer ${token}`)) {
      req.trustedService = true;
      return next();
    }
    const basic = authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString('utf8') : '';
    const colon = basic.indexOf(':');
    if (colon < 0 || !constantEqual(basic.slice(0, colon), username) || !constantEqual(basic.slice(colon + 1), password) || !getUser(username)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Ribo", charset="UTF-8"');
      return res.status(401).json({ error: 'Anmeldung erforderlich' });
    }
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Fremder Ursprung verweigert' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      if (!req.is('application/json')) return res.status(415).json({ error: 'JSON erforderlich' });
      if (origin) {
        try {
          if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Fremder Ursprung verweigert' });
        } catch { return res.status(403).json({ error: 'Ungültiger Ursprung' }); }
      }
    }
    req.authenticatedUser = username;
    next();
  };
}
