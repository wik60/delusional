grant delete on public.contact_messages to authenticated;

create policy "Admins can delete contact messages"
on public.contact_messages for delete
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);
