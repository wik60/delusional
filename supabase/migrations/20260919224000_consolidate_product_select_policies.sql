drop policy if exists "Public can view active products" on public.products;
drop policy if exists "Admins can view all products" on public.products;

create policy "Anonymous can view active products"
on public.products
for select
to anon
using (active = true);

create policy "Authenticated users can view allowed products"
on public.products
for select
to authenticated
using (
  active = true
  or exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  )
);

drop policy if exists "Public can view active variants" on public.product_variants;
drop policy if exists "Admins can view all variants" on public.product_variants;

create policy "Anonymous can view active variants"
on public.product_variants
for select
to anon
using (
  active = true
  and exists (
    select 1
    from public.products
    where products.id = product_variants.product_id
      and products.active = true
  )
);

create policy "Authenticated users can view allowed variants"
on public.product_variants
for select
to authenticated
using (
  (
    active = true
    and exists (
      select 1
      from public.products
      where products.id = product_variants.product_id
        and products.active = true
    )
  )
  or exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  )
);
