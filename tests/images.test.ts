import { describe, expect, test } from "bun:test";
import { imageFormat, MAX_SIDE, readImage } from "../src/images.ts";
import { jpeg, png } from "./helpers/images.ts";

const sizeOf = (read: ReturnType<typeof readImage>) => ("skipped" in read ? read : { width: read.width, height: read.height });

describe("imageFormat", () => {
  test("tells PNG and JPEG apart by their first bytes, as the API does", () => {
    expect(imageFormat(png(300, 300).subarray(0, 8))).toBe("png");
    expect(imageFormat(jpeg(300, 300).subarray(0, 8))).toBe("jpeg");
    expect(imageFormat(new TextEncoder().encode("GIF89a.."))).toBeUndefined();
    expect(imageFormat(new TextEncoder().encode("# notes\n"))).toBeUndefined();
    expect(imageFormat(Uint8Array.from([0x89, 0x50]))).toBeUndefined();
  });
});

describe("readImage", () => {
  test("reads the size of a PNG and of baseline and progressive JPEGs", () => {
    expect(sizeOf(readImage("png", png(1280, 720)))).toEqual({ width: 1280, height: 720 });
    expect(sizeOf(readImage("jpeg", jpeg(1024, 768)))).toEqual({ width: 1024, height: 768 });
    expect(sizeOf(readImage("jpeg", jpeg(800, 1200, { progressive: true })))).toEqual({ width: 800, height: 1200 });
  });

  test("keeps the format and the bytes as they are", () => {
    const bytes = png(400, 300);
    expect(readImage("png", bytes)).toEqual({ format: "png", width: 400, height: 300, bytes });
  });

  test("the size limits include both ends", () => {
    expect(sizeOf(readImage("png", png(MAX_SIDE, MAX_SIDE)))).toEqual({ width: MAX_SIDE, height: MAX_SIDE });
    expect(sizeOf(readImage("png", png(280, 280)))).toEqual({ width: 280, height: 280 });
    expect(sizeOf(readImage("png", png(280, MAX_SIDE)))).toEqual({ width: 280, height: MAX_SIDE });
  });

  test("says how a screenshot outside Jev's limits has to change", () => {
    expect(readImage("png", png(1600, 900))).toEqual({ skipped: "1600×900 px PNG; Jev takes at most 1568 px a side, so scale it down first" });
    expect(readImage("jpeg", jpeg(2560, 1440))).toEqual({ skipped: "2560×1440 px JPEG; Jev takes at most 1568 px a side, so scale it down first" });
    expect(readImage("png", png(300, 200))).toEqual({ skipped: "300×200 px PNG; Jev takes at least 280 px a side" });
  });

  test("refuses a side under 280 px, which the API rejects", () => {
    expect(readImage("png", png(256, 300))).toEqual({ skipped: "256×300 px PNG; Jev takes at least 280 px a side" });
    expect(readImage("png", png(279, 1568))).toEqual({ skipped: "279×1568 px PNG; Jev takes at least 280 px a side" });
  });

  test("refuses animated PNGs and files whose size cannot be read", () => {
    expect(readImage("png", png(300, 300, { animated: true }))).toEqual({ skipped: "animated PNG; Jev takes still images only" });
    expect(readImage("png", png(300, 300).subarray(0, 12))).toEqual({ skipped: "PNG without a readable size" });
    expect(readImage("jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]))).toEqual({ skipped: "JPEG without a readable size" });
    expect(readImage("jpeg", jpeg(300, 300).subarray(0, 30))).toEqual({ skipped: "JPEG without a readable size" });
  });
});
