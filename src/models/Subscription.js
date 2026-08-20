const { supabase } = require('../config/database');
const { redis } = require('../config/redis');
const { addDays, isPremium } = require('../utils/helpers');
const { awardBadgeByName } = require('../services/badgeEngine');

/** Built-in plans — table premium_plans may not exist in current Supabase. */
const DEFAULT_PLANS = [
  {
    id: 'plan_month',
    code: 'month',
    name: 'Премиум Месяц',
    duration_days: 30,
    price_usd: 4.99,
    features: ['1 ГБ файлы', 'темы', 'стикеры', 'каналы'],
    active: true,
  },
  {
    id: 'plan_year',
    code: 'year',
    name: 'Премиум Год',
    duration_days: 365,
    price_usd: 39.99,
    features: ['всё из месяца', 'скидка 20%', 'приоритет'],
    active: true,
  },
  {
    id: 'plan_lifetime',
    code: 'lifetime',
    name: 'Лайфтайм',
    duration_days: null,
    price_usd: 99.99,
    features: ['все функции навсегда'],
    active: true,
  },
];

const Subscription = {
  async listPlans() {
    return DEFAULT_PLANS;
  },

  async findPlanByCode(code) {
    return DEFAULT_PLANS.find((p) => p.code === code) || null;
  },

  async activatePlan(userId, planCode) {
    const plan = await this.findPlanByCode(planCode);
    if (!plan) {
      const err = new Error('План не найден');
      err.status = 404;
      throw err;
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    let expiresAt = null;
    let lifetime = false;

    if (plan.duration_days == null) {
      lifetime = true;
    } else {
      const base =
        user.premium_until && new Date(user.premium_until) > new Date()
          ? new Date(user.premium_until)
          : new Date();
      expiresAt = addDays(base, plan.duration_days);
    }

    const { data: sub, error } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan: plan.code,
        status: 'active',
        started_at: new Date().toISOString(),
        expires_at: expiresAt ? expiresAt.toISOString() : null,
      })
      .select()
      .single();
    if (error) throw error;

    await supabase
      .from('users')
      .update({
        is_premium: true,
        premium_until: expiresAt ? expiresAt.toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    await awardBadgeByName(userId, 'Премиум');
    return sub;
  },

  async grantDays(userId, days) {
    if (days === 'lifetime' || days === null || days === 'null') {
      await supabase
        .from('users')
        .update({
          is_premium: true,
          premium_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      const { data: sub } = await supabase
        .from('subscriptions')
        .insert({
          user_id: userId,
          plan: 'lifetime',
          status: 'active',
          started_at: new Date().toISOString(),
          expires_at: null,
        })
        .select()
        .single();

      await awardBadgeByName(userId, 'Премиум');
      return sub;
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    const base =
      user.premium_until && new Date(user.premium_until) > new Date()
        ? new Date(user.premium_until)
        : new Date();
    const expiresAt = addDays(base, Number(days));

    await supabase
      .from('users')
      .update({
        is_premium: true,
        premium_until: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    const { data: sub, error } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan: `days_${days}`,
        status: 'active',
        started_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    await awardBadgeByName(userId, 'Премиум');
    return sub;
  },

  async revoke(userId) {
    await supabase
      .from('users')
      .update({
        is_premium: false,
        premium_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('status', 'active');

    return true;
  },

  async status(userId) {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    const { data: active } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      is_premium: isPremium(user),
      is_lifetime_premium: Boolean(user.is_premium && !user.premium_until),
      premium_until: user.premium_until,
      subscription: active,
    };
  },

  async history(userId) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async redeemPromo(userId, code) {
    const key = `promo:${String(code).toUpperCase()}`;
    const raw = await redis.get(key);
    if (!raw) {
      const err = new Error('Промо-код не найден');
      err.status = 404;
      throw err;
    }

    const promo = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!promo.active) {
      const err = new Error('Промо-код неактивен');
      err.status = 400;
      throw err;
    }
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      const err = new Error('Промо-код истёк');
      err.status = 400;
      throw err;
    }
    if (promo.max_uses != null && promo.used_count >= promo.max_uses) {
      const err = new Error('Лимит использований исчерпан');
      err.status = 400;
      throw err;
    }

    const usedKey = `promo_used:${promo.code}:${userId}`;
    if (await redis.get(usedKey)) {
      const err = new Error('Вы уже использовали этот код');
      err.status = 400;
      throw err;
    }

    let subscription = null;
    if (promo.type === 'premium_days') {
      subscription = await this.grantDays(userId, promo.value);
    }

    promo.used_count = (promo.used_count || 0) + 1;
    await redis.set(key, JSON.stringify(promo));
    await redis.set(usedKey, '1', { ex: 60 * 60 * 24 * 365 });

    return { promo, subscription };
  },

  async createPromo({ code, type, value, max_uses, expires_at }) {
    const promo = {
      code: String(code).toUpperCase(),
      type: type || 'premium_days',
      value: Number(value) || 7,
      max_uses: max_uses == null ? null : Number(max_uses),
      used_count: 0,
      expires_at: expires_at || null,
      active: true,
      created_at: new Date().toISOString(),
    };
    await redis.set(`promo:${promo.code}`, JSON.stringify(promo));
    return promo;
  },
};

module.exports = Subscription;
