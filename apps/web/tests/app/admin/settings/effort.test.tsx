import { OCR_MODELS, OCR_PROVIDERS } from "@receipt-ocr/ai/models";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { effortChoices } from "@/app/admin/settings/effort";
import { OcrChainForm } from "@/app/admin/settings/ocr-chain-form";

// The server actions import server-only modules; rendering does not call them.
vi.mock("@/app/admin/actions", () => ({
  saveOcrAction: vi.fn(),
  checkChainProvidersAction: vi.fn(),
}));
vi.mock("@/components/step-up/step-up", () => ({ withStepUp: vi.fn() }));

const model = (id: string) => OCR_MODELS.find((m) => m.id === id)!;
const provider = (id: string) => OCR_PROVIDERS.find((p) => p.id === id);

describe("effortChoices", () => {
  it("names the default we set ourselves", () => {
    const choices = effortChoices(model("anthropic:claude-sonnet-5-5"), provider("anthropic"))!;
    expect(choices.defaultLabel).toBe("Default (low)");
    expect(choices.items.map((i) => i.value)).toEqual(["default", "low", "medium", "high"]);
  });

  it("says when the provider chooses the default", () => {
    const choices = effortChoices(model("google:gemini-3.8-flash"), provider("google"))!;
    expect(choices.defaultLabel).toBe("Default (medium, Google Gemini's own)");
  });

  it("is fixed for a single value, and absent for a model with no setting", () => {
    expect(effortChoices(model("groq:qwen/qwen3.8-27b"), provider("groq"))!.choosable).toBe(false);
    expect(effortChoices(model("fixture"), provider("fixture"))).toBeNull();
  });
});

describe("OcrChainForm effort", () => {
  const render = (current: { model: string; effort?: string }[]) =>
    renderToStaticMarkup(
      <OcrChainForm
        available={{ anthropic: true, google: true, groq: true }}
        current={current.map((s) => ({ enabled: true, timeoutMs: 30_000, ...s }))}
        models={[...OCR_MODELS]}
        providers={[...OCR_PROVIDERS]}
      />,
    );

  it("shows an Effort select per model that has the setting, with the default when unset", () => {
    const html = render([
      { model: "anthropic:claude-sonnet-5-5" },
      { model: "google:gemini-3.8-flash", effort: "high" },
    ]);
    expect(html.match(/>Effort</g)).toHaveLength(2);
    expect(html).toContain("Default (low)");
    expect(html).toContain("Higher levels cost more and are slower");
  });

  it("shows a fixed line instead of a select for a single-value model", () => {
    const html = render([{ model: "groq:qwen/qwen3.8-27b" }]);
    expect(html).not.toContain(">Effort<");
    expect(html).toContain("Effort: none");
  });
});
