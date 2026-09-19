alter table public.products
  add column if not exists front_image_url text,
  add column if not exists back_image_url text;

update public.products
set
  front_image_url = coalesce(front_image_url, image_url, './images/classic-zip-front.jpg'),
  back_image_url = coalesce(back_image_url, './images/classic-zip-back.jpg');

alter table public.product_variants
  add column if not exists reserved_stock integer not null default 0;

alter table public.product_variants
  drop constraint if exists product_variants_reserved_stock_check;

alter table public.product_variants
  add constraint product_variants_reserved_stock_check
  check (reserved_stock >= 0 and reserved_stock <= stock);

alter table public.orders
  add column if not exists stock_reservation_status text not null default 'none',
  add column if not exists stock_reserved_at timestamptz;

alter table public.orders
  drop constraint if exists orders_stock_reservation_status_check;

alter table public.orders
  add constraint orders_stock_reservation_status_check
  check (stock_reservation_status in ('none', 'reserved', 'committed', 'released'));

create index if not exists orders_stock_reservation_idx
on public.orders (stock_reservation_status, stock_reserved_at)
where stock_reservation_status = 'reserved';

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

create or replace function public.commit_order_stock(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_status text;
begin
  select stock_reservation_status
  into reservation_status
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if reservation_status = 'committed' then
    return true;
  end if;

  if reservation_status <> 'reserved' then
    return false;
  end if;

  perform 1
  from public.product_variants as variant
  join public.order_items as item on item.variant_id = variant.id
  where item.order_id = p_order_id
  order by variant.id
  for update of variant;

  update public.product_variants as variant
  set
    stock = variant.stock - purchased.quantity,
    reserved_stock = variant.reserved_stock - purchased.quantity
  from (
    select order_item.variant_id, sum(order_item.quantity)::integer as quantity
    from public.order_items as order_item
    where order_item.order_id = p_order_id
    group by order_item.variant_id
  ) as purchased
  where variant.id = purchased.variant_id;

  update public.orders
  set stock_reservation_status = 'committed'
  where id = p_order_id;

  return true;
end;
$$;

create or replace function public.release_order_stock(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_status text;
begin
  select stock_reservation_status
  into reservation_status
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if reservation_status = 'released' then
    return true;
  end if;

  if reservation_status <> 'reserved' then
    return false;
  end if;

  perform 1
  from public.product_variants as variant
  join public.order_items as item on item.variant_id = variant.id
  where item.order_id = p_order_id
  order by variant.id
  for update of variant;

  update public.product_variants as variant
  set reserved_stock = greatest(0, variant.reserved_stock - released.quantity)
  from (
    select order_item.variant_id, sum(order_item.quantity)::integer as quantity
    from public.order_items as order_item
    where order_item.order_id = p_order_id
    group by order_item.variant_id
  ) as released
  where variant.id = released.variant_id;

  update public.orders
  set stock_reservation_status = 'released'
  where id = p_order_id;

  return true;
end;
$$;

create or replace function public.release_expired_stock_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_order record;
  released_count integer := 0;
begin
  for expired_order in
    select id
    from public.orders
    where stock_reservation_status = 'reserved'
      and stock_reserved_at < now() - interval '35 minutes'
    order by id
  loop
    if public.release_order_stock(expired_order.id) then
      update public.orders
      set payment_status = 'cancelled', fulfillment_status = 'cancelled'
      where id = expired_order.id and payment_status = 'pending';
      released_count := released_count + 1;
    end if;
  end loop;

  return released_count;
end;
$$;

create or replace function public.commit_stock_when_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from new.payment_status then
    perform public.commit_order_stock(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_commit_stock_when_paid on public.orders;
create trigger orders_commit_stock_when_paid
after update of payment_status on public.orders
for each row execute function public.commit_stock_when_paid();

create or replace function public.release_stock_before_order_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.stock_reservation_status = 'reserved' then
    update public.product_variants as variant
    set reserved_stock = greatest(0, variant.reserved_stock - released.quantity)
    from (
      select order_item.variant_id, sum(order_item.quantity)::integer as quantity
      from public.order_items as order_item
      where order_item.order_id = old.id
      group by order_item.variant_id
    ) as released
    where variant.id = released.variant_id;
  end if;
  return old;
end;
$$;

drop trigger if exists orders_release_stock_before_delete on public.orders;
create trigger orders_release_stock_before_delete
before delete on public.orders
for each row execute function public.release_stock_before_order_delete();

revoke all on function public.reserve_order_stock(uuid) from public, anon, authenticated;
revoke all on function public.commit_order_stock(uuid) from public, anon, authenticated;
revoke all on function public.release_order_stock(uuid) from public, anon, authenticated;
revoke all on function public.release_expired_stock_reservations() from public, anon, authenticated;
revoke all on function public.commit_stock_when_paid() from public, anon, authenticated;
revoke all on function public.release_stock_before_order_delete() from public, anon, authenticated;

grant execute on function public.reserve_order_stock(uuid) to service_role;
grant execute on function public.commit_order_stock(uuid) to service_role;
grant execute on function public.release_order_stock(uuid) to service_role;
grant execute on function public.release_expired_stock_reservations() to service_role;

create or replace function public.admin_update_product_stock(p_product_id uuid, p_stocks jsonb)
returns void
language plpgsql
security definer
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

revoke all on function public.admin_update_product_stock(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_product_stock(uuid, jsonb) to authenticated;

grant update (front_image_url, back_image_url) on public.products to authenticated;
grant update (stock) on public.product_variants to authenticated;
grant delete on public.orders to authenticated;

create policy "Admins can update product images"
on public.products for update
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

create policy "Admins can update variant stock"
on public.product_variants for update
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

create policy "Admins can delete orders"
on public.orders for delete
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins can view product image objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can update product image objects"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can delete product image objects"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);
