// Deno Edge Function runtime.
//
// Відправляє USDT (jetton, стандарт TEP-74) у мережі TON з гарячого гаманця
// проєкту — викликається лише з process-withdrawal після адмінського
// підтвердження заявки на вивід.
//
// ⚠️ НЕ ПЕРЕВІРЕНО проти живої мережі з цього середовища (як і решта
// TonAPI-інтеграцій у check-ton-deposits/check-ton-jetton-deposits) —
// обов'язково прогнати одну маленьку тестову виплату (2-3 USDT) і звірити
// результат у tonviewer.com, перш ніж довіряти цьому коду реальні суми
// користувачів.
//
// СЕКРЕТИ (supabase secrets set ...):
//   TON_HOT_WALLET_MNEMONIC — 24-слівна seed-фраза гаманця, з якого платимо.
//                             ПОВИННА належати тому самому гаманцю, що
//                             TON_WALLET_ADDRESS (адреса, яку показуємо
//                             користувачам для депозитів) — перевіряється
//                             нижче, щоб випадково не платити з чужого/не
//                             того гаманця.
//   TON_WALLET_ADDRESS      — спільний з check-ton-deposits/check-ton-jetton-deposits
//   TON_USDT_JETTON_MASTER  — спільний з check-ton-jetton-deposits
//   TONCENTER_API_KEY       — опційно, підвищує ліміти toncenter.com
//   TONAPI_KEY              — опційно, спільний з check-ton*-deposits

import { Address, TonClient, WalletContractV4, beginCell, internal, toNano } from 'npm:@ton/ton@^15'
import { mnemonicToPrivateKey } from 'npm:@ton/crypto@^3'

const JETTON_TRANSFER_OP = 0xf8a7ea5
const USDT_DECIMALS = 6
const DEFAULT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTDto1qKmGpaHTKMxAn4Sqa5uwl9pE'

interface TonApiJettonWalletResponse {
  wallet_address?: { address?: string }
}

/** Знаходить jetton-гаманець (не owner-адресу) нашого гарячого гаманця для конкретного jetton master. */
async function fetchJettonWalletAddress(ownerAddress: string, jettonMaster: string): Promise<string> {
  const apiKey = Deno.env.get('TONAPI_KEY')
  const res = await fetch(`https://tonapi.io/v2/accounts/${ownerAddress}/jettons/${jettonMaster}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  })
  if (!res.ok) {
    throw new Error(`TonAPI jetton wallet lookup failed: HTTP ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as TonApiJettonWalletResponse
  const address = data.wallet_address?.address
  if (!address) {
    throw new Error('TonAPI: у гарячого гаманця немає jetton-гаманця для цього master (порожній баланс USDT?)')
  }
  return address
}

/**
 * Відправляє `amountUsd` USDT (jetton) на `destinationAddress`.
 *
 * Повертає referens для запису в `transactions.tx_hash`. @ton/ton не
 * повертає хеш синхронно — зовнішнє повідомлення йде в мемпул, а факт
 * включення в блок підтверджується окремим запитом пізніше — тому
 * referens будується з адреси гаманця й seqno (унікальний і достатній для
 * ручної звірки на tonviewer.com/tonscan.org).
 */
export async function sendTonUsdtJetton(destinationAddress: string, amountUsd: number): Promise<string> {
  const mnemonic = Deno.env.get('TON_HOT_WALLET_MNEMONIC')
  if (!mnemonic) throw new Error('TON_HOT_WALLET_MNEMONIC не налаштовано в секретах функції')

  if (!destinationAddress || destinationAddress.trim() === '') {
    throw new Error('destination_address_required')
  }

  const amountUnits = BigInt(Math.round(amountUsd * 10 ** USDT_DECIMALS))
  if (amountUnits <= 0n) throw new Error('invalid_payout_amount')

  const expectedOwner = Deno.env.get('TON_WALLET_ADDRESS')
  const jettonMaster = Deno.env.get('TON_USDT_JETTON_MASTER') || DEFAULT_JETTON_MASTER

  const keyPair = await mnemonicToPrivateKey(mnemonic.trim().split(/\s+/))
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
  const ownerAddress = wallet.address.toString()

  if (expectedOwner && Address.parse(expectedOwner).toString() !== ownerAddress) {
    // Захист від людської помилки: мнемоніка в секретах веде на ІНШИЙ
    // гаманець, ніж TON_WALLET_ADDRESS — швидше за все, переплутали секрет
    // при налаштуванні. Краще впасти тут, ніж відправити гроші з
    // неочікуваного гаманця.
    throw new Error(
      `TON_HOT_WALLET_MNEMONIC відповідає гаманцю ${ownerAddress}, а не TON_WALLET_ADDRESS (${expectedOwner})`,
    )
  }

  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: Deno.env.get('TONCENTER_API_KEY'),
  })
  const contract = client.open(wallet)

  const jettonWalletAddress = await fetchJettonWalletAddress(ownerAddress, jettonMaster)

  // Тіло повідомлення jetton transfer за TEP-74:
  // https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md
  const body = beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(BigInt(Date.now()), 64) // query_id
    .storeCoins(amountUnits)
    .storeAddress(Address.parse(destinationAddress))
    .storeAddress(wallet.address) // response_destination — залишок газу повертається нам
    .storeBit(false) // custom_payload: відсутній
    .storeCoins(1n) // forward_ton_amount: 1 nanoTON, щоб отримувач побачив сповіщення про переказ
    .storeBit(false) // forward_payload: без коментаря
    .endCell()

  const seqno = await contract.getSeqno()

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: jettonWalletAddress,
        value: toNano('0.06'), // газ на jetton-переказ; невикористаний залишок повернеться
        bounce: true,
        body,
      }),
    ],
  })

  return `ton-out:${ownerAddress}:${seqno}`
}
