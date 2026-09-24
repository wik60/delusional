create table if not exists public.store_settings (
  id text primary key check (id = 'storefront'),
  sales_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id, sales_enabled)
values ('storefront', false)
on conflict (id) do nothing;

alter table public.store_settings enable row level security;

grant select on public.store_settings to anon, authenticated;
grant update (sales_enabled, updated_at) on public.store_settings to authenticated;

create policy "Store settings are publicly readable"
on public.store_settings for select
to anon, authenticated
using (id = 'storefront');

create policy "Admins can update store settings"
on public.store_settings for update
to authenticated
using (
  id = 'storefront'
  and exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
)
with check (
  id = 'storefront'
  and exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);
