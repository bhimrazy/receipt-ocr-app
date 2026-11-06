import { useEffect, useRef, useState, type RefObject } from "react";
import { takeSharedFiles } from "@/lib/share-target";

// Set by public/sw.js (`failed`) and app/share-target/route.ts (`unavailable`).
const SHARE_PROBLEMS: Record<string, string> = {
  failed: "The shared files didn't come through. Add them here instead.",
  unavailable:
    "Sharing to receiptOCR isn't ready on this device yet. Add the files here instead; sharing works after the app has been opened once.",
};

/**
 * Files shared to the app (Android share sheet), held back until the visitor keeps them: any site
 * can POST to /share-target, so nothing joins the queue unseen. `keep` puts them into `input`, a
 * file input, and fires its change event, so they are prepared and checked like picked files.
 * Runs once, on mount, and does not depend on `?shared=1`, which sign-in or a redirect may drop.
 * With no input rendered (the daily limit is reached), the files stay stored until they expire.
 */
export function useSharedFiles(input: RefObject<HTMLInputElement | null>) {
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // A ref survives Strict Mode's second effect run, so the files are taken (and cleared) once.
  const taken = useRef(false);
  useEffect(() => {
    if (!input.current || taken.current) return;
    taken.current = true;
    const url = new URL(location.href);
    const status = url.searchParams.get("shared");
    if (status) {
      url.searchParams.delete("shared");
      history.replaceState(history.state, "", url);
    }
    void takeSharedFiles().then((shared) => {
      setProblem(status ? (SHARE_PROBLEMS[status] ?? null) : null);
      setFiles(shared);
    });
  }, [input]);

  function keep() {
    if (input.current && files.length > 0) pick(input.current, files);
    setFiles([]);
  }

  return { files, problem, keep, discard: () => setFiles([]) };
}

/** Sets the input's files as if the visitor had picked them, firing its change handler. */
function pick(input: HTMLInputElement, files: File[]) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
