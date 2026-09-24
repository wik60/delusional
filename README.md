# Delusional Crew storefront

Minimalistyczny sklep marki Delusional Crew działający na GitHub Pages, z bazą zamówień i logowaniem administratora w Supabase oraz płatnościami przez Stripe Checkout.

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

## Architektura

- `index.html` — sklep, karta produktu, koszyk i zapis do newslettera
- `admin/` — logowanie administratora i panel zamówień (`admin.html` przekierowuje na czysty adres)
- `supabase/migrations` — schemat bazy oraz zasady RLS
- `supabase/functions/create-checkout` — tworzenie bezpiecznej sesji Stripe Checkout
- `supabase/functions/stripe-webhook` — oznaczanie zamówień jako opłacone
- `.github/workflows/deploy.yml` — automatyczne wdrożenie GitHub Pages

Sekretów Stripe nie wolno zapisywać w repozytorium. Należy dodać je jako sekrety projektu Supabase (`STRIPE_SECRET_KEY` i `STRIPE_WEBHOOK_SECRET`).
