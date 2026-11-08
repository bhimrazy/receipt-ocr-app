-- Load-test data, run by scripts/load.sh after seed.js created the accounts.
--   psql -v n_receipts=200 -f seed.sql
-- Raises plan limits so quota doesn't dominate, and gives each user n_receipts completed receipts
-- with the ids that lib.js's receiptId() computes. Safe to re-run.
create extension if not exists pg_stat_statements;

insert into app_settings (key, value)
values ('plans', '{"free":{"workspaces":5,"receiptsPerDay":100000,"receiptsPerMinute":1000},"pro":{"workspaces":5,"receiptsPerDay":100000,"receiptsPerMinute":1000}}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

with owners as (
  select split_part(split_part(u.email, '@', 1), '-', 2)::int as idx, u.id as user_id, m.organization_id
  from "user" u join member m on m.user_id = u.id
  where u.email like 'load-%@example.com'
), rows as (
  select o.*, n,
    (array['Blue Bottle Coffee','Office Depot','Aral Tankstelle','Whole Foods','Uber','Costco','Shell','Staples'])[1 + (n % 8)] as merchant,
    (array['Meals','Office','Fuel','Groceries','Travel'])[1 + (n % 5)] as category
  from owners o, generate_series(0, :n_receipts - 1) n
), ins as (
  insert into receipts (id, organization_id, user_id, merchant, receipt_date, category, currency,
                        subtotal, tax, total, confidence, status, file_name)
  select ('00000000-0000-4000-8000-' || lpad(to_hex(idx * 10000 + n), 12, '0'))::uuid,
         organization_id, user_id, merchant,
         to_char(date '2026-10-31' - (n % 120), 'YYYY-MM-DD'), category, 'USD',
         10 + n % 40, 0.8 + n % 3, 10.8 + n % 40 + n % 3, 0.95,
         (case when n % 10 = 0 then 'failed' else 'completed' end)::receipt_status,
         'seed-' || n || '.jpg'
  from rows
  on conflict (id) do nothing
  returning id
)
insert into receipt_items (receipt_id, name, quantity, unit_price, total_price)
select id, item, 1, 5.00, 5.00 from ins, unnest(array['Item A', 'Item B', 'Item C']) item;
