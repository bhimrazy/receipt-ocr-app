import { describe, expect, it } from "vitest";
import { receiptObjectKey, signedGetUrl } from "./index";

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
