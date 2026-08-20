const { supabase } = require('../config/database');
const { conversationIdFromUsers, normalizeMessage } = require('../utils/helpers');

const Message = {
  async ensureDmConversation(userA, userB) {
    const title = conversationIdFromUsers(userA, userB);

    const { data: existing } = await supabase
      .from('chats')
      .select('*, chat_members(*)')
      .eq('is_group', false)
      .eq('name', title)
      .maybeSingle();

    if (existing) return existing;

    // Fallback: find shared DM via members
    const { data: memberships } = await supabase
      .from('chat_members')
      .select('chat_id, user_id')
      .in('user_id', [userA, userB]);

    if (memberships?.length) {
      const counts = {};
      for (const m of memberships) {
        counts[m.chat_id] = (counts[m.chat_id] || 0) + 1;
      }
      const sharedId = Object.keys(counts).find((id) => counts[id] >= 2);
      if (sharedId) {
        const { data: chat } = await supabase
          .from('chats')
          .select('*')
          .eq('id', sharedId)
          .eq('is_group', false)
          .maybeSingle();
        if (chat) return chat;
      }
    }

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

    return normalizeMessage({
      ...data,
      content_type: contentType,
      media_url: mediaUrl,
      is_encrypted: isEncrypted,
    });
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
    return (data || []).map(normalizeMessage);
  },

  async findById(id) {
    const { data, error } = await supabase.from('messages').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return normalizeMessage(data);
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
    return normalizeMessage({ ...data, read_at: new Date().toISOString() });
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

    const result = [];
    for (const m of memberships || []) {
      const chat = m.chats;
      if (!chat) continue;

      // Last message between members of this DM (or any for group)
      let lastMsg = null;
      let unread = 0;
      let peerId = null;

      if (!chat.is_group) {
        const { data: members } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chat.id);
        peerId = (members || []).map((x) => x.user_id).find((id) => id !== userId) || null;

        if (peerId) {
          const msgs = await this.getWithUser(userId, peerId, { limit: 1 });
          lastMsg = msgs[0] || null;
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('from_user', peerId)
            .eq('to_user', userId)
            .eq('is_read', false);
          unread = count || 0;
        }
      }

      result.push({
        membership: m,
        conversation: {
          id: chat.id,
          type: chat.is_group ? 'group' : 'dm',
          title: chat.name,
          created_by: chat.created_by,
          created_at: chat.created_at,
          peer_id: peerId,
        },
        last_message: lastMsg,
        unread,
      });
    }

    result.sort((a, b) => {
      const ta = a.last_message?.created_at || a.conversation?.created_at || '';
      const tb = b.last_message?.created_at || b.conversation?.created_at || '';
      return tb.localeCompare(ta);
    });

    return result;
  },
};

module.exports = Message;
