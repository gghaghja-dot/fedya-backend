const { supabase } = require('../config/database');
const logger = require('./logger');

/** Map internal keys → names already seeded in Supabase badges table */
const BADGE_NAME_MAP = {
  developer: 'Разработчик',
  premium: 'Премиум',
  first_message: 'Первое сообщение',
  chatterbox: 'Болтун',
  veteran: 'Старожил',
  popular: 'Популярный',
  group_master: 'Мастер групп',
};

function resolveBadgeName(name) {
  return BADGE_NAME_MAP[name] || name;
}

async function awardBadgeByName(userId, badgeName) {
  const name = resolveBadgeName(badgeName);
  const { data: badge } = await supabase
    .from('badges')
    .select('*')
    .eq('name', name)
    .maybeSingle();
  if (!badge) return null;

  const { data: existing } = await supabase
    .from('user_badges')
    .select('badge_id')
    .eq('user_id', userId)
    .eq('badge_id', badge.id)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from('user_badges')
    .insert({
      user_id: userId,
      badge_id: badge.id,
    })
    .select()
    .maybeSingle();

  if (error) {
    logger.error('awardBadge failed', error);
    return null;
  }
  return data;
}

async function ensureDeveloperBadge(user) {
  if (!user) return;
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (user.email.toLowerCase() !== adminEmail) return;

  await awardBadgeByName(user.id, 'developer');
  if (!user.is_admin) {
    await supabase.from('users').update({ is_admin: true }).eq('id', user.id);
  }
}

async function countUserMessages(userId) {
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('from_user', userId);
  return count || 0;
}

async function countGroupsCreated(userId) {
  const { count } = await supabase
    .from('chats')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', userId)
    .eq('is_group', true);
  return count || 0;
}

async function countFriends(userId) {
  const { data: memberships } = await supabase
    .from('chat_members')
    .select('chat_id')
    .eq('user_id', userId);

  if (!memberships?.length) return 0;

  const chatIds = memberships.map((m) => m.chat_id);
  const { data: chats } = await supabase
    .from('chats')
    .select('id')
    .in('id', chatIds)
    .eq('is_group', false);

  return chats?.length || 0;
}

async function evaluateAutoBadges(userId) {
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if (!user) return [];

  const awarded = [];
  const messages = await countUserMessages(userId);

  if (messages >= 1) {
    const r = await awardBadgeByName(userId, 'first_message');
    if (r) awarded.push('first_message');
  }
  if (messages >= 1000) {
    const r = await awardBadgeByName(userId, 'chatterbox');
    if (r) awarded.push('chatterbox');
  }

  const ageDays = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays >= 365) {
    const r = await awardBadgeByName(userId, 'veteran');
    if (r) awarded.push('veteran');
  }

  const friends = await countFriends(userId);
  if (friends >= 100) {
    const r = await awardBadgeByName(userId, 'popular');
    if (r) awarded.push('popular');
  }

  const groups = await countGroupsCreated(userId);
  if (groups >= 5) {
    const r = await awardBadgeByName(userId, 'group_master');
    if (r) awarded.push('group_master');
  }

  const premium =
    user.is_premium ||
    (user.premium_until && new Date(user.premium_until) > new Date());
  if (premium) {
    const r = await awardBadgeByName(userId, 'premium');
    if (r) awarded.push('premium');
  }

  return awarded;
}

module.exports = {
  awardBadgeByName,
  ensureDeveloperBadge,
  evaluateAutoBadges,
  BADGE_NAME_MAP,
};
