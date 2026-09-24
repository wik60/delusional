revoke all on table public.store_settings from anon, authenticated;
grant select on table public.store_settings to anon, authenticated;
grant update (sales_enabled, updated_at) on table public.store_settings to authenticated;
