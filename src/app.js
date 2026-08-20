const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { apiLimiter } = require('./middleware/rateLimit');
const { auth } = require('./middleware/auth');
const userController = require('./controllers/userController');
const logger = require('./services/logger');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const badgeRoutes = require('./routes/badges');
const premiumRoutes = require('./routes/premium');
const adminRoutes = require('./routes/admin');
const keysRoutes = require('./routes/keys');
const mediaRoutes = require('./routes/media');

const app = express();
const DEPLOY_VERSION = '2026-08-20-c';

const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions =
  originsEnv === '*'
    ? { origin: true, credentials: true }
    : {
        origin: originsEnv.split(',').map((s) => s.trim()),
        credentials: true,
      };

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Admin SPA (React build under /admin/)
const adminDir = path.join(__dirname, '../public/admin');
const sendAdminIndex = (_req, res) => {
  res.sendFile(path.join(adminDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Админка не собрана. Нужен public/admin' });
  });
};
app.get(['/admin', '/admin/'], sendAdminIndex);
app.use(
  '/admin',
  express.static(adminDir, {
    index: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);
app.get(/^\/admin\/.*/, sendAdminIndex);

app.use(apiLimiter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'FedyaLM работает! 🚀',
    version: DEPLOY_VERSION,
    admin: true,
  });
});

// Flat auth aliases matching API spec (/api/register, /api/login, ...)
app.use('/api', authRoutes);

// Nested resource routes
app.use('/api/users', userRoutes);
app.get('/api/search', auth, userController.search);
app.use('/api/messages', messageRoutes);
app.use('/api/badges', badgeRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/media', mediaRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

app.use((err, _req, res, _next) => {
  logger.error(err.message || 'Unhandled error', {
    stack: err.stack,
    status: err.status,
  });
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Внутренняя ошибка сервера',
  });
});

module.exports = app;
