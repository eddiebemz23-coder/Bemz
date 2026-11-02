/**
 * Geographic seed data for the two launch markets.
 *
 * All fees are in MINOR units (1/100 of the currency):
 *   UGX 4,000  -> 400_000
 *   KES 250    ->  25_000
 *
 * Kenya uses the official KNBS county codes 001-047 (all 47 counties, asserted in seed.ts).
 * Uganda codes below are platform-internal 3-letter keys — Uganda does not publish a
 * standard district code list — and are what the courier routing tables key on.
 */

export type DistrictSeed = {
  code: string;
  name: string;
  region: string;
  isMajor?: boolean;
};

export type ZoneSeed = {
  code: string;
  name: string;
  baseFeeMinor: number;
  perKgFeeMinor: number;
  freeOverMinor: number | null;
  daysMin: number;
  daysMax: number;
  cashOnDeliveryAllowed: boolean;
  districts: DistrictSeed[];
};

export type CountrySeed = {
  code: 'UG' | 'KE';
  name: string;
  currency: 'UGX' | 'KES';
  phonePrefix: string;
  taxRateBps: number;
  taxLabel: string;
  zones: ZoneSeed[];
};

export const KENYA_COUNTY_COUNT = 47;

export const GEO_SEED: CountrySeed[] = [
  {
    code: 'UG',
    name: 'Uganda',
    currency: 'UGX',
    phonePrefix: '+256',
    taxRateBps: 1800,
    taxLabel: 'VAT',
    zones: [
      {
        code: 'UG-KAMPALA-METRO',
        name: 'Kampala Metro',
        baseFeeMinor: 400_000, // UGX 4,000 boda/courier inside the ring road
        perKgFeeMinor: 100_000, // UGX 1,000 per extra kg
        freeOverMinor: 10_000_000, // free shipping above UGX 100,000
        daysMin: 1,
        daysMax: 2,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'KLA', name: 'Kampala', region: 'Central', isMajor: true },
          { code: 'WKO', name: 'Wakiso', region: 'Central', isMajor: true },
        ],
      },
      {
        code: 'UG-CENTRAL',
        name: 'Central Upcountry',
        baseFeeMinor: 800_000, // UGX 8,000
        perKgFeeMinor: 150_000,
        freeOverMinor: 20_000_000,
        daysMin: 2,
        daysMax: 3,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'MKO', name: 'Mukono', region: 'Central', isMajor: true },
          { code: 'BWK', name: 'Buikwe', region: 'Central' },
          { code: 'KYA', name: 'Kayunga', region: 'Central' },
          { code: 'NKE', name: 'Nakaseke', region: 'Central' },
          { code: 'NSA', name: 'Nakasongola', region: 'Central' },
          { code: 'LWL', name: 'Luweero', region: 'Central' },
          { code: 'MTN', name: 'Masaka', region: 'Central', isMajor: true },
          { code: 'LNG', name: 'Lwengo', region: 'Central' },
          { code: 'KLN', name: 'Kalungu', region: 'Central' },
          { code: 'SBM', name: 'Sembabule', region: 'Central' },
          { code: 'BKM', name: 'Bukomansimbi', region: 'Central' },
          { code: 'RKT', name: 'Rakai', region: 'Central' },
          { code: 'KTR', name: 'Kyotera', region: 'Central' },
          { code: 'GMB', name: 'Gomba', region: 'Central' },
          { code: 'BTB', name: 'Butambala', region: 'Central' },
          { code: 'LYA', name: 'Lyantonde', region: 'Central' },
          { code: 'MBE', name: 'Mubende', region: 'Central' },
          { code: 'KSD', name: 'Kassanda', region: 'Central' },
        ],
      },
      {
        code: 'UG-EAST',
        name: 'Eastern Region',
        baseFeeMinor: 1_200_000, // UGX 12,000
        perKgFeeMinor: 200_000,
        freeOverMinor: 30_000_000,
        daysMin: 2,
        daysMax: 4,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'JIN', name: 'Jinja', region: 'Eastern', isMajor: true },
          { code: 'IGA', name: 'Iganga', region: 'Eastern' },
          { code: 'MYG', name: 'Mayuge', region: 'Eastern' },
          { code: 'BGI', name: 'Bugiri', region: 'Eastern' },
          { code: 'NMG', name: 'Namayingo', region: 'Eastern' },
          { code: 'NMT', name: 'Namutumba', region: 'Eastern' },
          { code: 'KLR', name: 'Kaliro', region: 'Eastern' },
          { code: 'KML', name: 'Kamuli', region: 'Eastern' },
          { code: 'MBL', name: 'Mbale', region: 'Eastern', isMajor: true },
          { code: 'SRN', name: 'Sironko', region: 'Eastern' },
          { code: 'BDD', name: 'Bududa', region: 'Eastern' },
          { code: 'MWF', name: 'Manafwa', region: 'Eastern' },
          { code: 'BDK', name: 'Budaka', region: 'Eastern' },
          { code: 'KBD', name: 'Kibuku', region: 'Eastern' },
          { code: 'PLS', name: 'Pallisa', region: 'Eastern' },
          { code: 'BUS', name: 'Busia', region: 'Eastern' },
          { code: 'TOR', name: 'Tororo', region: 'Eastern', isMajor: true },
          { code: 'BTJ', name: 'Butaleja', region: 'Eastern' },
          { code: 'KPC', name: 'Kapchorwa', region: 'Eastern' },
          { code: 'KWN', name: 'Kween', region: 'Eastern' },
          { code: 'SRT', name: 'Soroti', region: 'Eastern', isMajor: true },
          { code: 'SRR', name: 'Serere', region: 'Eastern' },
          { code: 'KBM', name: 'Kaberamaido', region: 'Eastern' },
          { code: 'AMR', name: 'Amuria', region: 'Eastern' },
          { code: 'KMI', name: 'Kumi', region: 'Eastern' },
          { code: 'BKD', name: 'Bukedea', region: 'Eastern' },
          { code: 'NGR', name: 'Ngora', region: 'Eastern' },
        ],
      },
      {
        code: 'UG-WEST',
        name: 'Western Region',
        baseFeeMinor: 1_200_000,
        perKgFeeMinor: 200_000,
        freeOverMinor: 30_000_000,
        daysMin: 2,
        daysMax: 4,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'MBR', name: 'Mbarara', region: 'Western', isMajor: true },
          { code: 'BSH', name: 'Bushenyi', region: 'Western' },
          { code: 'ISH', name: 'Ishaka', region: 'Western' },
          { code: 'SHM', name: 'Sheema', region: 'Western' },
          { code: 'RBI', name: 'Rubirizi', region: 'Western' },
          { code: 'BHW', name: 'Buhweju', region: 'Western' },
          { code: 'BYB', name: 'Bunyangabu', region: 'Western' },
          { code: 'RUK', name: 'Rukungiri', region: 'Western' },
          { code: 'KNR', name: 'Kanungu', region: 'Western' },
          { code: 'KBL', name: 'Kabale', region: 'Western', isMajor: true },
          { code: 'RBD', name: 'Rubanda', region: 'Western' },
          { code: 'KAZ', name: 'Kazo', region: 'Western' },
          { code: 'ISI', name: 'Isingiro', region: 'Western' },
          { code: 'KRH', name: 'Kiruhura', region: 'Western' },
          { code: 'IBN', name: 'Ibanda', region: 'Western' },
          { code: 'KSE', name: 'Kasese', region: 'Western', isMajor: true },
          { code: 'BYD', name: 'Bundibugyo', region: 'Western' },
          { code: 'NTR', name: 'Ntoroko', region: 'Western' },
          { code: 'KBR', name: 'Kabarole', region: 'Western', isMajor: true },
          { code: 'KJJ', name: 'Kyenjojo', region: 'Western' },
          { code: 'KGM', name: 'Kyegamu', region: 'Western' },
          { code: 'KMW', name: 'Kamwenge', region: 'Western' },
          { code: 'KKR', name: 'Kakumiro', region: 'Western' },
          { code: 'KKU', name: 'Kikuube', region: 'Western' },
          { code: 'HIM', name: 'Hoima', region: 'Western', isMajor: true },
          { code: 'MSD', name: 'Masindi', region: 'Western' },
        ],
      },
      {
        code: 'UG-NORTH',
        name: 'Northern Region',
        baseFeeMinor: 1_500_000, // UGX 15,000
        perKgFeeMinor: 250_000,
        freeOverMinor: 40_000_000,
        daysMin: 3,
        daysMax: 6,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'GUL', name: 'Gulu', region: 'Northern', isMajor: true },
          { code: 'AMU', name: 'Amuru', region: 'Northern' },
          { code: 'NWO', name: 'Nwoya', region: 'Northern' },
          { code: 'KIT', name: 'Kitgum', region: 'Northern' },
          { code: 'PDR', name: 'Pader', region: 'Northern' },
          { code: 'LMW', name: 'Lamwo', region: 'Northern' },
          { code: 'AGO', name: 'Agago', region: 'Northern' },
          { code: 'LIR', name: 'Lira', region: 'Northern', isMajor: true },
          { code: 'ALB', name: 'Alebtong', region: 'Northern' },
          { code: 'KWA', name: 'Kwania', region: 'Northern' },
          { code: 'ACC', name: 'Accia', region: 'Northern' },
          { code: 'DKL', name: 'Dokolo', region: 'Northern' },
          { code: 'OTK', name: 'Otuke', region: 'Northern' },
          { code: 'ARI', name: 'Arua', region: 'Northern', isMajor: true },
          { code: 'MRC', name: 'Maracha', region: 'Northern' },
          { code: 'KOB', name: 'Koboko', region: 'Northern' },
          { code: 'YUM', name: 'Yumbe', region: 'Northern' },
          { code: 'MDO', name: 'Madi-Okollo', region: 'Northern' },
          { code: 'TRG', name: 'Terego', region: 'Northern' },
          { code: 'OBG', name: 'Obongi', region: 'Northern' },
          { code: 'ZMB', name: 'Zombo', region: 'Northern' },
          { code: 'ADJ', name: 'Adjumani', region: 'Northern' },
          { code: 'MOY', name: 'Moyo', region: 'Northern' },
          { code: 'BLI', name: 'Buliisa', region: 'Northern' },
        ],
      },
      {
        code: 'UG-KARAMOJA',
        name: 'Karamoja',
        baseFeeMinor: 2_000_000, // UGX 20,000 — long haul, few daily courier runs
        perKgFeeMinor: 300_000,
        freeOverMinor: null,
        daysMin: 4,
        daysMax: 8,
        // Prepay only: a failed COD delivery from Kampala to Moroto costs more than the parcel.
        cashOnDeliveryAllowed: false,
        districts: [
          { code: 'MRT', name: 'Moroto', region: 'Karamoja', isMajor: true },
          { code: 'KTD', name: 'Kotido', region: 'Karamoja' },
          { code: 'KAB', name: 'Kaabong', region: 'Karamoja' },
          { code: 'ABM', name: 'Abim', region: 'Karamoja' },
          { code: 'NKP', name: 'Nakapiripirit', region: 'Karamoja' },
          { code: 'NPK', name: 'Napak', region: 'Karamoja' },
          { code: 'AMD', name: 'Amudat', region: 'Karamoja' },
          { code: 'KRG', name: 'Karenga', region: 'Karamoja' },
          { code: 'RPA', name: 'Rupa', region: 'Karamoja' },
        ],
      },
    ],
  },
  {
    code: 'KE',
    name: 'Kenya',
    currency: 'KES',
    phonePrefix: '+254',
    taxRateBps: 1600,
    taxLabel: 'VAT',
    zones: [
      {
        code: 'KE-NBO-METRO',
        name: 'Nairobi Metro',
        baseFeeMinor: 25_000, // KES 250
        perKgFeeMinor: 5_000,
        freeOverMinor: 500_000, // free above KES 5,000
        daysMin: 1,
        daysMax: 2,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'KE-030', name: 'Nairobi', region: 'Nairobi Metro', isMajor: true },
          { code: 'KE-013', name: 'Kiambu', region: 'Central', isMajor: true },
          { code: 'KE-022', name: 'Machakos', region: 'Eastern' },
        ],
      },
      {
        code: 'KE-CENTRAL-MTKENYA',
        name: 'Central, Mt Kenya & Eastern',
        baseFeeMinor: 35_000, // KES 350
        perKgFeeMinor: 6_000,
        freeOverMinor: 600_000,
        daysMin: 1,
        daysMax: 3,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'KE-029', name: "Murang'a", region: 'Central' },
          { code: 'KE-036', name: 'Nyeri', region: 'Central' },
          { code: 'KE-015', name: 'Kirinyaga', region: 'Central' },
          { code: 'KE-035', name: 'Nyandarua', region: 'Central' },
          { code: 'KE-020', name: 'Laikipia', region: 'Central' },
          { code: 'KE-026', name: 'Meru', region: 'Eastern', isMajor: true },
          { code: 'KE-041', name: 'Tharaka-Nithi', region: 'Eastern' },
          { code: 'KE-006', name: 'Embu', region: 'Eastern' },
          { code: 'KE-018', name: 'Kitui', region: 'Eastern' },
          { code: 'KE-023', name: 'Makueni', region: 'Eastern' },
        ],
      },
      {
        code: 'KE-RIFT-VALLEY',
        name: 'Rift Valley',
        baseFeeMinor: 40_000, // KES 400
        perKgFeeMinor: 7_000,
        freeOverMinor: 600_000,
        daysMin: 2,
        daysMax: 4,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'KE-001', name: 'Baringo', region: 'Rift Valley' },
          { code: 'KE-002', name: 'Bomet', region: 'Rift Valley' },
          { code: 'KE-005', name: 'Elgeyo-Marakwet', region: 'Rift Valley' },
          { code: 'KE-012', name: 'Kericho', region: 'Rift Valley' },
          { code: 'KE-032', name: 'Nandi', region: 'Rift Valley' },
          { code: 'KE-031', name: 'Nakuru', region: 'Rift Valley', isMajor: true },
          { code: 'KE-033', name: 'Narok', region: 'Rift Valley' },
          { code: 'KE-042', name: 'Trans Nzoia', region: 'Rift Valley' },
          { code: 'KE-044', name: 'Uasin Gishu', region: 'Rift Valley', isMajor: true },
          { code: 'KE-010', name: 'Kajiado', region: 'Rift Valley' },
          { code: 'KE-047', name: 'West Pokot', region: 'Rift Valley' },
        ],
      },
      {
        code: 'KE-COAST',
        name: 'Coast',
        baseFeeMinor: 45_000, // KES 450
        perKgFeeMinor: 8_000,
        freeOverMinor: 700_000,
        daysMin: 2,
        daysMax: 5,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'KE-028', name: 'Mombasa', region: 'Coast', isMajor: true },
          { code: 'KE-019', name: 'Kwale', region: 'Coast' },
          { code: 'KE-014', name: 'Kilifi', region: 'Coast' },
          { code: 'KE-040', name: 'Tana River', region: 'Coast' },
          { code: 'KE-021', name: 'Lamu', region: 'Coast' },
          { code: 'KE-039', name: 'Taita-Taveta', region: 'Coast' },
        ],
      },
      {
        code: 'KE-WESTERN-NYANZA',
        name: 'Western & Nyanza',
        baseFeeMinor: 45_000,
        perKgFeeMinor: 8_000,
        freeOverMinor: 700_000,
        daysMin: 2,
        daysMax: 5,
        cashOnDeliveryAllowed: true,
        districts: [
          { code: 'KE-003', name: 'Bungoma', region: 'Western' },
          { code: 'KE-004', name: 'Busia', region: 'Western' },
          { code: 'KE-045', name: 'Vihiga', region: 'Western' },
          { code: 'KE-011', name: 'Kakamega', region: 'Western', isMajor: true },
          { code: 'KE-017', name: 'Kisumu', region: 'Nyanza', isMajor: true },
          { code: 'KE-016', name: 'Kisii', region: 'Nyanza' },
          { code: 'KE-034', name: 'Nyamira', region: 'Nyanza' },
          { code: 'KE-038', name: 'Siaya', region: 'Nyanza' },
          { code: 'KE-008', name: 'Homa Bay', region: 'Nyanza' },
          { code: 'KE-027', name: 'Migori', region: 'Nyanza' },
        ],
      },
      {
        code: 'KE-NORTHERN',
        name: 'Northern & North Eastern',
        baseFeeMinor: 60_000, // KES 600
        perKgFeeMinor: 12_000,
        freeOverMinor: null,
        daysMin: 4,
        daysMax: 9,
        cashOnDeliveryAllowed: false,
        districts: [
          { code: 'KE-043', name: 'Turkana', region: 'Rift Valley' },
          { code: 'KE-025', name: 'Marsabit', region: 'Northern' },
          { code: 'KE-009', name: 'Isiolo', region: 'Eastern' },
          { code: 'KE-037', name: 'Samburu', region: 'Eastern' },
          { code: 'KE-007', name: 'Garissa', region: 'North Eastern' },
          { code: 'KE-046', name: 'Wajir', region: 'North Eastern' },
          { code: 'KE-024', name: 'Mandera', region: 'North Eastern' },
        ],
      },
    ],
  },
];
