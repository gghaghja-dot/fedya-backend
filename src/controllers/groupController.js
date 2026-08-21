const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { redis } = require('../config/redis');
const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');
const { getIO } = require('../socket');

async function getMembership(chatId, userId) {
  const { data } = await supabase
    .from('chat_members')
    .select('*')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

async function assertMember(chatId, userId) {
  return Boolean(await getMembership(chatId, userId));
}

async function memberRows(chatId) {
  const { data } = await supabase.from('chat_members').select('*').eq('chat_id', chatId);
  return data || [];
}

async function memberIds(chatId) {
  return (await memberRows(chatId)).map((m) => String(m.user_id));
}

async function readGroupMeta(chatId) {
  const raw = await redis.get(`gmeta:${chatId}`);
  if (!raw) return { title: null, avatar_url: null, roles: {}, banned: [] };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      title: parsed.title || null,
      avatar_url: parsed.avatar_url || null,
      roles: parsed.roles || {},
      banned: Array.isArray(parsed.banned) ? parsed.banned.map(String) : [],
    };
  } catch {
    return { title: null, avatar_url: null, roles: {}, banned: [] };
  }
}

async function writeGroupMeta(chatId, meta) {
  await redis.set(`gmeta:${chatId}`, JSON.stringify(meta), { ex: 60 * 60 * 24 * 365 });
}

function roleOf(meta, chat, userId) {
  if (String(chat.created_by) === String(userId)) return 'admin';
  const r = meta.roles?.[String(userId)];
  return r === 'admin' ? 'admin' : 'member';
}

async function assertAdmin(chatId, userId) {
  const { data: chat } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();
  if (!chat || !chat.is_group) return null;
  const meta = await readGroupMeta(chatId);
  if (roleOf(meta, chat, userId) !== 'admin') return null;
  return { chat, meta };
}

function emitToMembers(ids, event, payload, exceptId) {
  try {
    const io = getIO();
    if (!io) return;
    for (const id of ids) {
      if (exceptId && id === exceptId) continue;
      io.to(`user:${id}`).emit(event, payload);
    }
  } catch {
    /* ignore */
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

  const roles = { [req.user.id]: 'admin' };
  await writeGroupMeta(chat.id, { title: name, avatar_url: null, roles, banned: [] });

  const members = [];
  for (const id of [req.user.id, ...unique]) {
    const u = await User.findById(id);
    if (u) {
      const pub = User.toPublic(await User.hydrate(u));
      members.push({ ...pub, group_role: roles[id] || 'member' });
    }
  }

  res.status(201).json({
    conversation: {
      id: chat.id,
      type: 'group',
      title: name,
      avatar_url: null,
      created_by: req.user.id,
      created_at: chat.created_at,
      peer_id: null,
      member_count: members.length,
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
    const meta = await readGroupMeta(chat.id);
    if (meta.banned.includes(String(req.user.id))) continue;
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
        title: meta.title || chat.name,
        avatar_url: meta.avatar_url || null,
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
  const meta = await readGroupMeta(chatId);
  if (meta.banned.includes(String(req.user.id))) {
    return res.status(403).json({ error: 'Вы заблокированы в этой группе' });
  }
  const rows = await memberRows(chatId);
  const members = [];
  for (const row of rows) {
    const id = String(row.user_id);
    if (meta.banned.includes(id)) continue;
    const u = await User.findById(id);
    if (u) {
      const pub = User.toPublic(await User.hydrate(u));
      members.push({ ...pub, group_role: roleOf(meta, chat, id) });
    }
  }
  res.json({
    conversation: {
      id: chat.id,
      type: 'group',
      title: meta.title || chat.name,
      avatar_url: meta.avatar_url || null,
      created_by: chat.created_by,
      created_at: chat.created_at,
      member_count: members.length,
      my_role: roleOf(meta, chat, req.user.id),
    },
    members,
  });
});

const update = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  const admin = await assertAdmin(chatId, req.user.id);
  if (!admin) return res.status(403).json({ error: 'Только администратор' });
  const { chat, meta } = admin;
  const name = req.body.name != null ? String(req.body.name).trim().slice(0, 64) : null;
  const avatarUrl = req.body.avatar_url !== undefined ? req.body.avatar_url : undefined;
  if (name) {
    meta.title = name;
    await supabase.from('chats').update({ name }).eq('id', chatId);
  }
  if (avatarUrl !== undefined) meta.avatar_url = avatarUrl;
  await writeGroupMeta(chatId, meta);
  const ids = await memberIds(chatId);
  emitToMembers(ids, 'group:updated', {
    groupId: chatId,
    title: meta.title || chat.name,
    avatar_url: meta.avatar_url,
  });
  res.json({
    conversation: {
      id: chatId,
      type: 'group',
      title: meta.title || chat.name,
      avatar_url: meta.avatar_url,
      created_by: chat.created_by,
      my_role: 'admin',
    },
  });
});

const addMember = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  const userId = String(req.body.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  if (!(await assertMember(chatId, req.user.id))) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const meta = await readGroupMeta(chatId);
  if (meta.banned.includes(userId)) {
    return res.status(403).json({ error: 'Пользователь заблокирован в группе' });
  }
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (await assertMember(chatId, userId)) {
    return res.json({ success: true, already: true });
  }
  const { error } = await supabase.from('chat_members').insert({ chat_id: chatId, user_id: userId });
  if (error) throw error;
  const pub = User.toPublic(await User.hydrate(user));
  const ids = await memberIds(chatId);
  emitToMembers(ids, 'group:member', { groupId: chatId, action: 'add', user: { ...pub, group_role: 'member' } });
  res.json({ success: true, user: { ...pub, group_role: 'member' } });
});

