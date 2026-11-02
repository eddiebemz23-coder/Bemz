import { z } from 'zod';
import { phone, shortText, optionalText } from './common';
import { COUNTRY_CODES } from './enums';

/** Sign-in, registration and profile. Email is optional everywhere: phones are identity. */

export const otpRequestSchema = z.object({
  phone,
  /** LOGIN creates an account for an unknown number; ORDER_CONFIRM/SELLER_VERIFY must not. */
  purpose: z.enum(['LOGIN', 'ORDER_CONFIRM', 'SELLER_VERIFY']).default('LOGIN'),
  defaultRegion: z.enum(COUNTRY_CODES).optional(),
});

export const otpVerifySchema = z.object({
  phone,
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Enter the 6-digit code from the SMS'),
  purpose: z.enum(['LOGIN', 'ORDER_CONFIRM', 'SELLER_VERIFY']).default('LOGIN'),
  name: optionalText(80),
  defaultRegion: z.enum(COUNTRY_CODES).optional(),
});

export const passwordLoginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your phone number or email').max(160),
  password: z.string().min(1, 'Enter your password').max(200),
});

export const registerSchema = z
  .object({
    name: shortText(80),
    phone,
    email: z
      .string()
      .trim()
      .email('That email is not valid')
      .max(160)
      .optional()
      .transform((value) => (value ? value.toLowerCase() : undefined)),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
    country: z.enum(COUNTRY_CODES).default('UG'),
    /** Creating a seller account immediately provisions the shop shell. */
    asSeller: z.boolean().default(false),
    shopName: optionalText(80),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the seller and buyer terms' }),
    }),
  })
  .refine(
    (value) => value.asSeller && !value.shopName ? false : true,
    'A shop name is required when registering as a seller',
  )
  .refine((value) => (value.password ? value.password.length >= 8 && /[0-9]/.test(value.password) : true), {
    message: 'Password needs at least 8 characters and one number',
    path: ['password'],
  });

export const updateProfileSchema = z.object({
  name: optionalText(80),
  email: z
    .string()
    .trim()
    .email('That email is not valid')
    .max(160)
    .optional()
    .transform((value) => (value ? value.toLowerCase() : undefined)),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']).optional(),
  preferredCurrency: z.enum(['UGX', 'KES']).optional(),
  languageCode: z.enum(['en', 'sw', 'lg']).default('en'),
  marketingOptIn: z.boolean().optional(),
  whatsappOptIn: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  /** Omitted the first time an OTP-only account sets a password. */
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200)
    .refine((value) => /[0-9]/.test(value), 'Password needs at least one number')
    .refine((value) => /[A-Za-z]/.test(value), 'Password needs at least one letter'),
});

export const shippingAddressSchema = z.object({
  label: optionalText(30),
  recipientName: shortText(80),
  recipientPhone: phone,
  alternativePhone: phone.optional(),
  districtId: z.coerce.number().int().positive('Choose a delivery district'),
  subcounty: optionalText(80),
  parish: optionalText(80),
  village: optionalText(80),
  streetAddress: optionalText(160),
  /** The field that actually gets a rider to the door in Kampala or Nairobi. */
  nearestLandmark: optionalText(160),
  deliveryNote: optionalText(240),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  pinCode: optionalText(12),
  isDefault: z.boolean().default(false),
});

export const updateAddressSchema = shippingAddressSchema.partial().extend({
  archived: z.boolean().optional(),
});
