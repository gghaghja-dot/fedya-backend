const Message = require('../models/Message');
const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');
const { assertOpaqueCiphertext } = require('../services/encryption');
const { evaluateAutoBadges } = require('../services/badgeEngine');
const { sendPush } = require('../services/fcm');
const { getIO } = require('../socket');

const getWithUser = asyncHandler(async (req, res) => {
  const messages = await Message.getWithUser(req.user.id, req.params.userId, {
    limit: Math.min(Number(req.query.limit) || 100, 200),
    before: req.query.before,
  });
  res.json({ messages: messages.reverse() });
});

const send = asyncHandler(async (req, res) => {
  const { to, content, encrypted, content_type, media_url, reply_to, forwarded_from, conversation_id } =
    req.body;

  if (to === req.user.id) {
    return res.status(400).json({ error: 'Нельзя отправить сообщение себе' });
  }

  const recipient = await User.findById(to);
  if (!recipient || recipient.is_banned) {
    return res.status(404).json({ error: 'Получатель не найден' });
  }

  const blocked =
    (await User.isBlocked(to, req.user.id)) || (await User.isBlocked(req.user.id, to));
  if (blocked) {
    return res.status(403).json({ error: 'Обмен сообщениями заблокирован' });
  }

  assertOpaqueCiphertext(content);

  const message = await Message.create({
    senderId: req.user.id,
    recipientId: to,
    content,
    contentType: content_type || 'text',
    mediaUrl: media_url || null,
    replyTo: reply_to || null,
    forwardedFrom: forwarded_from || null,
    isEncrypted: encrypted !== false,
    conversationId: conversation_id || null,
  });

  evaluateAutoBadges(req.user.id).catch(() => {});

  try {
    const io = getIO();
    if (io) {
      io.to(`user:${to}`).emit('message:received', {
        ...message,
        from: req.user.id,
        timestamp: message.created_at,
      });
    }
  } catch {
    /* socket optional */
  }

  const fcm = await User.getFcmToken(recipient.id);
  if (fcm) {
    sendPush(fcm, {
      title: req.user.username,
      body: 'Новое сообщение',
      data: { messageId: message.id, from: req.user.id },
    }).catch(() => {});
  }

  res.status(201).json({ message });
});

const react = asyncHandler(async (req, res) => {
  const emoji = String(req.body.emoji || '').trim().slice(0, 16);
  if (!emoji) return res.status(400).json({ error: 'emoji обязателен' });
  const message = await Message.react(req.params.id, req.user.id, emoji);
  if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });
  try {
    const io = getIO();
    if (io) {
      const peer =
        message.sender_id === req.user.id ? message.recipient_id : message.sender_id;
      if (peer) {
        io.to(`user:${peer}`).emit('message:reaction', {
          messageId: message.id,
          reactions: message.reactions,
        });
      }
    }
  } catch {
    /* ignore */
  }
  res.json({ message });
});

const markRead = asyncHandler(async (req, res) => {
  const message = await Message.markRead(req.params.id, req.user.id);
  if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });

  try {
    const io = getIO();
    if (io) {
      io.to(`user:${message.sender_id}`).emit('message:read', {
        messageId: message.id,
        read_at: message.read_at,
      });
    }
  } catch {
    /* ignore */
  }

  res.json({ message });
});

const remove = asyncHandler(async (req, res) => {
  const message = await Message.softDelete(req.params.id, req.user.id);
  if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });
  try {
    const io = getIO();
    if (io) {
      const peer =
        message.sender_id === req.user.id ? message.recipient_id : message.sender_id;
      const payload = {
        messageId: message.id,
        conversationId: message.conversation_id || null,
        from: req.user.id,
      };
      if (peer) io.to(`user:${peer}`).emit('message:deleted', payload);
      io.to(`user:${req.user.id}`).emit('message:deleted', payload);
    }
  } catch {
    /* ignore */
  }
  res.json({ success: true, message });
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await Message.unreadCount(req.user.id);
  res.json({ count });
});

const getConversations = asyncHandler(async (req, res) => {
  const conversations = await Message.getConversations(req.user.id);
  res.json({ conversations });
});

module.exports = {
  getWithUser,
  send,
  react,
  markRead,
  delete: remove,
  unreadCount,
  getConversations,
};
