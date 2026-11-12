"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { createContext, useContext, useState } from "react";
import { AppBarActions } from "@/components/app-nav";
import { NOTHING, type Selection } from "./selection";

type SelectionState = {
  selection: Selection;
  setSelection: (next: Selection | ((current: Selection) => Selection)) => void;
  /** Phones only: rows are checkboxes and the action bar replaces the tab bar. */
  selecting: boolean;
  setSelecting: (on: boolean) => void;
};

const SelectionContext = createContext<SelectionState | null>(null);

/**
 * Holds History's selection above the results, so it survives paging and sorting (which
 * re-render the results). A different filter (`filterKey`) starts over: "all that match" and
 * hidden rows would otherwise be acted on without being seen.
 */
export function SelectionProvider({
  filterKey,
  children,
}: {
  filterKey: string;
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
  return (
    <SelectionContext.Provider value={{ selection, setSelection, selecting, setSelecting }}>
      {children}
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
