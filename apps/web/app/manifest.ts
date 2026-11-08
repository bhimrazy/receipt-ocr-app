import type { MetadataRoute } from "next";
import { PWA_SOURCE } from "@/lib/signed-in-hint";
import { SITE_NAME } from "@/lib/site";
import { SHARE_TARGET_FIELD, SHARE_TARGET_PATH } from "@/lib/share-target";

// --background in packages/ui/src/styles.css; the app is dark-only.
const BACKGROUND = "#0a0a0b";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: "Turn receipt photos and PDFs into rows you can check and export as CSV.",
    // The query marks home-screen launches (proxy.ts, page.render's launch_source); `id` stays.
    start_url: `/app?source=${PWA_SOURCE}`,
    scope: "/",
    display: "standalone",
    // Portrait suits taking photos, but History's table and tablets read better sideways.
    orientation: "any",
    background_color: BACKGROUND,
    theme_color: BACKGROUND,
    categories: ["finance", "productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-monochrome-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "monochrome",
      },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      {
        name: "Add receipt",
        short_name: "Add",
        description: "Upload or photograph a receipt",
        // capture=1 is for the camera track's upload page, which will open the camera from it.
        url: "/app/upload?capture=1",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    // Android Chrome: receipts shared from the gallery or a PDF viewer. The service worker
    // handles the POST; without one, the route handler sends the visitor to the upload page.
    share_target: {
      action: SHARE_TARGET_PATH,
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: SHARE_TARGET_FIELD, accept: ["image/*", "application/pdf"] }] },
    },
  };
}
