import { NoSuchKey } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  getObject,
  ObjectNotFound,
  probeBucket,
  receiptObjectKey,
  s3Client,
  signedGetUrl,
} from "../src/index";

const config = {
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  bucket: "receipt-ocr",
  accessKeyId: "test",
  secretAccessKey: "test",
  forcePathStyle: true,
};

const params = async (key: string) => new URL(await signedGetUrl(config, key)).searchParams;

describe("signedGetUrl (L5)", () => {
  it("serves PDFs as a download with a pinned type", async () => {
    const query = await params(receiptObjectKey("u1", "r1", "application/pdf"));
    expect(query.get("response-content-disposition")).toBe('attachment; filename="receipt.pdf"');
    expect(query.get("response-content-type")).toBe("application/pdf");
    // The default 600 s plus one 5-minute signing window.
    expect(query.get("X-Amz-Expires")).toBe("900");
  });

  it("keeps images inline with their sniffed type", async () => {
    const query = await params(receiptObjectKey("u1", "r1", "image/png"));
    expect(query.get("response-content-disposition")).toBe("inline");
    expect(query.get("response-content-type")).toBe("image/png");
  });

  describe("caching", () => {
    const key = receiptObjectKey("u1", "r1", "image/png");
    const at = (iso: string) => signedGetUrl(config, key, 600, Date.parse(iso));

    it("returns the same URL for every render inside a 5-minute window", async () => {
      const first = await at("2026-11-08T10:00:00.000Z");
      expect(await at("2026-11-08T10:02:30.000Z")).toBe(first);
      expect(await at("2026-11-08T10:04:59.999Z")).toBe(first);
    });

    it("changes the URL in the next window", async () => {
      expect(await at("2026-11-08T10:05:00.000Z")).not.toBe(await at("2026-11-08T10:04:59.999Z"));
    });

    it("dates the signature at the window start and caches privately for one window", async () => {
      const query = new URL(await at("2026-11-08T10:04:59.999Z")).searchParams;
      expect(query.get("X-Amz-Date")).toBe("20261108T100000Z");
      expect(query.get("response-cache-control")).toBe("private, max-age=300, immutable");
    });

    it("stays valid for at least expiresIn, even when handed out at the end of a window", async () => {
      for (const expiresIn of [120, 600]) {
        const handedOut = Date.parse("2026-11-08T10:04:59.999Z");
        const query = new URL(await signedGetUrl(config, key, expiresIn, handedOut)).searchParams;
        const expires =
          Date.parse("2026-11-08T10:00:00Z") + Number(query.get("X-Amz-Expires")) * 1000;
        expect(expires - handedOut).toBeGreaterThanOrEqual(expiresIn * 1000);
      }
    });
  });

  it("downloads anything unknown as octet-stream", async () => {
    const query = await params("users/u1/receipts/r1.bin");
    expect(query.get("response-content-type")).toBe("application/octet-stream");
    expect(query.get("response-content-disposition")).toMatch(/^attachment/);
  });
});

describe("probeBucket", () => {
  const failWith = (status: number) =>
    Object.assign(new Error(`HTTP ${status}`), { $metadata: { httpStatusCode: status } });

  it("treats a found or missing probe key as reachable, anything else as down", async () => {
    const send = vi.spyOn(s3Client(config), "send");
    send.mockResolvedValueOnce({} as never);
    await expect(probeBucket(config)).resolves.toBeUndefined();
    send.mockRejectedValueOnce(failWith(404) as never);
    await expect(probeBucket(config)).resolves.toBeUndefined();
    send.mockRejectedValueOnce(failWith(403) as never);
    await expect(probeBucket(config)).rejects.toThrow("HTTP 403");
    send.mockRejectedValueOnce(new Error("ECONNREFUSED") as never);
    await expect(probeBucket(config)).rejects.toThrow("ECONNREFUSED");
    send.mockRestore();
  });
});

describe("getObject", () => {
  it("throws ObjectNotFound for a missing key and passes other failures through", async () => {
    const send = vi.spyOn(s3Client(config), "send");
    send.mockRejectedValueOnce(new NoSuchKey({ message: "gone", $metadata: {} }) as never);
    await expect(getObject(config, "users/u1/receipts/r1.jpg")).rejects.toBeInstanceOf(
      ObjectNotFound,
    );
    send.mockRejectedValueOnce(new Error("ECONNRESET") as never);
    const other = await getObject(config, "users/u1/receipts/r1.jpg").catch((e: unknown) => e);
    expect(other).toBeInstanceOf(Error);
    expect(other).not.toBeInstanceOf(ObjectNotFound);
    send.mockRestore();
  });
});
