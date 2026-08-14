/**
 * Заглушка інтеграції TON Connect.
 *
 * Реальна пряма оплата в TON вимагає:
 *  - підключення `@tonconnect/ui-react` і хостингу `tonconnect-manifest.json`;
 *  - екрана підключення гаманця (QR / deep-link);
 *  - бекенду, що приймає адресу отримувача, формує транзакцію на потрібну
 *    суму й підтверджує її надходження (webhook / поллінг блокчейну) перед
 *    тим, як зарахувати майнер користувачу.
 *
 * Жодного з цих шматків ще не підключено, тож функція нижче лише сигналізує
 * про це замість того, щоб імітувати успішну оплату.
 */

export interface TonPaymentRequest {
  amountUsd: number
  comment: string
}

export interface TonPaymentResult {
  success: boolean
  error?: 'not_configured'
}

export async function payWithTonConnect(_request: TonPaymentRequest): Promise<TonPaymentResult> {
  // eslint-disable-next-line no-console
  console.warn(
    '[tonConnect] TON Connect ще не підключено. Встановіть @tonconnect/ui-react, ' +
      'опублікуйте tonconnect-manifest.json і додайте бекенд для підтвердження транзакцій.',
  )
  return { success: false, error: 'not_configured' }
}
