import { z } from "zod";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }, "Enter a valid date");
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  size: z.number().int().positive().max(10485760),
});
export const paymentSchema = z
  .object({
    typeId: z.string().uuid(),
    amount: z.number().int().positive().max(1e12),
    currency: z.string().regex(/^[A-Z]{3}$/),
    due: dateSchema,
    invoice: z.union([dateSchema, z.literal("")]),
    reference: z.string().max(200),
    description: z.string().max(2000),
    paid: z.boolean(),
    paymentDate: z.union([dateSchema, z.literal("")]),
    seriesId: z.string().uuid().optional(),
    recurrence: z.enum(["none", "monthly", "yearly"]),
    anchor: dateSchema.optional(),
    attachment: attachmentSchema.optional(),
  })
  .refine((p) => !p.paid || !!p.paymentDate, {
    message: "Payment date is required when paid",
    path: ["paymentDate"],
  });
export type Payment = z.infer<typeof paymentSchema>;
export const typeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  order: z.number().int().nonnegative(),
  direction: z.enum(["expense", "income"]).default("expense"),
});
export const prefsSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().refine((s) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: s });
      return true;
    } catch {
      return false;
    }
  }),
  theme: z.enum(["light", "dark", "system"]),
});
export type Preferences = z.infer<typeof prefsSchema>;
export const cashAccountSchema = z.object({
  name: z.string().trim().min(1).max(60),
  currency: z.string().regex(/^[A-Z]{3}$/),
  openingDate: dateSchema,
  openingBalance: z.number().int().min(-1e12).max(1e12),
});
export const cashCategories = [
  "rent",
  "mortgage",
  "service_charges",
  "maintenance",
  "savings_profit",
  "adjustment",
  "other",
] as const;
export const cashEntrySchema = z.object({
  accountId: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  direction: z.enum(["in", "out"]),
  amount: z.number().int().positive().max(1e12),
  date: dateSchema,
  category: z.enum(cashCategories),
  typeId: z.string().uuid().optional(),
  description: z.string().max(2000),
});
export type CashAccount = z.infer<typeof cashAccountSchema>;
export type CashEntry = z.infer<typeof cashEntrySchema>;
export type Kind =
  "payment" | "type" | "preferences" | "cash_account" | "cash_entry";
export interface Row {
  id: string;
  kind: Kind;
  version: number;
  deleted: boolean;
  data: any;
  updated_at?: string;
}
export const currencyDigits = (c: string) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: c,
  }).resolvedOptions().maximumFractionDigits ?? 2;
export function minorUnits(s: string, currency: string) {
  const digits = currencyDigits(currency);
  if (
    !(
      digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`)
    ).test(s)
  )
    throw Error(`Enter a positive amount with up to ${digits} decimal places`);
  const [a, b = ""] = s.split(".");
  const n = Number(a) * 10 ** digits + Number(b.padEnd(digits, "0"));
  if (!Number.isSafeInteger(n) || n <= 0 || n > 1e12)
    throw Error("Enter an amount greater than zero, up to the supported limit");
  return n;
}
export function money(n: number | bigint, c: string) {
  const digits = currencyDigits(c),
    minor = BigInt(n),
    absolute = minor < 0n ? -minor : minor,
    factor = 10n ** BigInt(digits);
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: c,
  });
  const fraction = new Intl.NumberFormat(undefined, {
    useGrouping: false,
    minimumIntegerDigits: Math.max(1, digits),
  }).format(Number(absolute % factor));
  return formatter
    .formatToParts(
      minor < 0n
        ? absolute / factor === 0n
          ? -0
          : -(absolute / factor)
        : absolute / factor,
    )
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}
export const amountInput = (n: number, c: string) =>
  (n / 10 ** currencyDigits(c)).toFixed(currencyDigits(c));
export function today(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (s: string) => parts.find((p) => p.type === s)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const status = (p: Payment, day: string) =>
  p.paid
    ? "Paid"
    : p.due < day
      ? "Overdue"
      : p.due === day
        ? "Due today"
        : "Upcoming";
export const displayDate = (s: string) =>
  s
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(s + "T12:00:00Z"))
    : "—";
export function totals(rows: Row[]) {
  const out: Record<string, { paid: bigint; unpaid: bigint }> = {};
  for (const r of rows) {
    if (r.deleted || r.kind !== "payment") continue;
    const p = r.data as Payment;
    out[p.currency] ??= { paid: 0n, unpaid: 0n };
    out[p.currency][p.paid ? "paid" : "unpaid"] += BigInt(p.amount);
  }
  return out;
}
export function sorted(rows: Row[]) {
  return [...rows].sort(
    (a, b) =>
      Number(a.data.paid) - Number(b.data.paid) ||
      a.data.due.localeCompare(b.data.due) ||
      a.id.localeCompare(b.id),
  );
}
export function validateRow(r: Row) {
  z.object({
    id: z.string().uuid(),
    kind: z.enum([
      "payment",
      "type",
      "preferences",
      "cash_account",
      "cash_entry",
    ]),
    version: z.number().int().nonnegative(),
    deleted: z.boolean(),
  }).parse(r);
  (r.kind === "payment"
    ? paymentSchema
    : r.kind === "type"
      ? typeSchema
      : r.kind === "cash_account"
        ? cashAccountSchema
        : r.kind === "cash_entry"
          ? cashEntrySchema
          : prefsSchema
  ).parse(r.data);
  return r;
}

export function errorMessage(e: unknown) {
  if (e instanceof z.ZodError)
    return e.issues
      .map((issue) => `${issue.path.join(" ")}: ${issue.message}`)
      .join("; ");
  return e instanceof Error ? e.message : "Something went wrong. Please retry.";
}

export function signedMinorUnits(s: string, currency: string) {
  const sign = s.startsWith("-") ? -1 : 1;
  const text = s.replace(/^[+-]/, "");
  if (/^0(?:\.0+)?$/.test(text)) return 0;
  return sign * minorUnits(text, currency);
}
export const isIncome = (types: Row[], typeId: string) =>
  types.some(
    (t) => t.id === typeId && !t.deleted && t.data.direction === "income",
  );
export const paymentStatus = (p: Payment, day: string, types: Row[]) =>
  p.paid && isIncome(types, p.typeId) ? "Received" : status(p, day);
