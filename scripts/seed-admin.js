/**
 * Ensure creator admin exists with the given password.
 * Usage: node scripts/seed-admin.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const EMAIL = (process.env.ADMIN_EMAIL || 'gghaghja@example.com').toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin';
const USERNAME = process.env.ADMIN_USERNAME || 'fedya_creator';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const password_hash = await bcrypt.hash(PASSWORD, 12);
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('email', EMAIL)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('users')
      .update({
        password_hash,
        is_admin: true,
        is_banned: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    console.log('Admin password updated:', data.email, 'id=', data.id);
  } else {
    const { data, error } = await supabase
      .from('users')
      .insert({
        email: EMAIL,
        username: USERNAME,
        password_hash,
        is_admin: true,
        is_banned: false,
        is_premium: false,
      })
      .select()
      .single();
    if (error) throw error;
    console.log('Admin created:', data.email, 'id=', data.id);
  }

  // Award developer badge if present
  const { data: badge } = await supabase
    .from('badges')
    .select('id')
    .eq('name', 'Разработчик')
    .maybeSingle();
  if (badge) {
    const { data: user } = await supabase.from('users').select('id').eq('email', EMAIL).single();
    await supabase.from('user_badges').upsert({
      user_id: user.id,
      badge_id: badge.id,
      awarded_at: new Date().toISOString(),
    });
    console.log('Developer badge ensured');
  }

  console.log('Login with:', EMAIL, '/', PASSWORD);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
