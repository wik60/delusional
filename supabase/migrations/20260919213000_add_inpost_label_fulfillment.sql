alter table public.orders
  add column if not exists inpost_shipment_id text,
  add column if not exists tracking_number text,
  add column if not exists shipping_label_path text,
  add column if not exists shipping_label_status text not null default 'not_created',
  add column if not exists shipping_label_error text,
  add column if not exists shipping_label_created_at timestamptz,
  add column if not exists print_job_id text,
  add column if not exists printed_at timestamptz;

insert into storage.buckets (id, name, public)
values ('shipping-labels', 'shipping-labels', false)
on conflict (id) do update set public = false;
