"use client";

import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Input } from "@receipt-ocr/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@receipt-ocr/ui/components/table";
import { Download, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { money, pct } from "@/lib/format";

const categories = ["All", "Grocery", "Restaurant", "Gas", "Pharmacy", "Shopping", "Other"];

export function HistoryTable({ receipts }: { receipts: ReceiptWithItems[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

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
          <p className="mt-2 text-sm text-muted-foreground">{receipts.length} receipts processed</p>
        </div>
        <Button>
          <Download className="size-4" />
          Export All
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
    </div>
  );
}
