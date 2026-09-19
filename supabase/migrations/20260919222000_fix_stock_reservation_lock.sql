create or replace function public.reserve_order_stock(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_status text;
  item record;
begin
  select stock_reservation_status
  into reservation_status
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if reservation_status in ('reserved', 'committed') then
    return true;
  end if;

  if reservation_status = 'released' then
    return false;
  end if;

  perform 1
  from public.product_variants as variant
  join public.order_items as order_line on order_line.variant_id = variant.id
  where order_line.order_id = p_order_id
  order by variant.id
  for update of variant;

  for item in
    select order_item.variant_id, sum(order_item.quantity)::integer as quantity
    from public.order_items as order_item
    where order_item.order_id = p_order_id
    group by order_item.variant_id
  loop
    if item.variant_id is null or not exists (
      select 1
      from public.product_variants as variant
      where variant.id = item.variant_id
        and variant.active = true
        and variant.stock - variant.reserved_stock >= item.quantity
    ) then
      return false;
    end if;
  end loop;

  update public.product_variants as variant
  set reserved_stock = variant.reserved_stock + reserved.quantity
  from (
    select order_item.variant_id, sum(order_item.quantity)::integer as quantity
    from public.order_items as order_item
    where order_item.order_id = p_order_id
    group by order_item.variant_id
  ) as reserved
  where variant.id = reserved.variant_id;

  update public.orders
  set stock_reservation_status = 'reserved', stock_reserved_at = now()
  where id = p_order_id;

  return true;
end;
$$;

revoke all on function public.reserve_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.reserve_order_stock(uuid) to service_role;
