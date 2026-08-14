-- CloudMiner HYIP — додає 'admin_credit' до transaction_type для ручних
-- нарахувань адміном "на баланс" (без статусу реального депозиту — не
-- розблоковує вивід, не тригерить реферальний каскад). Окрема міграція —
-- ADD VALUE не можна використовувати в тій самій транзакції, де додано.

alter type transaction_type add value 'admin_credit';
