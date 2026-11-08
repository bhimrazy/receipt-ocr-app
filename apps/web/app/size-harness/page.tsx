"use client";

// Local QA harness, never committed: the review sheet on a synthetic receipt.
import { useEffect, useState } from "react";
import ReviewSheet, { type ReviewImage } from "@/components/capture/review-sheet";

function synthetic(width: number, height: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3f44";
  g.fillRect(0, 0, width, height);
  const m = Math.round(width * 0.12);
  g.fillStyle = "#f7f5ef";
  g.fillRect(m, m, width - 2 * m, height - 2 * m);
  g.fillStyle = "#222";
  const fs = Math.round(width / 40);
  g.font = `${fs * 1.6}px monospace`;
  g.fillText("SAMPLE MART", m + fs * 2, m + fs * 4);
  g.font = `${fs}px monospace`;
  for (let i = 0; i < Math.floor((height - 2 * m) / (fs * 1.6)) - 6; i++) {
    const y = m + fs * 7 + i * fs * 1.6;
    g.fillText(`Item ${String(i + 1).padStart(2, "0")} test product`, m + fs * 2, y);
    g.fillText(`${(i * 1.37 + 2).toFixed(2)}`, width - m - fs * 6, y);
  }
  return new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.92));
}

export default function Page() {
  const [images, setImages] = useState<ReviewImage[] | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const w = Number(p.get("w") ?? 3024);
    const h = Number(p.get("h") ?? 4032);
    const n = Number(p.get("n") ?? 1);
    synthetic(w, h).then((blob) =>
      setImages(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, blob, name: "test.jpg" }))),
    );
  }, []);
  if (!images) return null;
  return <ReviewSheet images={images} onCancel={() => {}} onUpload={() => {}} />;
}
