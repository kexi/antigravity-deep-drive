import { describe, it, expect } from "vitest";
import indexHtml from "../../index.html?raw";
import ogImageUrl from "../../public/og-image.png";

describe("Open Graph & Twitter Card Metadata", () => {
  it("should contain standard Open Graph tags in index.html", () => {
    expect(indexHtml).toContain('property="og:type"');
    expect(indexHtml).toContain('content="website"');
    expect(indexHtml).toContain('content="https://kexi.github.io/antigravity-deep-drive/"');
    expect(indexHtml).toContain(
      'content="Antigravity Deep Drive — 3D Tokyo &amp; Shibuya Driving Simulator"',
    );
    expect(indexHtml).toContain(
      'content="https://kexi.github.io/antigravity-deep-drive/og-image.png"',
    );
    expect(indexHtml).toContain('property="og:image:width"');
    expect(indexHtml).toContain('content="1200"');
    expect(indexHtml).toContain('property="og:image:height"');
    expect(indexHtml).toContain('content="630"');
    expect(indexHtml).toContain('content="en_US"');
  });

  it("should contain Twitter Card summary_large_image tags for X preview", () => {
    expect(indexHtml).toContain('name="twitter:card"');
    expect(indexHtml).toContain('content="summary_large_image"');
    expect(indexHtml).toContain('name="twitter:site"');
    expect(indexHtml).toContain('content="@7_tsuno"');
    expect(indexHtml).toContain('name="twitter:creator"');
    expect(indexHtml).toContain('name="twitter:image"');
    expect(indexHtml).toContain(
      'content="https://kexi.github.io/antigravity-deep-drive/og-image.png"',
    );
  });

  it("should have a valid og-image.png asset available in public directory", () => {
    expect(ogImageUrl).toBeDefined();
    expect(typeof ogImageUrl).toBe("string");
  });
});
