import { describe, it, expect } from "vitest";

import { isFetchableThumbnailUrl } from "@/lib/monitor/thumbnail-proxy";

describe("isFetchableThumbnailUrl", () => {
  it("accepts platform CDN thumbnails", () => {
    for (const url of [
      "https://p16-sign-sg.tiktokcdn.com/obj/tos-alisg-p-0037/abc~tplv-photomode.jpeg?x-expires=1",
      "https://scontent-lhr8-1.cdninstagram.com/v/t51.2885-15/123_n.jpg",
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    ]) {
      expect(isFetchableThumbnailUrl(url)?.toString()).toBe(url);
    }
  });

  it("rejects anything that is not https", () => {
    expect(isFetchableThumbnailUrl("http://cdn.example.com/a.jpg")).toBeNull();
    expect(isFetchableThumbnailUrl("file:///etc/passwd")).toBeNull();
    expect(isFetchableThumbnailUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(isFetchableThumbnailUrl("not a url")).toBeNull();
    expect(isFetchableThumbnailUrl("")).toBeNull();
  });

  it("rejects the SSRF shapes — IP literals and local hostnames", () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/a.jpg",
      "https://10.0.0.5/a.jpg",
      "https://[::1]/a.jpg",
      "https://localhost/a.jpg",
      "https://api.localhost/a.jpg",
      "https://router.local/a.jpg",
    ]) {
      expect(isFetchableThumbnailUrl(url)).toBeNull();
    }
  });
});
