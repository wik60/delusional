create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  compare_at_price numeric(10, 2) check (compare_at_price is null or compare_at_price >= price),
  currency text not null default 'PLN' check (char_length(currency) = 3),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null,
  sku text not null unique,
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, size)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default (
    'DC-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  ),
  customer_email text,
  customer_name text,
  shipping_address_line1 text,
  shipping_address_line2 text,
  shipping_postal_code text,
  shipping_city text,
  shipping_country text,
  subtotal_amount numeric(10, 2) not null check (subtotal_amount >= 0),
  shipping_amount numeric(10, 2) not null default 0 check (shipping_amount >= 0),
  total_amount numeric(10, 2) not null check (total_amount >= 0),
  currency text not null default 'PLN' check (char_length(currency) = 3),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  fulfillment_status text not null default 'pending' check (fulfillment_status in ('pending', 'paid', 'processing', 'shipped', 'cancelled')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  size text not null,
  quantity integer not null check (quantity between 1 and 10),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  created_at timestamptz not null default now()
);

create table public.shipping_rates (
  country_code text primary key check (char_length(country_code) = 2),
  country_name text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  free_from numeric(10, 2) check (free_from is null or free_from >= 0),
  currency text not null default 'PLN' check (char_length(currency) = 3),
  active boolean not null default true
);

create index orders_created_at_idx on public.orders (created_at desc);
create index orders_payment_status_idx on public.orders (payment_status);
create index orders_fulfillment_status_idx on public.orders (fulfillment_status);
create index order_items_order_id_idx on public.order_items (order_id);
create index product_variants_product_id_idx on public.product_variants (product_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_users enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.shipping_rates enable row level security;

grant select on public.products, public.product_variants to anon, authenticated;
grant insert on public.newsletter_subscribers to anon, authenticated;
grant select on public.shipping_rates to anon, authenticated;
grant select on public.admin_users, public.orders, public.order_items to authenticated;
grant update (fulfillment_status) on public.orders to authenticated;

create policy "Public can view active products"
on public.products for select
to anon, authenticated
using (active = true);

create policy "Public can view active variants"
on public.product_variants for select
to anon, authenticated
using (
  active = true
  and exists (
    select 1 from public.products
    where products.id = product_variants.product_id
      and products.active = true
  )
);

create policy "Users can verify their own admin record"
on public.admin_users for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Admins can view orders"
on public.orders for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Admins can update fulfillment"
on public.orders for update
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

create policy "Admins can view order items"
on public.order_items for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

create policy "Visitors can join newsletter"
on public.newsletter_subscribers for insert
to anon, authenticated
with check (true);

create policy "Public can view active shipping rates"
on public.shipping_rates for select
to anon, authenticated
using (active = true);

insert into public.products (slug, name, description, price, compare_at_price, currency, image_url)
values (
  'delusional-classic-zip-up',
  'DELUSIONAL CLASSIC ZIP UP',
  'Szara bluza rozpinana, 420 GSM, 100% bawełna, boxy cropped fit.',
  220.00,
  260.00,
  'PLN',
  './images/classic-zip-front.jpg'
);

insert into public.product_variants (product_id, size, sku, stock)
select id, variant.size, 'DC-ZIP-GREY-' || variant.size, 30
from public.products
cross join (values ('S'), ('M'), ('L'), ('XL')) as variant(size)
where slug = 'delusional-classic-zip-up';

insert into public.shipping_rates (country_code, country_name, amount, free_from)
values
  ('PL', 'Polska', 16.99, 350.00),
  ('DK', 'Dania', 95.90, null);
