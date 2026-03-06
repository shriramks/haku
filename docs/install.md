# Install & Setup

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project

---

## 1. Supabase

Create a new project. Run the SQL files in order via SQL Editor:

```
supabase/schema.sql        — tables, RLS policies, indexes
supabase/migration-v2.sql  — buy_bands versioning + playbook table
supabase/migration-v3.sql  — two_strong_quarters column
supabase/seed.sql          — FY + allocations (replace YOUR_USER_UUID)
supabase/seed-bands.sql    — buy band values
```

---

## 2. Environment

Create `.env.local` in the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

---

## 3. Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

---

## 4. Deploy

```bash
npx vercel
```

Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel environment settings.

---

## Install as iPhone App (PWA)

1. Open in Safari → Share → **Add to Home Screen**
2. Tap the icon — already logged in, full-screen
