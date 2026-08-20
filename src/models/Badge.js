const { supabase } = require('../config/database');

const DEVELOPER_NAMES = new Set(['Разработчик', 'developer', 'Developer']);

const Badge = {
  isDeveloperBadge(badge) {
    return DEVELOPER_NAMES.has(badge?.name);
  },

  async list() {
    const { data, error } = await supabase.from('badges').select('*').order('name');
    if (error) throw error;
    return (data || []).map((b) => ({
      ...b,
      is_automatic: Boolean(b.is_auto),
      is_developer_only: DEVELOPER_NAMES.has(b.name),
      category: DEVELOPER_NAMES.has(b.name) ? 'special' : 'achievement',
    }));
  },

  async findById(id) {
    const { data, error } = await supabase.from('badges').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...data,
      is_automatic: Boolean(data.is_auto),
      is_developer_only: DEVELOPER_NAMES.has(data.name),
    };
  },

  async findByName(name) {
    const { data, error } = await supabase.from('badges').select('*').eq('name', name).maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(payload) {
    const row = {
      name: payload.name,
      description: payload.description || null,
      icon_url: payload.icon_url || payload.icon || null,
      color: payload.color || '#0D7377',
      is_auto: Boolean(payload.is_automatic || payload.is_auto),
    };
    const { data, error } = await supabase.from('badges').insert(row).select().single();
    if (error) throw error;
    return data;
  },

  async update(id, payload) {
    const row = {};
    if (payload.name !== undefined) row.name = payload.name;
    if (payload.description !== undefined) row.description = payload.description;
    if (payload.icon_url !== undefined || payload.icon !== undefined) {
      row.icon_url = payload.icon_url || payload.icon;
    }
    if (payload.color !== undefined) row.color = payload.color;
    if (payload.is_automatic !== undefined || payload.is_auto !== undefined) {
      row.is_auto = Boolean(payload.is_automatic ?? payload.is_auto);
    }

    const { data, error } = await supabase.from('badges').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async remove(id) {
    const badge = await this.findById(id);
    if (this.isDeveloperBadge(badge)) {
      const err = new Error('Нельзя удалить значок разработчика');
      err.status = 400;
      throw err;
    }
    const { error } = await supabase.from('badges').delete().eq('id', id);
    if (error) throw error;
    return true;
  },

  async getUserBadges(userId) {
    const { data, error } = await supabase
      .from('user_badges')
      .select('awarded_at, badges(*)')
      .eq('user_id', userId);
    if (error) throw error;
    return (data || []).map((row) => ({
      ...row.badges,
      awarded_at: row.awarded_at,
    }));
  },

  async availableForUser(userId) {
    const all = await this.list();
    const owned = await this.getUserBadges(userId);
    const ownedIds = new Set(owned.map((b) => b.id));
    return all.filter((b) => !ownedIds.has(b.id) && !DEVELOPER_NAMES.has(b.name));
  },

  async award(badgeId, userId) {
    const badge = await this.findById(badgeId);
    if (!badge) {
      const err = new Error('Значок не найден');
      err.status = 404;
      throw err;
    }
    if (this.isDeveloperBadge(badge)) {
      const err = new Error('Значок разработчика выдаётся только автоматически');
      err.status = 403;
      throw err;
    }
    const { data, error } = await supabase
      .from('user_badges')
      .upsert({
        user_id: userId,
        badge_id: badgeId,
        awarded_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async revoke(badgeId, userId) {
    const badge = await this.findById(badgeId);
    if (this.isDeveloperBadge(badge)) {
      const err = new Error('Нельзя отозвать значок разработчика');
      err.status = 403;
      throw err;
    }
    const { error } = await supabase
      .from('user_badges')
      .delete()
      .eq('user_id', userId)
      .eq('badge_id', badgeId);
    if (error) throw error;
    return true;
  },
};

module.exports = Badge;
