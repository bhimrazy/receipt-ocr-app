export function money(value?: string | number | null, currency = "USD") {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function pct(value?: string | number | null) {
  const amount = Number(value ?? 0);
  return `${Math.round(amount * 100)}%`;
}
