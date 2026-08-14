-- CloudMiner HYIP — нові типи операцій для журналу transactions: покупка
-- майнера, збір доходу майнера, винагорода за завдання. Досі шоп/майнінг/
-- завдання існували ЛИШЕ як клієнтський стан (UserStateContext) — реальний
-- users.balance_usd вони не чіпали і в journal не потрапляли. Окрема
-- міграція (ADD VALUE не можна використати в тій самій транзакції, де його
-- одразу застосовують) — самі RPC живуть у наступному файлі.
alter type transaction_type add value if not exists 'miner_purchase';
alter type transaction_type add value if not exists 'miner_claim';
alter type transaction_type add value if not exists 'task_reward';
