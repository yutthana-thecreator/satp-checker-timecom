-- SATP Checker — ฐานความรู้ร่วมของทีม
-- รันทั้งไฟล์นี้ใน Supabase Dashboard → SQL Editor (รันซ้ำได้)
-- เก็บเฉพาะสิ่งที่ระบบเรียนรู้: การตัดสินใจประเด็น, ผล Accept/Reject (hash), โปรไฟล์ที่เรียนรู้, รูปย่ออ้างอิง, สถิติจำนวนรูป
-- ไม่มีไฟล์ PDF หรือข้อความเอกสารลูกค้า

-- ---------- ใครเข้าใช้ได้ ----------
create table if not exists allowed_domains (domain text primary key);
create table if not exists allowed_users (email text primary key, note text, added_at timestamptz default now());
insert into allowed_domains (domain) values ('nokia.com') on conflict do nothing;
-- เพิ่มอีเมลรายคน (นอกโดเมน) เช่น:
-- insert into allowed_users (email, note) values ('someone@example.com', 'ROM') on conflict do nothing;

create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    exists (select 1 from allowed_users u where lower(u.email) = lower(auth.jwt() ->> 'email'))
    or exists (select 1 from allowed_domains d where lower(split_part(auth.jwt() ->> 'email', '@', 2)) = lower(d.domain)),
    false);
$$;
revoke all on allowed_users, allowed_domains from anon, authenticated;

-- ---------- ตารางฐานความรู้ (key + data jsonb) ----------
do $$
declare t text;
begin
  foreach t in array array['issue_decisions', 'image_decisions', 'learned_profiles', 'ref_images', 'section_stats'] loop
    execute format('create table if not exists %I (key text primary key, data jsonb not null default ''{}''::jsonb, updated_at timestamptz not null default now(), updated_by text)', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists kb_read on %I', t);
    execute format('drop policy if exists kb_write on %I', t);
    execute format('create policy kb_read on %I for select to authenticated using (is_allowed())', t);
    execute format('create policy kb_write on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t);
  end loop;
end $$;

-- ---------- Storage: รูปย่ออ้างอิง ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ref-thumbs', 'ref-thumbs', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

drop policy if exists thumbs_read on storage.objects;
drop policy if exists thumbs_write on storage.objects;
drop policy if exists thumbs_update on storage.objects;
drop policy if exists thumbs_delete on storage.objects;
create policy thumbs_read on storage.objects for select to authenticated using (bucket_id = 'ref-thumbs' and is_allowed());
create policy thumbs_write on storage.objects for insert to authenticated with check (bucket_id = 'ref-thumbs' and is_allowed());
create policy thumbs_update on storage.objects for update to authenticated using (bucket_id = 'ref-thumbs' and is_allowed()) with check (bucket_id = 'ref-thumbs' and is_allowed());
create policy thumbs_delete on storage.objects for delete to authenticated using (bucket_id = 'ref-thumbs' and is_allowed());
