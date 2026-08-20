function admin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }
  next();
}

function creatorOnly(req, res, next) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (!req.user || req.user.email.toLowerCase() !== adminEmail) {
    return res.status(403).json({ error: 'Доступ только для создателя' });
  }
  next();
}

module.exports = { admin, creatorOnly };
