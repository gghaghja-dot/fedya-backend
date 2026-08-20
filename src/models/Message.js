const { supabase } = require('../config/database');
const { redis } = require('../config/redis');
const { conversationIdFromUsers, normalizeMessage } = require('../utils/helpers');

async function readMeta(id) {
  const raw = await redis.get(`msgmeta:${id}`);
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

async function writeMeta(id, patch) {
  const current = await readMeta(id);
  const next = { ...current, ...patch };
  await redis.set(`msgmeta:${id}`, JSON.stringify(next), { ex: 60 * 60 * 24 * 90 });
  return next;
}

async function withMeta(msg) {
  if (!msg) return null;
  const meta = await readMeta(msg.id);
  return normalizeMessage({
    ...msg,
    content_type: meta.content_type || msg.content_type || 'text',
    media_url: meta.media_url || msg.media_url || null,
    is_encrypted: meta.is_encrypted !== undefined ? meta.is_encrypted : msg.is_encrypted !== false,
    reply_to: meta.reply_to || msg.reply_to || null,
    reactions: meta.reactions || {},
  });
}

const Message = {
  async ensureDmConversation(userA, userB) {
    const title = conversationIdFromUsers(userA, userB);

    // Prefer shared membership lookup to avoid duplicate DMs
    const { data: memberships } = await supabase
      .from('chat_members')
      .select('chat_id, user_id')
      .in('user_id', [userA, userB]);

    if (memberships?.length) {
      const counts = {};
      for (const m of memberships) {
        counts[m.chat_id] = (counts[m.chat_id] || 0) + 1;
      }
      const sharedIds = Object.keys(counts).filter((id) => counts[id] >= 2);
      for (const sharedId of sharedIds) {
        const { data: chat } = await supabase
          .from('chats')
          .select('*')
          .eq('id', sharedId)
          .eq('is_group', false)
          .maybeSingle();
        if (chat) return chat;
      }
    }

    const { data: existing } = await supabase
      .from('chats')
      .select('*, chat_members(*)')
      .eq('is_group', false)
      .eq('name', title)
      .maybeSingle();
    if (existing) return existing;

    const { data: chat, error } = await supabase
      .from('chats')
      .insert({
        name: title,
        is_group: false,
        created_by: userA,
      })
      .select()
      .single();
    if (error) throw error;

    const { error: memErr } = await supabase.from('chat_members').insert([
      { chat_id: chat.id, user_id: userA },
      { chat_id: chat.id, user_id: userB },
    ]);
    if (memErr) throw memErr;
    return chat;
  },

  async create({
    senderId,
    recipientId,
    content,
    contentType = 'text',
    mediaUrl = null,
    isEncrypted = true,
    replyTo = null,
  }) {
    await this.ensureDmConversation(senderId, recipientId);

    const { data, error } = await supabase
      .from('messages')
      .insert({
        from_user: senderId,
        to_user: recipientId,
        content,
        is_read: false,
      })
      .select()
      .single();
    if (error) throw error;

    await writeMeta(data.id, {
      content_type: contentType,
      media_url: mediaUrl,
      is_encrypted: isEncrypted !== false,
      reply_to: replyTo || null,
      reactions: {},
    });

    return withMeta(data);
  },

  async getWithUser(currentUserId, otherUserId, { limit = 100, before } = {}) {
    let query = supabase
      .from('messages')
      .select('*')
      .or(
        `and(from_user.eq.${currentUserId},to_user.eq.${otherUserId}),and(from_user.eq.${otherUserId},to_user.eq.${currentUserId})`
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error) throw error;
    return Promise.all((data || []).map((m) => withMeta(m)));
  },

  async findById(id) {
    const { data, error } = await supabase.from('messages').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return withMeta(data);
  },

  async react(id, userId, emoji) {
    const msg = await this.findById(id);
    if (!msg) return null;
    const meta = await readMeta(id);
    const reactions = { ...(meta.reactions || {}) };
    const set = new Set(reactions[emoji] || []);
    if (set.has(userId)) set.delete(userId);
    else set.add(userId);
    if (set.size) reactions[emoji] = Array.from(set);
    else delete reactions[emoji];
    await writeMeta(id, { reactions });
    return withMeta({ ...msg, reactions });
  },

  async markRead(id, userId) {
    const msg = await this.findById(id);
    if (!msg) return null;
    if (msg.recipient_id !== userId) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
    const { data, error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return withMeta({ ...data, read_at: new Date().toISOString() });
  },

  async softDelete(id, userId) {
    const msg = await this.findById(id);
    if (!msg) return null;
    if (msg.sender_id !== userId) {
      const err = new Error('Можно удалить только своё сообщение');
      err.status = 403;
      throw err;
    }
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) throw error;
    await redis.del(`msgmeta:${id}`);
    return msg;
  },

  async unreadCount(userId) {
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('to_user', userId)
      .eq('is_read', false);
    if (error) throw error;
    return count || 0;
  },

  async getConversations(userId) {
    const { data: memberships, error } = await supabase
      .from('chat_members')
      .select('*, chats(*)')
      .eq('user_id', userId);
    if (error) throw error;

    const byPeer = new Map();
    for (const m of memberships || []) {
      const chat = m.chats;
      if (!chat || chat.is_group) continue;

      const { data: members } = await supabase
        .from('chat_members')
        .select('user_id')
        .eq('chat_id', chat.id);
      const peerId = (members || []).map((x) => x.user_id).find((id) => id !== userId) || null;
      if (!peerId) continue;

      const msgs = await this.getWithUser(userId, peerId, { limit: 1 });
      const lastMsg = msgs[0] || null;
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('from_user', peerId)
        .eq('to_user', userId)
        .eq('is_read', false);

      const entry = {
        membership: m,
        conversation: {
          id: chat.id,
          type: 'dm',
          title: chat.name,
          created_by: chat.created_by,
          created_at: chat.created_at,
          peer_id: peerId,
        },
        last_message: lastMsg,
        unread: count || 0,
      };

      const prev = byPeer.get(peerId);
      if (!prev) {
        byPeer.set(peerId, entry);
      } else {
        const ta = prev.last_message?.created_at || '';
        const tb = lastMsg?.created_at || '';
        if (tb > ta) byPeer.set(peerId, entry);
      }
    }

    const result = Array.from(byPeer.values());
    result.sort((a, b) => {
      const ta = a.last_message?.created_at || a.conversation?.created_at || '';
      const tb = b.last_message?.created_at || b.conversation?.created_at || '';
      return tb.localeCompare(ta);
    });
    return result;
  },
};

module.exports = Message;
