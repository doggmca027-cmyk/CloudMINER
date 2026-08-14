-- CloudMiner HYIP — додає 'referral_bonus' до transaction_type для
-- реферальної системи. Навмисно ОКРЕМА міграція: Postgres забороняє
-- використовувати щойно додане значення enum у тій самій транзакції, де
-- його додано (`ALTER TYPE ... ADD VALUE`), а кожен файл міграції в цьому
-- проєкті виконується як одна неявна транзакція — тож наступна міграція
-- (яка вже ВИКОРИСТОВУЄ 'referral_bonus' у RPC) має йти окремим файлом.

alter type transaction_type add value 'referral_bonus';
