create table if not exists public.page_visit_location_daily (
  visit_date date not null default current_date,
  city text not null,
  country text not null,
  visit_count bigint not null default 0 check (visit_count >= 0),
  primary key (visit_date, city, country),
  constraint page_visit_location_city_length check (char_length(city) between 1 and 100),
  constraint page_visit_location_country_length check (char_length(country) between 1 and 100)
);

alter table public.page_visit_location_daily enable row level security;

drop policy if exists "Admins can view visit locations" on public.page_visit_location_daily;
create policy "Admins can view visit locations"
on public.page_visit_location_daily for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create or replace function public.record_visit_location(p_city text, p_country text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_city text := left(trim(coalesce(p_city, '')), 100);
  normalized_country text := left(trim(coalesce(p_country, '')), 100);
begin
  if char_length(normalized_city) < 1 or char_length(normalized_country) < 1 then
    return;
  end if;

  insert into public.page_visit_location_daily (visit_date, city, country, visit_count)
  values ((now() at time zone 'Europe/Warsaw')::date, normalized_city, normalized_country, 1)
  on conflict (visit_date, city, country)
  do update set visit_count = public.page_visit_location_daily.visit_count + 1;
end;
$$;

revoke all on table public.page_visit_location_daily from anon, authenticated;
grant select on table public.page_visit_location_daily to authenticated;

revoke all on function public.record_visit_location(text, text) from public;
grant execute on function public.record_visit_location(text, text) to anon, authenticated;
