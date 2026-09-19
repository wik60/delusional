alter table public.orders
  add column pickup_point_code text,
  add column pickup_point_name text,
  add column pickup_point_address text;
