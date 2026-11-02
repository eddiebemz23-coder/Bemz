'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { uploadMedia } from '@/lib/client/upload';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useToast } from '@/components/toast';

const DOCUMENT_TYPES = [
  { value: 'NATIONAL_ID', label: 'National ID (NIN / ID number)' },
  { value: 'BUSINESS_REGISTRATION', label: 'Business registration' },
  { value: 'TAX_PIN', label: 'TAX PIN certificate' },
  { value: 'BANK_OR_MOMO_PROOF', label: 'Bank card or MoMo proof' },
  { value: 'FACE_VERIFICATION', label: 'Selfie holding the ID' },
];

const DOC_TONE: Record<string, BadgeTone> = {
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  PENDING: 'neutral',
};

const PROVIDERS = [
  { value: 'MTN_MOMO', label: 'MTN Mobile Money' },
  { value: 'AIRTEL_MONEY', label: 'Airtel Money' },
  { value: 'BANK', label: 'Bank account' },
];

interface DraftDocument {
  type: string;
  url: string;
  publicId: string;
  fileName: string;
  uploading: boolean;
}

export interface KycInitialState {
  status: string;
  documents: { id: string; type: string; status: string; reviewNote: string | null; submittedAt: string | Date }[];
}

export interface PayoutAccountState {
  provider: string | null;
  accountNumber: string | null;
  accountName: string | null;
  isVerified: boolean;
}

/**
 * `POST /api/seller/shop/kyc`, `DELETE /api/seller/shop/kyc`
 *
 * Identity documents are the door to two things a seller actually wants: gated categories (phones,
 * building materials, agro-chemicals) and the first payout. The files are uploaded to a private
 * Cloudinary folder, so the seller sees the document type and its review state — never a URL that
 * would work for anybody else.
 */
