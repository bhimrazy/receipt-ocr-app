"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { createContext, useContext, useState } from "react";
import { AppBarActions } from "@/components/app-nav";
import { NOTHING, receiptCount, selectedCount, type Selection } from "./selection";

type SelectionState = {
  selection: Selection;
  setSelection: (next: Selection | ((current: Selection) => Selection)) => void;
  /** Phones only: rows are checkboxes and the action bar replaces the tab bar. */
  selecting: boolean;
  setSelecting: (on: boolean) => void;
  /** The workspace the selection was made in; actions send it so the server can refuse a switch. */
  organizationId: string;
};

const SelectionContext = createContext<SelectionState | null>(null);

/**
 * Holds History's selection above the results, so it survives paging and sorting (which
 * re-render the results). A different workspace or filter (`filterKey`) starts over: "all
 * that match" and hidden rows would otherwise be acted on without being seen. Also the one
 * live region that announces the count, mounted for the page's whole life so screen readers
 * hear changes from the table, the bars and "Select all".
 */
export function SelectionProvider({
  filterKey,
  organizationId,
  children,
}: {
  filterKey: string;
  organizationId: string;
  children: React.ReactNode;
}) {
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const [selecting, setSelectingState] = useState(false);
  const [syncedKey, setSyncedKey] = useState(filterKey);
  if (syncedKey !== filterKey) {
    setSyncedKey(filterKey);
    setSelection(NOTHING);
  }
  const setSelecting = (on: boolean) => {
    setSelectingState(on);
    if (!on) setSelection(NOTHING);
  };
  const n = selectedCount(selection);
  return (
    <SelectionContext.Provider
      value={{ selection, setSelection, selecting, setSelecting, organizationId }}
    >
      {children}
      <p aria-live="polite" className="sr-only">
        {selection.kind === "all"
          ? `All ${receiptCount(n)} that match are selected.`
          : n > 0
            ? `${receiptCount(n)} selected.`
            : ""}
      </p>
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelection needs SelectionProvider");
  return value;
}

/** "Select" / "Done" in the phone app bar. Desktop always shows checkboxes. */
export function PhoneSelectButton() {
  const { selecting, setSelecting } = useSelection();
  return (
    <AppBarActions>
      <Button
        className="md:hidden"
        onClick={() => setSelecting(!selecting)}
        size="sm"
        variant="ghost"
      >
        {selecting ? "Done" : "Select"}
      </Button>
    </AppBarActions>
  );
}
