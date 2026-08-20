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

const app = express();

const originsEnv = process.env.CORS_ORIGINS || '*';
const corsOptions =
  originsEnv === '*'
    ? { origin: true, credentials: true }
    : {
        origin: originsEnv.split(',').map((s) => s.trim()),
        credentials: true,
      };

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(apiLimiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'FedyaLM работает! 🚀' });
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