export function KycPanel({ shopId, initial, countryCode }: { shopId: string; initial: KycInitialState; countryCode: 'UG' | 'KE' }) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [drafts, setDrafts] = useState<DraftDocument[]>([]);
  const [pendingType, setPendingType] = useState('NATIONAL_ID');
  const [nationalIdNumber, setNationalIdNumber] = useState('');
  const [taxPin, setTaxPin] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const approved = initial.status === 'APPROVED';
  const canWithdraw = initial.status === 'SUBMITTED' || initial.status === 'UNDER_REVIEW';

  async function attach(file: File) {
    const type = pendingType;
    if (drafts.some((draft) => draft.type === type)) {
      setIssues({ documents: `You already attached a ${labelOf(type)} — remove it to replace it` });
      return;
    }
    setIssues({});
    setDrafts((current) => [...current, { type, url: '', publicId: '', fileName: file.name, uploading: true }]);

    try {
      const asset = await uploadMedia(file, { target: 'kyc', shopId });
      setDrafts((current) =>
        current.map((draft) => (draft.type === type ? { ...draft, url: asset.url, publicId: asset.publicId, uploading: false } : draft)),
      );
    } catch (failure) {
      setDrafts((current) => current.filter((draft) => draft.type !== type));
      setIssues({ documents: failure instanceof ApiFailure ? failure.message : 'That file did not upload' });
    }
  }

  async function submit() {
    const ready = drafts.filter((draft) => !draft.uploading && draft.url);
    const problems: Record<string, string> = {};
    if (ready.length === 0) problems.documents = 'Attach at least one document';
    else if (initial.status === 'NOT_SUBMITTED' && !ready.some((draft) => draft.type === 'NATIONAL_ID')) {
      problems.documents = 'A photo of your national ID is the one document we always need';
    }
    setIssues(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    try {
      await api.post<{ kycStatus: string }>('/api/seller/shop/kyc', {
        documents: ready.map((draft) => ({ type: draft.type, publicId: draft.publicId, url: draft.url })),
        nationalIdNumber: nationalIdNumber.trim() || undefined,
        taxPin: taxPin.trim() || undefined,
        businessName: businessName.trim() || undefined,
      });
      toast.push('Sent to the review team. Most shops are answered within two working days.', 'success');
      setDrafts([]);
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const parsed = failure.issues;
        setIssues(Object.keys(parsed).length > 0 ? parsed : { documents: failure.message });
      } else {
        setIssues({ documents: 'The submission did not go — try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setIssues({});
    try {
      await api.del('/api/seller/shop/kyc');
      toast.push('Submission withdrawn. Nothing was shared with the review team.', 'success');
      router.refresh();
    } catch (failure) {
      setIssues({ documents: failure instanceof ApiFailure ? failure.message : 'Could not withdraw the submission' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Identity and documents</h2>
          <p className="mt-1 text-xs text-ink-500">
            Lets you list in gated categories and receive your first payout. Reviewed by a person at Bemz, in {countryCode === 'KE' ? 'Kenya' : 'Uganda'}.
          </p>
        </div>
        <KycBadge status={initial.status} />
      </div>

      {initial.documents.length > 0 && (
        <ul className="space-y-2">
          {initial.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-2 rounded-card bg-ink-50 px-3 py-2">
              <span className="text-sm font-medium text-ink-900">{labelOf(document.type)}</span>
              <Badge tone={DOC_TONE[document.status] ?? 'neutral'}>{humanStatus(document.status)}</Badge>
              {document.reviewNote && <span className="text-xs text-clay-700">{document.reviewNote}</span>}
            </li>
          ))}
        </ul>
      )}

      {approved ? (
        <p className="rounded-card bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Approved. If your ID expired or your business name changed, send a new document and support updates the record.
        </p>
      ) : (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void attach(file);
              event.target.value = '';
            }}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Document to attach"
              value={pendingType}
              onChange={(event) => setPendingType(event.target.value)}
              options={DOCUMENT_TYPES.map((option) => ({
                value: option.value,
                label: option.label,
                disabled: drafts.some((draft) => draft.type === option.value) || initial.documents.some((document) => document.type === option.value),
              }))}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              Choose file
            </Button>
          </div>

          {issues.documents && (
            <p role="alert" className="text-sm text-clay-700">
              {issues.documents}
            </p>
          )}

          {drafts.length > 0 && (
            <ul className="space-y-1">
              {drafts.map((draft) => (
                <li key={draft.type} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink-700">
                    {labelOf(draft.type)} — {draft.fileName}
                  </span>
                  {draft.uploading ? (
                    <span className="text-xs text-ink-500">uploading…</span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-medium text-clay-700 hover:underline"
                      onClick={() => setDrafts((current) => current.filter((value) => value.type !== draft.type))}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label="National ID number"
              value={nationalIdNumber}
              onChange={(event) => setNationalIdNumber(event.target.value)}
              maxLength={30}
              placeholder={countryCode === 'KE' ? '2xxxxxx' : 'CMxxxxxxx'}
              error={issues.nationalIdNumber}
              hint={countryCode === 'KE' ? 'Kenyan ID or Alieno number' : 'Ugandan NIN printed on the ID'}
            />
            <TextField label="TAX PIN (optional)" value={taxPin} onChange={(event) => setTaxPin(event.target.value)} maxLength={30} error={issues.taxPin} />
            <TextField
              label="Registered business name (optional)"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              maxLength={120}
              error={issues.businessName}
              hint="Only if you trade as a company, not as yourself"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button loading={busy} disabled={drafts.length === 0 || drafts.some((draft) => draft.uploading)} onClick={() => void submit()}>
              {initial.status === 'REJECTED' ? 'Resubmit for review' : 'Submit for review'}
            </Button>
            {canWithdraw && (
              <Button variant="ghost" size="sm" className="text-clay-700" loading={busy} onClick={() => void withdraw()}>
                Withdraw the submission
              </Button>
            )}
            <p className="text-xs text-ink-500">Documents are stored privately. Buyers only ever see the “Verified” mark.</p>
          </div>
        </>
      )}
    </section>
  );
}

function KycBadge({ status }: { status: string }) {
  if (status === 'APPROVED') return <Badge tone="success">Approved</Badge>;
  if (status === 'REJECTED') return <Badge tone="danger">Rejected — send it again</Badge>;
  if (status === 'SUBMITTED') return <Badge tone="warning">With the review team</Badge>;
  if (status === 'UNDER_REVIEW') return <Badge tone="info">Being checked now</Badge>;
  return <Badge tone="neutral">Not submitted</Badge>;
}

function labelOf(type: string): string {
  return DOCUMENT_TYPES.find((option) => option.value === type)?.label ?? type.replace(/_/g, ' ').toLowerCase();
}

function humanStatus(status: string): string {
  if (status === 'SUBMITTED') return 'Submitted';
  if (status === 'UNDER_REVIEW') return 'In review';
  if (status === 'APPROVED') return 'Approved';
  if (status === 'REJECTED') return 'Rejected';
  return status.toLowerCase();
}

/**
 * `POST /api/seller/shop/payout-account`
 *
 * Where the platform sends the money. Saving a new number clears the verification mark and blocks
 * withdrawals until support has called it — the window in which a hijacked account most wants to
 * change where its money goes, so the confirmation is a human on the phone, not a checkbox.
 */
export function PayoutAccountForm({ initial, countryCode }: { initial: PayoutAccountState; countryCode: 'UG' | 'KE' }) {
  const router = useRouter();
  const toast = useToast();
  const [provider, setProvider] = useState(initial.provider ?? (countryCode === 'KE' ? 'MTN_MOMO' : 'MTN_MOMO'));
  const [accountNumber, setAccountNumber] = useState(initial.accountNumber ?? '');
  const [accountName, setAccountName] = useState(initial.accountName ?? '');
  const [bankName, setBankName] = useState('');
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const isBank = provider === 'BANK';

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});
    try {
      await api.post<{ isVerified: boolean }>('/api/seller/shop/payout-account', {
        provider,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        bankName: isBank ? bankName.trim() || undefined : undefined,
      });
      toast.push('Payout number saved. Bemz confirms it with you before the first transfer.', 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const parsed = failure.issues;
        setIssues(Object.keys(parsed).length > 0 ? parsed : { form: failure.message });
      } else {
        setIssues({ form: 'Could not save the payout account — try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Where payouts land</h2>
          <p className="mt-1 text-xs text-ink-500">Mobile money clears same day; a bank transfer takes two working days.</p>
        </div>
        {initial.accountNumber ? (
          initial.isVerified ? (
            <Badge tone="success">Confirmed</Badge>
          ) : (
            <Badge tone="warning">Awaiting confirmation</Badge>
          )
        ) : (
          <Badge tone="neutral">Not set</Badge>
        )}
      </div>

      {issues.form && (
        <p role="alert" className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {issues.form}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Method"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          options={PROVIDERS}
          error={issues.provider}
        />
        <TextField
          label={isBank ? 'Account number' : 'Mobile money number'}
          value={accountNumber}
          onChange={(event) => setAccountNumber(event.target.value)}
          required
          maxLength={34}
          inputMode={isBank ? 'numeric' : 'tel'}
          placeholder={isBank ? 'Acc. 0123 4567 890' : countryCode === 'KE' ? '0712 345 678' : '077 1234 567'}
          error={issues.accountNumber}
          hint="The exact number that will be credited — a payout sent to a wrong number does not come back."
        />
        <TextField label="Name on the account" value={accountName} onChange={(event) => setAccountName(event.target.value)} required maxLength={80} error={issues.accountName} />
        {isBank && (
          <TextField label="Bank name" value={bankName} onChange={(event) => setBankName(event.target.value)} maxLength={80} error={issues.bankName} placeholder="DFCU / Stanbic / Equity" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={accountNumber.trim().length < 6 || accountName.trim().length < 2}>
          {initial.accountNumber ? 'Update payout account' : 'Save payout account'}
        </Button>
        <p className="text-xs text-ink-500">
          {initial.isVerified
            ? 'Changing this clears the confirmation and pauses withdrawals until support calls you.'
            : 'Support verifies this number by phone before your first payout goes out.'}
        </p>
      </div>
    </form>
  );
}
