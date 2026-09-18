create table public.shipping_methods (
  id text primary key,
  carrier text not null,
  service_name text not null,
  country_code text not null check (char_length(country_code) = 2),
  amount numeric(10, 2) not null check (amount >= 0),
  free_from numeric(10, 2) check (free_from is null or free_from >= 0),
  currency text not null default 'PLN' check (char_length(currency) = 3),
  min_delivery_days integer not null check (min_delivery_days > 0),
  max_delivery_days integer not null check (max_delivery_days >= min_delivery_days),
  delivery_type text not null check (delivery_type in ('courier', 'parcel_locker')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index shipping_methods_country_active_idx
on public.shipping_methods (country_code, active);

alter table public.shipping_methods enable row level security;

alter table public.orders
  add column shipping_method_id text references public.shipping_methods(id),
  add column shipping_carrier text,
  add column shipping_service text;

insert into public.shipping_methods
  (id, carrier, service_name, country_code, amount, free_from, min_delivery_days, max_delivery_days, delivery_type)
values
  ('pl-inpost-locker', 'InPost', 'Paczkomat 24/7', 'PL', 16.99, 350.00, 1, 2, 'parcel_locker'),
  ('pl-inpost-courier', 'InPost', 'Kurier', 'PL', 19.99, 350.00, 1, 2, 'courier'),
  ('pl-dpd-courier', 'DPD', 'Kurier DPD', 'PL', 22.99, 350.00, 1, 2, 'courier'),
  ('pl-dhl-courier', 'DHL', 'DHL Parcel', 'PL', 24.99, 350.00, 1, 3, 'courier'),
  ('dk-postnord-courier', 'PostNord', 'MyPack Home', 'DK', 54.90, null, 2, 4, 'courier'),
  ('dk-gls-courier', 'GLS', 'GLS Parcel', 'DK', 59.90, null, 2, 4, 'courier'),
  ('dk-dhl-courier', 'DHL', 'DHL Express', 'DK', 72.90, null, 1, 3, 'courier');
