import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

/** The 1200x630 social card: brand mark, a two-line headline (second line in the accent) and a caption. */
export function renderOgImage({
  headline,
  accent,
  caption,
}: {
  headline: string;
  accent: string;
  caption: string;
}) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background:
          "radial-gradient(52% 62% at 50% 38%, rgba(52,211,153,0.22), transparent 70%), #0a0a0b",
        color: "#e4e4e7",
        fontFamily: "monospace",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 76,
            height: 76,
            borderRadius: 18,
            background: "#34d399",
          }}
        >
          <svg
            width="44"
            height="44"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#07110d"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
            <path d="M14 8H8" />
            <path d="M16 12H8" />
            <path d="M13 16H8" />
          </svg>
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
          <span>receipt</span>
          <span style={{ color: "#34d399" }}>OCR</span>
        </div>
      </div>
      <div
        style={{
          marginTop: 52,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontSize: 72,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -2,
        }}
      >
        <span>{headline}</span>
        <span style={{ color: "#34d399" }}>{accent}</span>
      </div>
      <div style={{ marginTop: 40, fontSize: 28, color: "#9a9aa3" }}>{caption}</div>
    </div>,
    ogSize,
  );
}
