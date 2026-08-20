/**
 * Seed developer + verified badges. Run once after deploy:
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
    {
      name: 'Разработчик',
      description: 'Создатель FedyaLM',
      color: '#111111',
      icon_url: null,
      is_auto: true,
    },
    {
      name: 'Верифицирован',
      description: 'Подтверждённый аккаунт',
      color: '#2563EB',
      icon_url: null,
      is_auto: false,
    },
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
  const { data: devBadge } = await supabase
    .from('badges')
    .select('id')
    .eq('name', 'Разработчик')
    .maybeSingle();

  if (admin && devBadge) {
    const { data: link } = await supabase
      .from('user_badges')
      .select('id')
      .eq('user_id', admin.id)
      .eq('badge_id', devBadge.id)
      .maybeSingle();
    if (!link) {
      await supabase.from('user_badges').insert({
        user_id: admin.id,
        badge_id: devBadge.id,
      });
      console.log('awarded developer badge to', adminEmail);
    }
  }

  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
