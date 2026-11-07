/** Stands in for @react-email/render on the server (see next.config.ts): emails are prerendered. */
export function render(): never {
  throw new Error("React Email is build-time only here; send prerendered html and text instead.");
}
