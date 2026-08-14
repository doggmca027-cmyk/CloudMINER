-- CloudMiner HYIP — фірмові назви майнерів у каталозі (замість "5 USDT"
-- тощо). Тримати синхронізовано з REGULAR_TIERS/PREMIUM_TIERS у
-- src/lib/catalog.ts (наразі фронтенд каталог все ще client-side mock,
-- ця таблиця — на майбутнє, коли ShopTab перейде на живий фетч).

update public.miner_templates set name = 'Nano Miner' where id = 'regular-5';
update public.miner_templates set name = 'Micro Rig' where id = 'regular-25';
update public.miner_templates set name = 'Spark Core' where id = 'regular-50';
update public.miner_templates set name = 'Turbo Node' where id = 'regular-100';
update public.miner_templates set name = 'Quantum Rig' where id = 'regular-250';
update public.miner_templates set name = 'Hyper Core' where id = 'regular-500';
update public.miner_templates set name = 'Titan Node' where id = 'regular-1000';
update public.miner_templates set name = 'Apex Rig' where id = 'regular-1500';

update public.miner_templates set name = 'Golden Core' where id = 'premium-999';
update public.miner_templates set name = 'Platinum Rig' where id = 'premium-1499';
update public.miner_templates set name = 'Diamond Node' where id = 'premium-1999';
update public.miner_templates set name = 'Royal Miner' where id = 'premium-2499';
update public.miner_templates set name = 'Sovereign Core' where id = 'premium-2999';
