import { Prisma } from '@prisma/client';

export function parseRawAmount(value: unknown): Prisma.Decimal | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Prisma.Decimal(value.toString());
  }
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  if (text.endsWith('-')) { negative = true; text = text.slice(0, -1).trim(); }
  if (text.startsWith('-')) { negative = true; text = text.slice(1).trim(); }
  if (!/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(text) && !/^\d+(?:\.\d+)?$/.test(text)) return null;
  const decimal = new Prisma.Decimal(text.replaceAll(',', ''));
  return negative ? decimal.negated() : decimal;
}

export function decimalString(value: Prisma.Decimal) { return value.toFixed(2); }
export function semanticText(value: unknown) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
