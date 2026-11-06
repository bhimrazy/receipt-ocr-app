import { describe, expect, it, vi } from "vitest";
import { probeBucket, receiptObjectKey, s3Client, signedGetUrl } from "./index";

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
    expect(query.get("X-Amz-Expires")).toBe("600");
  });

  it("keeps images inline with their sniffed type", async () => {
    const query = await params(receiptObjectKey("u1", "r1", "image/png"));
    expect(query.get("response-content-disposition")).toBe("inline");
    expect(query.get("response-content-type")).toBe("image/png");
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
