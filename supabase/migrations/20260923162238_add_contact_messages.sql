create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  email text not null check (email = lower(email) and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  subject text not null check (char_length(trim(subject)) between 3 and 160),
  message text not null check (char_length(trim(message)) between 10 and 5000),
  status text not null default 'new' check (status in ('new', 'replied')),
  reply_body text check (reply_body is null or char_length(trim(reply_body)) between 1 and 5000),
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create index contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index contact_messages_status_idx on public.contact_messages (status, created_at desc);

alter table public.contact_messages enable row level security;

grant insert on public.contact_messages to anon, authenticated;
grant select on public.contact_messages to authenticated;
grant update (status, reply_body, replied_at) on public.contact_messages to authenticated;

create policy "Visitors can send contact messages"
on public.contact_messages for insert
to anon, authenticated
with check (status = 'new' and reply_body is null and replied_at is null);

create policy "Admins can view contact messages"
on public.contact_messages for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can update contact messages"
on public.contact_messages for update
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);
