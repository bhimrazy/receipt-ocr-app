import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "@/components/password-input";

describe("PasswordInput", () => {
  const html = renderToStaticMarkup(
    <PasswordInput
      aria-describedby="new-password-hint"
      autoComplete="new-password"
      id="new-password"
      onChange={() => {}}
      value=""
    />,
  );

  it("starts hidden, with the toggle named and not pressed", () => {
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-controls="new-password"');
  });

  it("keeps the caller's autocomplete and description on the input", () => {
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('aria-describedby="new-password-hint"');
  });

  it("never submits the form from the toggle", () => {
    expect(html).toMatch(/<button[^>]*type="button"/);
  });
});
