import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionErrorCard } from "@/components/section-error";

describe("SectionErrorCard", () => {
  it("names the failed section, announces it, and offers a retry", () => {
    const html = renderToStaticMarkup(<SectionErrorCard label="To check" retry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("To check couldn&#x27;t load.");
    expect(html).toContain("Try again");
    expect(html).not.toMatch(/data-slot="skeleton"/);
  });
});
