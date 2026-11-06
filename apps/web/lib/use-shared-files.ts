import { useEffect, useRef, type RefObject } from "react";
import { takeSharedFiles } from "@/lib/share-target";

/**
 * Puts files shared to the app (Android share sheet) into `input`, a file input, and fires its
 * change event, so they take the same path as files the visitor picked. Runs once, on mount. It
 * does not look for `?shared=1`: the share may arrive through sign-in or a redirect that drops
 * the query. With no input rendered (the daily limit is reached), the files stay stored until
 * they expire.
 */
export function useSharedFiles(input: RefObject<HTMLInputElement | null>) {
  // A ref survives Strict Mode's second effect run, so the files are taken (and cleared) once.
  const taken = useRef(false);
  useEffect(() => {
    if (!input.current || taken.current) return;
    taken.current = true;
    void takeSharedFiles().then((files) => {
      const target = input.current;
      if (files.length === 0 || !target) return;
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      target.files = transfer.files;
      target.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, [input]);
}
