import type { CurrencyCode } from '@/lib/money';

/**
 * Client-side copy of the two markets' dialling facts. `src/lib/phone.ts` owns the parsing and
 * is deliberately `server-only`, so a form that has to render a placeholder and a country
 * switcher in the browser reads these instead. The values mirror `REGION_DIAL_CODES` there.
 */
export interface RegionInfo {
  code: 'UG' | 'KE';
  name: string;
  dialCode: string;
  currency: CurrencyCode;
  currencyLabel: string;
  phoneHint: string;
  examplePhone: string;
}

export const REGIONS: Record<'UG' | 'KE', RegionInfo> = {
  UG: {
    code: 'UG',
    name: 'Uganda',
    dialCode: '256',
    currency: 'UGX',
    currencyLabel: 'Uganda shilling',
    phoneHint: '077 1234 567 or +256 771 234 567',
    examplePhone: '0771234567',
  },
  KE: {
    code: 'KE',
    name: 'Kenya',
    dialCode: '254',
    currency: 'KES',
    currencyLabel: 'Kenyan shilling',
    phoneHint: '0712 345 678 or +254 712 345 678',
    examplePhone: '0712345678',
  },
};

export const REGION_LIST = [REGIONS.UG, REGIONS.KE];

export const regionForCurrency = (currency: CurrencyCode): 'UG' | 'KE' => (currency === 'KES' ? 'KE' : 'UG');
