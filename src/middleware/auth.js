const jwt = require('jsonwebtoken');
const jwtConfig = require('../config/jwt');
const { supabase } = require('../config/database');

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtConfig.accessSecret);
    } catch {
      return res.status(401).json({ error: 'Недействительный или истёкший токен' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', payload.sub)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    if (user.is_banned) {
      const until = user.ban_until ? new Date(user.ban_until) : null;
      if (!until || until > new Date()) {
        return res.status(403).json({
          error: 'Аккаунт заблокирован',
          reason: user.ban_reason || null,
          ban_until: user.ban_until,
        });
      }
    }

    req.user = user;
    req.tokenPayload = payload;
    next();
  } catch (err) {
    next(err);
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  return auth(req, res, next);
}

module.exports = { auth, optionalAuth };
