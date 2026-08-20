/**
 * Seed badges. Run once:
 *   node scripts/seed-badges.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  );

  const badges = [
    { name: 'Разработчик', description: 'Создатель FedyaLM', color: '#111111', is_auto: true },
    { name: 'Верифицирован', description: 'Подтверждённый аккаунт', color: '#2563EB', is_auto: false },
    { name: 'Первое сообщение', description: 'Отправил первое сообщение', color: '#16A34A', is_auto: true },
    { name: 'Болтун', description: '10+ сообщений', color: '#CA8A04', is_auto: true },
    { name: 'Болтун+', description: '50+ сообщений', color: '#EA580C', is_auto: true },
  ];

  for (const b of badges) {
    const { data: existing } = await supabase
      .from('badges')
      .select('id,name')
      .eq('name', b.name)
      .maybeSingle();
    if (existing) {
      console.log('exists', b.name);
      continue;
    }
    const { error } = await supabase.from('badges').insert(b);
    if (error) console.error(b.name, error.message);
    else console.log('created', b.name);
  }

  const adminEmail = (process.env.ADMIN_EMAIL || 'gghaghja@example.com').toLowerCase();
  const { data: admin } = await supabase
    .from('users')
    .select('id,email')
    .eq('email', adminEmail)
    .maybeSingle();

  for (const name of ['Разработчик', 'Верифицирован']) {
    const { data: badge } = await supabase.from('badges').select('id').eq('name', name).maybeSingle();
    if (!admin || !badge) continue;
    const { data: link } = await supabase
      .from('user_badges')
      .select('id')
      .eq('user_id', admin.id)
      .eq('badge_id', badge.id)
      .maybeSingle();
    if (!link) {
      await supabase.from('user_badges').insert({ user_id: admin.id, badge_id: badge.id });
      console.log('awarded', name, 'to', adminEmail);
    }
  }

  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
