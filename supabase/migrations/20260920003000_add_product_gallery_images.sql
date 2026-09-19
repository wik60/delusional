alter table public.products
  add column if not exists gallery_images jsonb not null default '[]'::jsonb;

alter table public.products
  drop constraint if exists products_gallery_images_array_check;

alter table public.products
  add constraint products_gallery_images_array_check
  check (
    jsonb_typeof(gallery_images) = 'array'
    and jsonb_array_length(gallery_images) <= 20
  );

update public.products p
set gallery_images = coalesce((
  select jsonb_agg(x.url order by x.ord)
  from (
    select min(v.ord) as ord, v.url
    from (
      values
        (1, coalesce(nullif(p.front_image_url, ''), nullif(p.image_url, ''))),
        (2, nullif(p.back_image_url, ''))
    ) as v(ord, url)
    where v.url is not null
    group by v.url
  ) x
), '[]'::jsonb)
where p.gallery_images = '[]'::jsonb;

grant update (gallery_images) on public.products to authenticated;
