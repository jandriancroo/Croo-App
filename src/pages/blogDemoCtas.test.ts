import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DEMO_REQUEST = "https://supaclose.lovable.app/demo";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const htmlFiles = () => {
  const blog = path.join(ROOT, "public/blog");
  return [path.join(blog, "index.html"), ...fs.readdirSync(blog).flatMap(name => {
    const page = path.join(blog, name, "index.html");
    return fs.existsSync(page) ? [page] : [];
  })];
};

const links = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("a")].map(anchor => ({
    text: anchor.textContent?.replace(/\s+/g, " ").trim() ?? "",
    href: anchor.getAttribute("href") ?? "",
  }));
};

describe("blog demo request links", () => {
  it("points Book a demo controls at the request form and leaves product links in place", () => {
    const pages = htmlFiles();
    expect(pages.length).toBeGreaterThan(1);
    for (const file of pages) {
      const found = links(fs.readFileSync(file, "utf8"));
      const demo = found.filter(link => /book a demo/i.test(link.text));
      expect(demo.length, file).toBeGreaterThan(0);
      for (const link of demo) expect(link.href, `${file} ${link.text}`).toBe(DEMO_REQUEST);
      for (const link of found.filter(item => item.text.startsWith("See how"))) {
        expect(link.href, file).toBe("https://croohq.com");
      }
      expect(found.some(link => link.href.includes("#see-it")), file).toBe(false);
    }
    const index = links(fs.readFileSync(path.join(ROOT, "public/blog/index.html"), "utf8"));
    expect(index.find(link => link.text === "See what CrooHQ does")?.href).toBe("/");
  });

  it("keeps the generator and post sources on the same request form", () => {
    const generator = fs.readFileSync(path.join(ROOT, "scripts/build-blog.mjs"), "utf8");
    expect(generator).toContain(`DEMO = "${DEMO_REQUEST}"`);
    expect(generator).not.toContain("#see-it");
    const posts = fs.readdirSync(path.join(ROOT, "blog-src/posts")).filter(name => name.endsWith(".md"));
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      const body = fs.readFileSync(path.join(ROOT, "blog-src/posts", post), "utf8");
      expect(body, post).toContain(`](${DEMO_REQUEST})`);
      expect(body, post).not.toContain("#see-it");
      expect(body, post).toMatch(/\]\(https:\/\/croohq\.com\)/);
    }
  });
});
