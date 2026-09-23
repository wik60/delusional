alter table public.newsletter_subscribers
  add column if not exists active boolean not null default true,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists newsletter_unsubscribe_token_idx
  on public.newsletter_subscribers (unsubscribe_token);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('customer', 'newsletter')),
  recipient_email text,
  subject text not null,
  message text not null,
  recipient_count integer not null default 1 check (recipient_count >= 0),
  sent_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.email_campaigns enable row level security;
revoke insert on public.newsletter_subscribers from anon, authenticated;
grant insert (email) on public.newsletter_subscribers to anon, authenticated;
grant select on public.newsletter_subscribers, public.email_campaigns to authenticated;
grant update (active, unsubscribed_at) on public.newsletter_subscribers to authenticated;

create policy "Admins can view newsletter subscribers"
on public.newsletter_subscribers for select to authenticated
using (exists (select 1 from public.admin_users where admin_users.user_id = (select auth.uid())));

create policy "Admins can update newsletter subscribers"
on public.newsletter_subscribers for update to authenticated
using (exists (select 1 from public.admin_users where admin_users.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users where admin_users.user_id = (select auth.uid())));

create policy "Admins can view email campaigns"
on public.email_campaigns for select to authenticated
using (exists (select 1 from public.admin_users where admin_users.user_id = (select auth.uid())));
