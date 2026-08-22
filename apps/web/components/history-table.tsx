"use client";

import { RECEIPT_CATEGORIES } from "@receipt-ocr/ai/categories";
import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Input } from "@receipt-ocr/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@receipt-ocr/ui/components/table";
import { ChevronLeft, ChevronRight, Download, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { money, pct } from "@/lib/format";

// Derived from the AI schema's closed enum so a filter can never drift away
// from the values the extractor is allowed to produce.
const categories = ["All", ...RECEIPT_CATEGORIES];

export function HistoryTable({
  receipts,
  total,
  page,
  pageSize,
}: {
  receipts: ReceiptWithItems[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (next > 1) params.set("page", String(next));
    else params.delete("page");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const filtered = useMemo(
    () =>
      receipts.filter((receipt) => {
        const matchesCategory = category === "All" || receipt.category === category;
        const matchesSearch = (receipt.merchant ?? "").toLowerCase().includes(search.toLowerCase());
        return matchesCategory && matchesSearch;
      }),
    [category, receipts, search],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">History</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {total} {total === 1 ? "receipt" : "receipts"} in this workspace
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </p>
        </div>
        <Button asChild>
          {/* Server-rendered CSV of the whole workspace, not just this page. */}
          <a href="/api/receipts/export">
            <Download className="size-4" />
            Export all
          </a>
        </Button>
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search merchants..." value={search} />
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((item) => (
            <Button
              key={item}
              onClick={() => setCategory(item)}
              size="sm"
              variant={category === item ? "default" : "outline"}
            >
              {item}
            </Button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Merchant</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Confidence</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex flex-col items-center gap-3 py-14 text-center">
                    <span className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary/40 text-muted-foreground">
                      <Search className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">No receipts found</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {receipts.length === 0
                          ? "Upload your first receipt to start building history."
                          : "Try a different search or category filter — these narrow the current page."}
                      </p>
                    </div>
                    {receipts.length === 0 && (
                      <Button asChild size="sm" className="mt-1">
                        <Link href="/app/upload">
                          <Upload className="size-4" /> Upload a receipt
                        </Link>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filtered.map((receipt) => (
              <TableRow key={receipt.id}>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        receipt.status === "completed"
                          ? "bg-primary"
                          : receipt.status === "failed"
                            ? "bg-red-400"
                            : "bg-yellow-300"
                      }`}
                    />
                    {receipt.status}
                  </span>
                </TableCell>
                <TableCell className="font-medium">{receipt.merchant ?? "Untitled"}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{receipt.receiptDate ?? "No date"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{receipt.category ?? "Other"}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{money(receipt.total, receipt.currency ?? "USD")}</TableCell>
                <TableCell className="text-right font-mono text-primary">{pct(receipt.confidence)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/app/receipts/${receipt.id}`}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button disabled={page <= 1} onClick={() => goToPage(page - 1)} size="sm" variant="outline">
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <Button
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
              size="sm"
              variant="outline"
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
