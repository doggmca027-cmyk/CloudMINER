// Deno Edge Function runtime.
//
// Відправляє USDT (TRC-20) у мережі Tron з гарячого гаманця проєкту —
// викликається лише з process-withdrawal після адмінського підтвердження
// заявки на вивід.
//
// ⚠️ НЕ ПЕРЕВІРЕНО проти живої мережі з цього середовища. TronWeb — важкий
// пакет, історично орієнтований на Node (buffer/crypto-поліфіли); хоч
// Supabase Edge Runtime заявляє Node-сумісність npm-пакетів, перед продом
// обов'язково прогнати одну маленьку тестову виплату (2-3 USDT) і звірити
// tx у tronscan.org, перш ніж довіряти цьому коду реальні суми користувачів.
//
// СЕКРЕТИ (supabase secrets set ...):
//   TRON_HOT_WALLET_PRIVATE_KEY — приватний ключ (hex, без "0x") гаманця, з
//                                 якого платимо. ПОВИНЕН належати тому
//                                 самому гаманцю, що TRC20_WALLET_ADDRESS —
//                                 перевіряється нижче.
//   TRC20_WALLET_ADDRESS        — спільний з check-tron-deposits
//   TRONGRID_API_KEY            — опційно, спільний з check-tron-deposits

// tronweb історично мав то default, то named export залежно від версії/збірки
// (CJS vs ESM interop) — беремо обидва варіанти, щоб не впасти на дрібниці.
import * as TronWebModule from 'npm:tronweb@^5'
// deno-lint-ignore no-explicit-any
const TronWebCtor: any = (TronWebModule as any).TronWeb ?? (TronWebModule as any).default ?? TronWebModule

/** Офіційний контракт USDT у мережі Tron (мейннет) — той самий, що в check-tron-deposits. */
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const USDT_DECIMALS = 6

/** Відправляє `amountUsd` USDT (TRC-20) на `destinationAddress`. Повертає tx id. */
export async function sendTronUsdt(destinationAddress: string, amountUsd: number): Promise<string> {
  const privateKey = Deno.env.get('TRON_HOT_WALLET_PRIVATE_KEY')
  if (!privateKey) throw new Error('TRON_HOT_WALLET_PRIVATE_KEY не налаштовано в секретах функції')

  if (!destinationAddress || destinationAddress.trim() === '') {
    throw new Error('destination_address_required')
  }

  const amountUnits = Math.round(amountUsd * 10 ** USDT_DECIMALS)
  if (amountUnits <= 0) throw new Error('invalid_payout_amount')

  const expectedOwner = Deno.env.get('TRC20_WALLET_ADDRESS')
  const apiKey = Deno.env.get('TRONGRID_API_KEY')

  const tronWeb = new TronWebCtor({
    fullHost: 'https://api.trongrid.io',
    privateKey,
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined,
  })

  const ownerAddress: string = tronWeb.address.fromPrivateKey(privateKey)
  if (expectedOwner && ownerAddress !== expectedOwner) {
    // Захист від людської помилки: приватний ключ у секретах веде на ІНШИЙ
    // гаманець, ніж TRC20_WALLET_ADDRESS — швидше за все, переплутали
    // секрет при налаштуванні.
    throw new Error(
      `TRON_HOT_WALLET_PRIVATE_KEY відповідає гаманцю ${ownerAddress}, а не TRC20_WALLET_ADDRESS (${expectedOwner})`,
    )
  }

  const contract = await tronWeb.contract().at(USDT_TRC20_CONTRACT)
  const txId: string = await contract.transfer(destinationAddress, amountUnits).send({
    feeLimit: 30_000_000, // 30 TRX — верхня межа комісії, стандартна практика для TRC-20 transfer
  })

  if (!txId || typeof txId !== 'string') {
    throw new Error('tronweb: transfer() не повернув tx id')
  }

  return txId
}
