create index orders_shipping_method_id_idx on public.orders (shipping_method_id);

grant select on public.shipping_methods to anon, authenticated;

create policy "Public can view active shipping methods"
on public.shipping_methods for select
to anon, authenticated
using (active = true);
