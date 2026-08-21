const jwt = require('jsonwebtoken');
const jwtConfig = require('./config/jwt');
const { redis, KEYS } = require('./config/redis');
const Message = require('./models/Message');
const User = require('./models/User');
const { assertOpaqueCiphertext } = require('./services/encryption');
const { evaluateAutoBadges } = require('./services/badgeEngine');
const { sendPush } = require('./services/fcm');
const logger = require('./services/logger');

let ioInstance = null;

function getIO() {
  return ioInstance;
}

function initSocket(server) {
  const { Server } = require('socket.io');
  const origins = process.env.CORS_ORIGINS || '*';
  const corsOrigin = origins === '*' ? '*' : origins.split(',').map((s) => s.trim());

  const io = new Server(server, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  });
  ioInstance = io;

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('Unauthorized'));

      const payload = jwt.verify(token, jwtConfig.accessSecret);
      const user = await User.findById(payload.sub);
      if (!user || user.is_banned) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);
    await redis.set(KEYS.presence(userId), 'online', { ex: 300 });
    socket.broadcast.emit('presence', { userId, status: 'online' });
    logger.info('Socket connected', { userId });

    // Keep presence fresh while connected
    const presenceBeat = setInterval(() => {
      redis.set(KEYS.presence(userId), 'online', { ex: 300 }).catch(() => {});
    }, 60_000);

    socket.on('presence', async (data) => {
      const status = data?.status === 'away' ? 'away' : 'online';
      await redis.set(KEYS.presence(userId), status, { ex: 300 });
      socket.broadcast.emit('presence', { userId, status });
    });

    socket.on('typing:start', ({ to }) => {
      if (!to) return;
      io.to(`user:${to}`).emit('typing:start', { from: userId });
    });

    socket.on('typing:stop', ({ to }) => {
      if (!to) return;
      io.to(`user:${to}`).emit('typing:stop', { from: userId });
    });

    socket.on('message:read', async ({ messageId }) => {
      try {
        const message = await Message.markRead(messageId, userId);
        if (message) {
          io.to(`user:${message.sender_id}`).emit('message:read', {
            messageId: message.id,
            read_at: message.read_at,
          });
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        const { to, content, encrypted, content_type, media_url, reply_to } = payload || {};
        if (!to || !content) throw new Error('to и content обязательны');
        assertOpaqueCiphertext(content);

        const blocked =
          (await User.isBlocked(to, userId)) || (await User.isBlocked(userId, to));
        if (blocked) throw new Error('Blocked');

        const message = await Message.create({
          senderId: userId,
          recipientId: to,
          content,
          contentType: content_type || 'text',
          mediaUrl: media_url || null,
          replyTo: reply_to || null,
          isEncrypted: encrypted !== false,
        });

        evaluateAutoBadges(userId).catch(() => {});

        io.to(`user:${to}`).emit('message:received', {
          ...message,
          from: userId,
          timestamp: message.created_at,
        });
        socket.emit('message:sent', message);

        const recipient = await User.findById(to);
        if (recipient?.fcm_token) {
          sendPush(recipient.fcm_token, {
            title: socket.user.display_name || socket.user.username,
            body: 'Новое сообщение',
            data: { messageId: message.id, from: userId },
          }).catch(() => {});
        }

        if (typeof ack === 'function') ack({ success: true, message });
      } catch (err) {
        if (typeof ack === 'function') ack({ success: false, error: err.message });
        else socket.emit('error', { message: err.message });
      }
    });

    // ── WebRTC signaling only (media is P2P — never through Render) ──
    const relayCall = (event, payload) => {
      const to = payload?.to;
      if (!to || to === userId) return false;
      io.to(`user:${to}`).emit(event, { ...payload, from: userId });
      return true;
    };

    socket.on('call:invite', async (payload, ack) => {
      try {
        const to = payload?.to;
        if (!to || to === userId) throw new Error('Некорректный получатель');
        const video = Boolean(payload?.video);
        const callId = payload?.callId || `${userId}:${to}:${Date.now()}`;
        const ok = relayCall('call:invite', {
          to,
          callId,
          video,
          fromName: socket.user.display_name || socket.user.username || '',
        });
        if (!ok) throw new Error('Не удалось отправить');

        const recipient = await User.findById(to);
        if (recipient?.fcm_token) {
          sendPush(recipient.fcm_token, {
            title: socket.user.display_name || socket.user.username,
            body: video ? 'Входящий видеозвонок' : 'Входящий звонок',
            data: { type: 'call', callId, from: userId, video: String(video) },
          }).catch(() => {});
        }
        if (typeof ack === 'function') ack({ success: true, callId });
      } catch (err) {
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    socket.on('call:accept', (payload) => relayCall('call:accept', payload));
    socket.on('call:reject', (payload) => relayCall('call:reject', payload));
    socket.on('call:hangup', (payload) => relayCall('call:hangup', payload));
    socket.on('call:offer', (payload) => relayCall('call:offer', payload));
    socket.on('call:answer', (payload) => relayCall('call:answer', payload));
    socket.on('call:ice', (payload) => relayCall('call:ice', payload));

    socket.on('disconnect', async () => {
      clearInterval(presenceBeat);
      await redis.set(KEYS.presence(userId), 'offline', { ex: 86400 });
      await User.update(userId, { last_seen: new Date().toISOString() });
      socket.broadcast.emit('presence', { userId, status: 'offline' });
      logger.info('Socket disconnected', { userId });
    });
  });

  return io;
}

module.exports = { initSocket, getIO };
