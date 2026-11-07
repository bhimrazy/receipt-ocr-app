import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the server HTML, true once React has hydrated. Until then form controls have no
 * handlers: a form submits natively and a file input drops its files. Rendered as `data-ready`
 * so tests can wait for it.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
