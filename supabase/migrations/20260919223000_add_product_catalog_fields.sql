alter table public.products
  add column if not exists size_guide jsonb not null default '[]'::jsonb;

alter table public.products
  drop constraint if exists products_size_guide_array_check;

alter table public.products
  add constraint products_size_guide_array_check
  check (jsonb_typeof(size_guide) = 'array');

update public.products
set size_guide = '[
  {"size":"S","chest":"64","length":"64","sleeve":"61"},
  {"size":"M","chest":"66","length":"66","sleeve":"62"},
  {"size":"L","chest":"68","length":"68","sleeve":"63"},
  {"size":"XL","chest":"72","length":"72","sleeve":"65"}
]'::jsonb
where slug = 'delusional-classic-zip-up'
  and size_guide = '[]'::jsonb;

grant insert on public.products, public.product_variants to authenticated;
grant delete on public.product_variants to authenticated;
grant update (name, slug, description, price, compare_at_price, active, size_guide) on public.products to authenticated;
grant update (size, stock, active) on public.product_variants to authenticated;

create policy "Admins can view all products"
on public.products for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can create products"
on public.products for insert
to authenticated
with check (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can view all variants"
on public.product_variants for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can create variants"
on public.product_variants for insert
to authenticated
with check (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can delete variants"
on public.product_variants for delete
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create or replace function public.admin_save_product(
  p_product_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_price numeric,
  p_compare_at_price numeric,
  p_active boolean,
  p_size_guide jsonb,
  p_variants jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_product_id uuid := p_product_id;
  variant_item jsonb;
  guide_item jsonb;
  variant_id uuid;
  variant_size text;
  variant_stock integer;
  provided_ids uuid[] := '{}'::uuid[];
  seen_sizes text[] := '{}'::text[];
begin
  if not exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  ) then
    raise exception 'Administrator access required';
  end if;

  p_name := trim(p_name);
  p_slug := lower(trim(p_slug));
  p_description := trim(coalesce(p_description, ''));

  if char_length(p_name) < 2 or char_length(p_name) > 120 then
    raise exception 'Product name must contain 2-120 characters';
  end if;
  if p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(p_slug) > 120 then
    raise exception 'Invalid product slug';
  end if;
  if char_length(p_description) > 5000 then
    raise exception 'Product description is too long';
  end if;
  if p_price is null or p_price < 0 or p_price > 999999 then
    raise exception 'Invalid product price';
  end if;
  if p_compare_at_price is not null and (p_compare_at_price < p_price or p_compare_at_price > 999999) then
    raise exception 'Compare-at price must be greater than or equal to price';
  end if;
  if jsonb_typeof(p_size_guide) <> 'array' or jsonb_array_length(p_size_guide) > 30 then
    raise exception 'Invalid size guide';
  end if;
  if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) < 1 or jsonb_array_length(p_variants) > 30 then
    raise exception 'Add between 1 and 30 product variants';
  end if;

  for guide_item in select value from jsonb_array_elements(p_size_guide)
  loop
    if char_length(trim(coalesce(guide_item ->> 'size', ''))) < 1
       or char_length(trim(coalesce(guide_item ->> 'size', ''))) > 12
       or char_length(coalesce(guide_item ->> 'chest', '')) > 20
       or char_length(coalesce(guide_item ->> 'length', '')) > 20
       or char_length(coalesce(guide_item ->> 'sleeve', '')) > 20 then
      raise exception 'Invalid size guide row';
    end if;
  end loop;

  if saved_product_id is null then
    insert into public.products (
      name, slug, description, price, compare_at_price, currency, active, size_guide
    ) values (
      p_name, p_slug, p_description, p_price, p_compare_at_price, 'PLN', coalesce(p_active, true), p_size_guide
    ) returning id into saved_product_id;
  else
    update public.products
    set
      name = p_name,
      slug = p_slug,
      description = p_description,
      price = p_price,
      compare_at_price = p_compare_at_price,
      active = coalesce(p_active, true),
      size_guide = p_size_guide
    where id = saved_product_id;

    if not found then
      raise exception 'Product not found';
    end if;
  end if;

  for variant_item in select value from jsonb_array_elements(p_variants)
  loop
    variant_size := upper(trim(coalesce(variant_item ->> 'size', '')));
    variant_stock := (variant_item ->> 'stock')::integer;

    if variant_size !~ '^[A-Z0-9]{1,12}$' then
      raise exception 'Invalid variant size';
    end if;
    if variant_size = any(seen_sizes) then
      raise exception 'Variant sizes must be unique';
    end if;
    if variant_stock < 0 or variant_stock > 99999 then
      raise exception 'Invalid variant stock';
    end if;
    seen_sizes := array_append(seen_sizes, variant_size);

    if coalesce(variant_item ->> 'id', '') <> '' then
      variant_id := (variant_item ->> 'id')::uuid;
      update public.product_variants
      set stock = variant_stock, active = true
      where id = variant_id
        and product_id = saved_product_id
        and size = variant_size
        and variant_stock >= reserved_stock;
      if not found then
        raise exception 'Variant could not be updated';
      end if;
      provided_ids := array_append(provided_ids, variant_id);
    else
      insert into public.product_variants (product_id, size, sku, stock, active)
      values (
        saved_product_id,
        variant_size,
        'DC-' || upper(substr(replace(saved_product_id::text, '-', ''), 1, 8)) || '-' || variant_size,
        variant_stock,
        true
      )
      returning id into variant_id;
      provided_ids := array_append(provided_ids, variant_id);
    end if;
  end loop;

  if exists (
    select 1
    from public.product_variants
    where product_id = saved_product_id
      and not (id = any(provided_ids))
      and reserved_stock > 0
  ) then
    raise exception 'A reserved variant cannot be removed';
  end if;

  delete from public.product_variants
  where product_id = saved_product_id
    and not (id = any(provided_ids));

  return saved_product_id;
end;
$$;

revoke all on function public.admin_save_product(uuid, text, text, text, numeric, numeric, boolean, jsonb, jsonb)
from public, anon;
grant execute on function public.admin_save_product(uuid, text, text, text, numeric, numeric, boolean, jsonb, jsonb)
to authenticated;
