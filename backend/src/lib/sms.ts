import 'server-only';
import { prisma, type NotificationChannel } from './prisma';
import { env } from './env';

/**
 * SMS + WhatsApp transport. Africa's Talking is used because one account covers both
 * Uganda and Kenya short codes, which matters for OTP delivery latency.
 *
 * When credentials are absent (local dev, CI) the message is logged and the notification
 * row is written as SENT with a `simulated:` provider id, so flows remain testable
 * without ever pretending a real handset was reached.
 */

export type SendSmsInput = {
  to: string; // E.164
  message: string;
  channel?: NotificationChannel;
  userId?: string;
  template?: string;
  data?: Record<string, unknown>;
};

export type SendResult = {
  providerMessageId: string;
  simulated: boolean;
  /** Segments billed by the gateway — a 160-char SMS is 1 segment, a long order receipt is 2. */
  segments: number;
};

const GSM_CHARS = 160;
const UCS2_CHARS = 70;

const isUcs2 = (message: string) => /[^\x00-\x7F]/.test(message);

export const billableSegments = (message: string) =>
  Math.ceil(message.length / (isUcs2(message) ? UCS2_CHARS : GSM_CHARS));

export async function sendSms(input: SendSmsInput): Promise<SendResult> {
  const config = env();
  const channel: NotificationChannel = input.channel ?? 'SMS';
  const segments = billableSegments(input.message);

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId ?? await resolveUserId(input.to),
      channel,
      template: input.template ?? 'generic',
      body: input.message,
      data: (input.data ?? {}) as Record<string, never>,
      status: 'QUEUED',
    },
  });

  if (!config.AFRICASTALKING_API_KEY || !config.AFRICASTALKING_USERNAME) {
    console.warn(`[sms:simulated] -> ${input.to}: ${input.message}`);
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', providerMessageId: `simulated:${notification.id}` },
    });
    return { providerMessageId: `simulated:${notification.id}`, simulated: true, segments };
  }

  const body = new URLSearchParams({
    username: config.AFRICASTALKING_USERNAME,
    to: input.to,
    message: input.message,
    from: config.AFRICASTALKING_SENDER_ID,
  });

  const response = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey: config.AFRICASTALKING_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED' },
    });
    throw new Error(`Africa's Talking SMS failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    SMSMessageData?: { MessageId?: string; Status?: string };
  };
  const providerMessageId = payload.SMSMessageData?.MessageId ?? `at:${notification.id}`;

  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: 'SENT', providerMessageId, sentAt: new Date() },
  });

  return { providerMessageId, simulated: false, segments };
}

async function resolveUserId(phone: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  // Notification.userId is required, so gateway-level messages with no account yet
  // are attributed to the platform ops account (created by the seed).
  if (user) return user.id;
  const ops = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (ops) return ops.id;
  throw new Error('No admin account exists to attribute an orphan notification to — run the seed');
}

/** Order receipts are the highest-open-rate messages sellers care about. */
export function orderPlacedMessage(params: {
  orderNumber: string;
  totalMinor: number;
  currency: 'UGX' | 'KES';
  shopName: string;
}): string {
  const amount = params.totalMinor.toLocaleString('en-US');
  return `Bemz: order ${params.orderNumber} for ${params.currency} ${amount} at ${params.shopName} received. Track it in the Bemz app or dial *384*10#.`;
}

export function orderDispatchedMessage(params: { orderNumber: string; trackingNumber: string }): string {
  return `Bemz: order ${params.orderNumber} is on the way. Tracking ${params.trackingNumber}. Reply STOP to opt out.`;
}
