const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { redis } = require('../config/redis');
const User = require('../models/User');
const { asyncHandler, publicUser } = require('../utils/helpers');
const { getIO } = require('../socket');

async function assertMember(chatId, userId) {
  const { data } = await supabase
    .from('chat_members')
    .select('user_id')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

async function memberIds(chatId) {
  const { data } = await supabase.from('chat_members').select('user_id').eq('chat_id', chatId);
  return (data || []).map((m) => String(m.user_id));
}

async function readGroupMeta(chatId) {
  const raw = await redis.get(`gmeta:${chatId}`);
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

const create = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 64);
  const memberIdsIn = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(String) : [];
  if (!name) return res.status(400).json({ error: 'Название группы обязательно' });

  const unique = [...new Set(memberIdsIn.filter((id) => id && id !== req.user.id))];
  if (!unique.length) return res.status(400).json({ error: 'Добавьте хотя бы одного участника' });

  const { data: chat, error } = await supabase
    .from('chats')
    .insert({
      name,
      is_group: true,
      created_by: req.user.id,
    })
    .select()
    .single();
  if (error) throw error;

  const rows = [
    { chat_id: chat.id, user_id: req.user.id },
    ...unique.map((id) => ({ chat_id: chat.id, user_id: id })),
  ];
  const { error: memErr } = await supabase.from('chat_members').insert(rows);
  if (memErr) throw memErr;

  await redis.set(
    `gmeta:${chat.id}`,
    JSON.stringify({ title: name, avatar_url: null }),
    { ex: 60 * 60 * 24 * 365 },
  );

  const members = [];
  for (const id of [req.user.id, ...unique]) {
    const u = await User.findById(id);
    if (u) members.push(User.toPublic(await User.hydrate(u)));
  }

  res.status(201).json({
    conversation: {
      id: chat.id,
      type: 'group',
      title: name,
      created_by: req.user.id,
      created_at: chat.created_at,
      peer_id: null,
    },
    members,
  });
});

const listMine = asyncHandler(async (req, res) => {
  const { data: memberships, error } = await supabase
    .from('chat_members')
    .select('*, chats(*)')
    .eq('user_id', req.user.id);
  if (error) throw error;

  const groups = [];
  for (const m of memberships || []) {
    const chat = m.chats;
    if (!chat || !chat.is_group) continue;
    const ids = await memberIds(chat.id);
    const lastRaw = await redis.lindex(`gmsg:${chat.id}`, 0);
    let last = null;
    if (lastRaw) {
      try {
        last = typeof lastRaw === 'string' ? JSON.parse(lastRaw) : lastRaw;
      } catch {
        last = null;
      }
    }
    groups.push({
      membership: m,
      conversation: {
        id: chat.id,
        type: 'group',
        title: chat.name,
        created_by: chat.created_by,
        created_at: chat.created_at,
        peer_id: null,
        member_count: ids.length,
      },
      last_message: last,
      unread: 0,
    });
  }
  groups.sort((a, b) => {
    const ta = a.last_message?.created_at || a.conversation?.created_at || '';
    const tb = b.last_message?.created_at || b.conversation?.created_at || '';
    return tb.localeCompare(ta);
  });
  res.json({ conversations: groups });
});

const get = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  if (!(await assertMember(chatId, req.user.id))) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const { data: chat } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();
  if (!chat || !chat.is_group) return res.status(404).json({ error: 'Группа не найдена' });
  const ids = await memberIds(chatId);
  const members = [];
  for (const id of ids) {
    const u = await User.findById(id);
    if (u) members.push(User.toPublic(await User.hydrate(u)));
  }
  res.json({
    conversation: {
      id: chat.id,
      type: 'group',
      title: chat.name,
      created_by: chat.created_by,
      created_at: chat.created_at,
      member_count: members.length,
    },
    members,
  });
});

const addMember = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  const userId = String(req.body.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  if (!(await assertMember(chatId, req.user.id))) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (await assertMember(chatId, userId)) {
    return res.json({ success: true, already: true });
  }
  const { error } = await supabase.from('chat_members').insert({ chat_id: chatId, user_id: userId });
  if (error) throw error;
  res.json({ success: true, user: User.toPublic(await User.hydrate(user)) });
});

const getMessages = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  if (!(await assertMember(chatId, req.user.id))) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const raw = await redis.lrange(`gmsg:${chatId}`, 0, limit - 1);
  const messages = (raw || [])
    .map((r) => {
      try {
        return typeof r === 'string' ? JSON.parse(r) : r;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
  res.json({ messages });
});

const sendMessage = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  if (!(await assertMember(chatId, req.user.id))) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'content обязателен' });
  const contentType = req.body.content_type || 'text';
  const mediaUrl = req.body.media_url || null;

  const message = {
    id: uuidv4(),
    sender_id: req.user.id,
    recipient_id: null,
    conversation_id: chatId,
    content,
    content_type: contentType,
    media_url: mediaUrl,
    is_encrypted: false,
    is_read: true,
    created_at: new Date().toISOString(),
    reactions: {},
    from: req.user.id,
  };

  await redis.lpush(`gmsg:${chatId}`, JSON.stringify(message));
  await redis.ltrim(`gmsg:${chatId}`, 0, 299);
  await redis.expire(`gmsg:${chatId}`, 60 * 60 * 24 * 90);

  const ids = await memberIds(chatId);
  try {
    const io = getIO();
    if (io) {
      for (const id of ids) {
        if (id === req.user.id) continue;
        io.to(`user:${id}`).emit('message:received', {
          ...message,
          group_id: chatId,
          timestamp: message.created_at,
        });
      }
    }
  } catch {
    /* ignore */
  }

  res.status(201).json({ message });
});

module.exports = {
  create,
  listMine,
  get,
  addMember,
  getMessages,
  sendMessage,
};
