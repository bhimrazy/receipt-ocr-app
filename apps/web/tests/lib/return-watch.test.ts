import { describe, expect, it, vi } from "vitest";
import { REFRESH_AFTER_HIDDEN_MS, watchReturn } from "@/lib/return-watch";

function harness(startHidden = false) {
  let hidden = startHidden;
  let time = 0;
  let listener = () => {};
  const onReturn = vi.fn();
  const stop = watchReturn({
    isHidden: () => hidden,
    now: () => time,
    onReturn,
    onVisibilityChange: (next) => {
      listener = next;
      return () => {
        listener = () => {};
      };
    },
  });
  return {
    onReturn,
    stop,
    hide: () => {
      hidden = true;
      listener();
    },
    show: () => {
      hidden = false;
      listener();
    },
    wait: (ms: number) => {
      time += ms;
    },
  };
}

describe("watchReturn", () => {
  it("fires after more than a minute in the background", () => {
    const page = harness();
    page.hide();
    page.wait(REFRESH_AFTER_HIDDEN_MS + 1);
    page.show();
    expect(page.onReturn).toHaveBeenCalledTimes(1);
  });

  it("ignores a short switch away, and exactly the threshold", () => {
    const page = harness();
    page.hide();
    page.wait(5_000);
    page.show();
    page.hide();
    page.wait(REFRESH_AFTER_HIDDEN_MS);
    page.show();
    expect(page.onReturn).not.toHaveBeenCalled();
  });

  it("counts from the first hide when hidden fires twice", () => {
    const page = harness();
    page.hide();
    page.wait(40_000);
    page.hide();
    page.wait(40_000);
    page.show();
    expect(page.onReturn).toHaveBeenCalledTimes(1);
  });

  it("counts a page that loaded in the background", () => {
    const page = harness(true);
    page.wait(REFRESH_AFTER_HIDDEN_MS + 1);
    page.show();
    expect(page.onReturn).toHaveBeenCalledTimes(1);
  });

  it("stops listening on cleanup", () => {
    const page = harness();
    page.stop();
    page.hide();
    page.wait(REFRESH_AFTER_HIDDEN_MS + 1);
    page.show();
    expect(page.onReturn).not.toHaveBeenCalled();
  });
});
