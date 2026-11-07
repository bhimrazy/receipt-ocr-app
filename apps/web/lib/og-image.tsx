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
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#07110d"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 3h9l3 3v15l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
            <path d="M15 3v3h3" />
            <path d="M9 7.5h4" />
            <path d="M2.5 11.5h19" strokeWidth="2.6" />
            <path d="M9 15.5h5" opacity="0.45" />
          </svg>
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
          <span>Receipt</span>
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
