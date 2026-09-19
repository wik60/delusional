drop policy if exists "Approved GitHub email can register as admin" on public.admin_users;

create policy "Designated employee can register as admin"
on public.admin_users for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  and lower(email) = 'delusionalemployee@admin.delusionalcrew.pl'
);
