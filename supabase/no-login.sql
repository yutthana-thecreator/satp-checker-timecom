-- SATP Checker — เปิดให้ใช้ฐานความรู้ร่วมโดยไม่ต้อง login (ใครที่รู้ URL เว็บก็อ่าน/เขียนได้)
-- รันหลัง schema.sql ใน Supabase Dashboard → SQL Editor (รันซ้ำได้)
do $$
declare t text;
begin
  foreach t in array array['issue_decisions', 'image_decisions', 'learned_profiles', 'ref_images', 'section_stats'] loop
    execute format('drop policy if exists kb_anon on %I', t);
    execute format('create policy kb_anon on %I for all to anon using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to anon', t);
  end loop;
end $$;

drop policy if exists thumbs_anon_read on storage.objects;
drop policy if exists thumbs_anon_write on storage.objects;
drop policy if exists thumbs_anon_update on storage.objects;
drop policy if exists thumbs_anon_delete on storage.objects;
create policy thumbs_anon_read on storage.objects for select to anon using (bucket_id = 'ref-thumbs');
create policy thumbs_anon_write on storage.objects for insert to anon with check (bucket_id = 'ref-thumbs');
create policy thumbs_anon_update on storage.objects for update to anon using (bucket_id = 'ref-thumbs') with check (bucket_id = 'ref-thumbs');
create policy thumbs_anon_delete on storage.objects for delete to anon using (bucket_id = 'ref-thumbs');
