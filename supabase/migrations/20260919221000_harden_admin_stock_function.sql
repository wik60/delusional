create or replace function public.admin_update_product_stock(p_product_id uuid, p_stocks jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stock_item jsonb;
  variant_id uuid;
  new_stock integer;
begin
  if not exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  ) then
    raise exception 'Administrator access required';
  end if;

  if jsonb_typeof(p_stocks) <> 'array' or jsonb_array_length(p_stocks) = 0 then
    raise exception 'Invalid stock payload';
  end if;

  perform 1
  from public.product_variants
  where product_id = p_product_id
  order by id
  for update;

  for stock_item in select value from jsonb_array_elements(p_stocks)
  loop
    variant_id := (stock_item ->> 'id')::uuid;
    new_stock := (stock_item ->> 'stock')::integer;

    if new_stock < 0 or new_stock > 99999 then
      raise exception 'Invalid stock value';
    end if;

    update public.product_variants
    set stock = new_stock
    where id = variant_id
      and product_id = p_product_id
      and new_stock >= reserved_stock;

    if not found then
      raise exception 'Stock cannot be lower than reserved stock';
    end if;
  end loop;
end;
$$;
