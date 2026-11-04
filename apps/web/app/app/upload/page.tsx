import { redirect } from "next/navigation";

// Upload lives on Home now; old links and bookmarks still land there.
export default function UploadPage() {
  redirect("/app");
}
