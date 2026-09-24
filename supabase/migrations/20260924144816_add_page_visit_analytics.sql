create table if not exists public.page_visit_daily (
  visit_date date not null default current_date,
  page_path text not null,
  visit_count bigint not null default 0 check (visit_count >= 0),
  primary key (visit_date, page_path),
  constraint page_visit_daily_path_length check (char_length(page_path) between 1 and 120)
);

alter table public.page_visit_daily enable row level security;

drop policy if exists "Admins can view page visit analytics" on public.page_visit_daily;
create policy "Admins can view page visit analytics"
on public.page_visit_daily for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create or replace function public.record_page_visit(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_path text;
begin
  normalized_path := left(coalesce(nullif(split_part(trim(p_path), '?', 1), ''), '/'), 120);

  if normalized_path like '%admin%' then
    return;
  end if;

  insert into public.page_visit_daily (visit_date, page_path, visit_count)
  values ((now() at time zone 'Europe/Warsaw')::date, normalized_path, 1)
  on conflict (visit_date, page_path)
  do update set visit_count = public.page_visit_daily.visit_count + 1;
end;
$$;

revoke all on table public.page_visit_daily from anon, authenticated;
grant select on table public.page_visit_daily to authenticated;

revoke all on function public.record_page_visit(text) from public;
grant execute on function public.record_page_visit(text) to anon, authenticated;