const removeMember = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  const userId = String(req.params.userId || req.body.userId || '').trim();
  const ban = Boolean(req.body.ban);
  const admin = await assertAdmin(chatId, req.user.id);
  if (!admin) return res.status(403).json({ error: 'Только администратор' });
  const { chat, meta } = admin;
  if (String(chat.created_by) === userId) {
    return res.status(400).json({ error: 'Нельзя удалить создателя' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Нельзя удалить себя так' });
  }
  await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', userId);
  delete meta.roles[userId];
  if (ban && !meta.banned.includes(userId)) meta.banned.push(userId);
  await writeGroupMeta(chatId, meta);
  const ids = await memberIds(chatId);
  emitToMembers([...ids, userId], 'group:member', {
    groupId: chatId,
    action: ban ? 'ban' : 'kick',
    userId,
  });
  res.json({ success: true });
});

const setRole = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  const userId = String(req.body.userId || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  const admin = await assertAdmin(chatId, req.user.id);
  if (!admin) return res.status(403).json({ error: 'Только администратор' });
  const { chat, meta } = admin;
  if (String(chat.created_by) === userId && role !== 'admin') {
    return res.status(400).json({ error: 'Создатель всегда админ' });
  }
  if (!(await assertMember(chatId, userId))) {
    return res.status(404).json({ error: 'Участник не найден' });
  }
  meta.roles[userId] = role;
  await writeGroupMeta(chatId, meta);
  const ids = await memberIds(chatId);
  emitToMembers(ids, 'group:member', { groupId: chatId, action: 'role', userId, role });
  res.json({ success: true, userId, role });
});

const getMessages = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  if (!(await assertMember(chatId, req.user.id))) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const meta = await readGroupMeta(chatId);
  if (meta.banned.includes(String(req.user.id))) {
    return res.status(403).json({ error: 'Вы заблокированы' });
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
  const meta = await readGroupMeta(chatId);
  if (meta.banned.includes(String(req.user.id))) {
    return res.status(403).json({ error: 'Вы заблокированы' });
  }
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'content обязателен' });
  const contentType = req.body.content_type || 'text';
  const mediaUrl = req.body.media_url || null;
  const replyTo = req.body.reply_to || null;

  const message = {
    id: uuidv4(),
    sender_id: req.user.id,
    recipient_id: null,
    conversation_id: chatId,
    content,
    content_type: contentType,
    media_url: mediaUrl,
    reply_to: replyTo,
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
  emitToMembers(ids, 'message:received', {
    ...message,
    group_id: chatId,
    timestamp: message.created_at,
  }, req.user.id);

  res.status(201).json({ message });
});

const deleteMessage = asyncHandler(async (req, res) => {
  const chatId = req.params.id;
  const messageId = req.params.messageId;
  if (!(await assertMember(chatId, req.user.id))) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const raw = await redis.lrange(`gmsg:${chatId}`, 0, 299);
  let found = null;
  const kept = [];
  for (const r of raw || []) {
    let msg;
    try {
      msg = typeof r === 'string' ? JSON.parse(r) : r;
    } catch {
      continue;
    }
    if (msg && msg.id === messageId) {
      found = msg;
      const { data: chat } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();
      const meta = await readGroupMeta(chatId);
      const isAdmin = chat && roleOf(meta, chat, req.user.id) === 'admin';
      if (String(msg.sender_id) !== String(req.user.id) && !isAdmin) {
        return res.status(403).json({ error: 'Нельзя удалить чужое сообщение' });
      }
      continue;
    }
    kept.push(typeof r === 'string' ? r : JSON.stringify(r));
  }
  if (!found) return res.status(404).json({ error: 'Сообщение не найдено' });
  await redis.del(`gmsg:${chatId}`);
  if (kept.length) {
    // kept is newest-first; rpush in that order restores index 0 = newest
    for (const item of kept) {
      await redis.rpush(`gmsg:${chatId}`, item);
    }
    await redis.expire(`gmsg:${chatId}`, 60 * 60 * 24 * 90);
  }
  const ids = await memberIds(chatId);
  emitToMembers(ids, 'message:deleted', { messageId, groupId: chatId, conversationId: chatId });
  res.json({ success: true });
});

module.exports = {
  create,
  listMine,
  get,
  update,
  addMember,
  removeMember,
  setRole,
  getMessages,
  sendMessage,
  deleteMessage,
};
