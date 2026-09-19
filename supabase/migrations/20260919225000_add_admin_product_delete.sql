grant delete on public.products to authenticated;

create policy "Admins can delete products"
on public.products
for delete
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create or replace function public.admin_delete_product(p_product_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product_is_active boolean;
begin
  if not exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  ) then
    raise exception 'Administrator access required';
  end if;

  select active
  into product_is_active
  from public.products
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  if product_is_active and not exists (
    select 1
    from public.products
    where id <> p_product_id
      and active = true
  ) then
    raise exception 'The last active product cannot be deleted';
  end if;

  if exists (
    select 1
    from public.order_items
    join public.orders on orders.id = order_items.order_id
    where order_items.product_id = p_product_id
      and orders.payment_status in ('pending', 'paid')
      and orders.fulfillment_status not in ('shipped', 'cancelled')
  ) then
    raise exception 'Product has an open order';
  end if;

  delete from public.products
  where id = p_product_id;

  return found;
end;
$$;

revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;
