import { describe, expect, it } from "vitest";
import { resolvesToLight, type ThemePreference } from "./theme";
import { THEME_SCRIPT, THEME_STORAGE_KEY } from "./theme-script";

type Meta = { name: string; content: string; attrs: Record<string, string> };

/** Runs THEME_SCRIPT against a minimal document; `stored: "throw"` makes storage throw. */
function run(stored: string | null | "throw", systemLight: boolean) {
  const classes = new Set<string>();
  const prepended: Meta[] = [];
  const root = {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
    style: { colorScheme: "" },
  };
  const document = {
    documentElement: root,
    head: { prepend: (meta: Meta) => prepended.push(meta) },
    createElement: (): Meta => {
      const meta: Meta = { name: "", content: "", attrs: {} };
      return Object.assign(meta, {
        setAttribute: (key: string, value: string) => (meta.attrs[key] = value),
      });
    },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (stored === "throw") throw new Error("blocked");
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const matchMedia = (query: string) => ({
    matches: query === "(prefers-color-scheme: light)" && systemLight,
  });
  new Function("document", "localStorage", "matchMedia", THEME_SCRIPT)(
    document,
    localStorage,
    matchMedia,
  );
  return { light: classes.has("light"), scheme: root.style.colorScheme, metas: prepended };
}

describe("THEME_SCRIPT", () => {
  it("follows the OS when nothing is stored (System)", () => {
    expect(run(null, false)).toEqual({ light: false, scheme: "dark", metas: [] });
    expect(run(null, true)).toEqual({ light: true, scheme: "light", metas: [] });
  });

  it("lets a stored choice win over the OS and pins the browser chrome to it", () => {
    const light = run("light", false);
    expect(light.light).toBe(true);
    expect(light.scheme).toBe("light");
    expect(light.metas).toMatchObject([{ name: "theme-color", content: "#f7f7f8" }]);
    expect(light.metas[0]!.attrs).toHaveProperty("data-theme-override");

    const dark = run("dark", true);
    expect(dark.light).toBe(false);
    expect(dark.scheme).toBe("dark");
    expect(dark.metas).toMatchObject([{ name: "theme-color", content: "#0a0a0b" }]);
  });

  it("treats an unknown value as System", () => {
    expect(run("sepia", true).light).toBe(true);
    expect(run("sepia", true).metas).toEqual([]);
  });

  it("stays dark when storage throws", () => {
    expect(run("throw", true)).toEqual({ light: false, scheme: "", metas: [] });
  });

  it("resolves preferences the same way the client store does", () => {
    for (const preference of ["system", "light", "dark"] as ThemePreference[]) {
      for (const systemLight of [false, true]) {
        const stored = preference === "system" ? null : preference;
        expect(run(stored, systemLight).light).toBe(resolvesToLight(preference, systemLight));
      }
    }
  });
});
