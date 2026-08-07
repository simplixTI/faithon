# Supabase setup

## One-time

1. Create a Supabase project (or use an existing one).
2. In **Dashboard → Settings → API**, copy:
   - `Project URL` → `SUPABASE_URL` (root) and `NEXT_PUBLIC_SUPABASE_URL` (admin)
   - `anon public` key → `SUPABASE_ANON_KEY` (root) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (admin)
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (root) and `SUPABASE_SERVICE_ROLE_KEY` (admin `.env.local`)
3. In **Dashboard → Account → Access Tokens**, create a PAT and store as `SUPABASE_ACCESS_TOKEN` locally (used by the CLI only).

## Apply migrations

```bash
supabase link --project-ref <ref>
supabase db push --include-all
```

The two migrations create:
- 10 core tables (`users`, `subscriptions`, `messages`, `daily_usage`, etc.)
- 17 additional MVP tables (admin, ops, entitlements, sms, ai_usage)
- 9 enums, 3 dashboard views, RLS policies, `promote_to_admin()`.

## Bootstrap the first admin

1. Visit `/admin/login` (locally: <http://localhost:3000/login>) and enter your email.
2. Open the sign-in link from your inbox.
3. In **Supabase → SQL Editor**, promote the account:

```sql
select public.promote_to_admin('brucnascimento@gmail.com', 'super_admin');
```

The function requires the user to exist in `auth.users` first
(created automatically when they click the magic link).

## Enable email delivery (magic links)

Supabase provides a shared SMTP for magic links out of the box with a
strict rate limit. For production, configure your own SMTP in
**Dashboard → Auth → SMTP Settings**.

## Rotating secrets

If a key was ever pasted into chat / logs / screenshots:
- **service_role**: Dashboard → Settings → API → Reset service_role JWT.
- **anon**: Reset. Update all `.env` files. Redeploy.
- **PAT**: Dashboard → Account → Access Tokens → Revoke.
