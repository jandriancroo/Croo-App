#!/usr/bin/env node
// Static blog generator: blog-src/posts/*.md + blog-src/heroes/<hero>-{1600x900,1200x627}.png
// -> public/blog/index.html, public/blog/<slug>/index.html, public/blog/assets/*
// Usage: node scripts/build-blog.mjs   (see blog-src/README.md)
import fs from "node:fs"; import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "blog-src"), OUT = path.join(ROOT, "public/blog"), A = path.join(OUT, "assets");
const SITE = "https://croohq.com", DEMO = "https://supaclose.lovable.app/demo";
const BIO = "Ran four restaurant locations over 12 years before building CrooHQ.";
const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const inl = s => esc(s).replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>').replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>");
const conv = body => body.trim().split(/\n\s*\n/).map(b => { const L=b.trim().split("\n");
  if (b.startsWith("## ")) return `<h2>${inl(b.slice(3))}</h2>`;
  if (L[0].startsWith("- ")) return "<ul>"+L.map(l=>`<li>${inl(l.slice(2))}</li>`).join("")+"</ul>";
  if (/^\d+\. /.test(L[0])) return "<ol>"+L.map(l=>`<li>${inl(l.replace(/^\d+\. /,""))}</li>`).join("")+"</ol>";
  return `<p>${inl(L.join(" "))}</p>`; }).join("\n");
const fmtDate = d => new Date(d+"T12:00:00Z").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"});
const CSS = `*{box-sizing:border-box}body{margin:0;background:#fbf8f3;font:18px/1.7 Manrope,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1a1a1a}a{color:inherit}
.wrap{max-width:1100px;margin:0 auto;padding:0 32px}header{background:#fff;border-bottom:1px solid #e8e2d6}.hd{display:flex;align-items:center;height:76px;gap:16px}
.logo{height:32px;display:block}.sep{color:#417f8e;font-weight:800;border-left:2px solid #d9e6e9;padding-left:16px;font-size:20px;text-decoration:none}nav{margin-left:auto;display:flex;gap:26px;font-size:15px;align-items:center;font-weight:700}nav a{color:#5c5852;text-decoration:none}.nb{background:#417f8e;color:#fff!important;padding:9px 16px;border-radius:999px}
.art{max-width:820px;padding-top:48px;padding-bottom:60px}.kicker{color:#417f8e;font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:13px}
h1{font-size:46px;line-height:1.15;margin:12px 0 22px;letter-spacing:-.02em;font-weight:800}.by{display:flex;align-items:center;gap:14px;font-size:16px}.by img{width:56px;height:56px;border-radius:50%;border:2px solid #417f8e}.by span{color:#5c5852;font-size:14px}
.hero{width:100%;height:auto;border-radius:14px;margin:30px 0 10px;aspect-ratio:16/9;object-fit:cover}
h2{font-size:27px;margin:42px 0 8px;color:#2e6270;font-weight:800}article a{color:#417f8e;font-weight:600;text-decoration:underline;text-underline-offset:3px}li{margin:8px 0}
.cta{background:#417f8e;color:#fff;border-radius:16px;padding:36px 40px;margin-top:48px}.cta h3{margin:0;font-size:28px}.cta p{margin:6px 0 22px;opacity:.9}
.btns{display:flex;flex-direction:column;gap:12px}.btn{background:#fff;color:#2e6270;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:10px;font-size:17px}.btn.alt{background:transparent;color:#fff;border:2px solid #fff}
.by.sm{margin-top:24px}.by.sm img{width:44px;height:44px;border-color:#fff}.cta .by span{color:#e6f2f4}footer{border-top:1px solid #e8e2d6;padding:26px 0;color:#5c5852;font-size:14px}footer a{color:#417f8e;font-weight:700}
.list{padding-top:48px;padding-bottom:60px}.list h1{margin-bottom:8px}.lede{color:#5c5852;margin:0 0 36px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px}
.card{background:#fff;border:1px solid rgba(65,127,142,.28);border-radius:18px;overflow:hidden;text-decoration:none;display:flex;flex-direction:column}.card img{width:100%;height:auto;aspect-ratio:1200/627;object-fit:cover;display:block}.card div{padding:20px 24px 24px}.card h2{margin:4px 0 8px;font-size:22px;line-height:1.3}.card time{color:#417f8e;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.06em}.card p{margin:0;color:#5c5852;font-size:16px;line-height:1.55}
@media(max-width:760px){nav a:not(.nb){display:none}h1{font-size:34px}.cta{padding:28px 22px}.wrap{padding:0 20px}}`;
const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">`;
const HEADER = `<header><div class="wrap hd"><a href="/"><img src="/croohq-wordmark.png" alt="CrooHQ" class="logo" width="136" height="32"></a><a class="sep" href="/blog/">Blog</a><nav><a href="/">Product</a><a href="/blog/">Operator notes</a><a class="nb" href="${DEMO}">Book a demo</a></nav></div></header>`;
const FOOTER = `<footer><div class="wrap">© ${new Date().getFullYear()} CrooHQ · Your crew's HQ · <a href="/">Visit croohq.com</a> · <a href="/blog/">All posts</a></div></footer>`;
const head = (o) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.desc)}"><link rel="canonical" href="${o.url}"><link rel="icon" href="/favicon.png">
<meta property="og:type" content="${o.type}"><meta property="og:site_name" content="CrooHQ"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.desc)}"><meta property="og:url" content="${o.url}"><meta property="og:image" content="${o.img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="627">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(o.title)}"><meta name="twitter:description" content="${esc(o.desc)}"><meta name="twitter:image" content="${o.img}">
${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g,"\\u003c")}</script>` : ""}
${FONT}<style>${CSS}</style></head><body>`;
fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(A,{recursive:true});
fs.copyFileSync(path.join(SRC,"jordan-avatar.png"), path.join(A,"jordan-avatar.png"));
const posts = fs.readdirSync(path.join(SRC,"posts")).filter(f=>f.endsWith(".md")).map(f => {
  const [, fm, body] = fs.readFileSync(path.join(SRC,"posts",f),"utf8").split(/^---\n/m);
  const m = Object.fromEntries([...fm.matchAll(/^(\w+):\s*"?(.*?)"?\s*$/gm)].map(x=>[x[1],x[2]]));
  m.date = String(m.date); for (const k of ["title","seo_title","meta_description","slug","date","hero"]) if (!m[k]) throw new Error(`${f}: missing ${k}`);
  return { ...m, body }; }).sort((a,b)=>b.date.localeCompare(a.date));
for (const p of posts) {
  for (const s of ["1600x900","1200x627"]) fs.copyFileSync(path.join(SRC,"heroes",`${p.hero}-${s}.png`), path.join(A,`${p.slug}-${s}.png`));
  const parts = p.body.trim().split(/\n\s*\n/), cta = parts.slice(-2), main = parts.slice(0,-2).join("\n\n");
  p.excerpt = p.excerpt || p.meta_description;
  const url = `${SITE}/blog/${p.slug}/`, img = `${SITE}/blog/assets/${p.slug}-1200x627.png`, alt = p.hero_alt || p.title;
  const ctah = cta.map((c,i)=>`<a class="btn${i?" alt":""}" href="${esc(c.match(/\]\(([^)]+)\)/)[1])}">${esc(c.replace(/\*\*|\[|\]|\([^)]*\)/g,"").trim())}</a>`).join("");
  const ld = {"@context":"https://schema.org","@type":"Article",headline:p.title,description:p.meta_description,image:[img],datePublished:p.date,dateModified:p.updated||p.date,
    author:{"@type":"Person",name:"Jordan Andrian",jobTitle:"Founder, CrooHQ",url:SITE},publisher:{"@type":"Organization",name:"CrooHQ",url:SITE,logo:{"@type":"ImageObject",url:`${SITE}/croohq-logo.png`}},mainEntityOfPage:url};
  const mins = Math.max(1, Math.round(main.split(/\s+/).length/230));
  const html = head({title:p.seo_title,desc:p.meta_description,url,img,type:"article",ld}) + `${HEADER}
<main class="wrap art"><div class="kicker">CrooHQ Blog · Operator notes</div><h1>${esc(p.title)}</h1>
<div class="by"><img src="/blog/assets/jordan-avatar.png" alt="Jordan Andrian" width="56" height="56"><div><b>Jordan Andrian</b>, Founder, CrooHQ<br><span><time datetime="${p.date}">${fmtDate(p.date)}</time> · ${mins} min read</span></div></div>
<img class="hero" src="/blog/assets/${p.slug}-1600x900.png" alt="${esc(alt)}" width="1600" height="900">
<article>${conv(main)}</article>
<section class="cta"><h3>Run the shift, not the spreadsheet.</h3><p>Your crew's HQ, built for operators, by operators.</p><div class="btns">${ctah}</div><div class="by sm"><img src="/blog/assets/jordan-avatar.png" alt="Jordan Andrian" width="44" height="44"><div><b>Jordan Andrian</b>, Founder, CrooHQ<br><span>${BIO}</span></div></div></section></main>
${FOOTER}</body></html>\n`;
  fs.mkdirSync(path.join(OUT,p.slug),{recursive:true}); fs.writeFileSync(path.join(OUT,p.slug,"index.html"),html); console.log("post", p.slug, p.date); }
const cards = posts.map(p=>`<a class="card" href="/blog/${p.slug}/"><img src="/blog/assets/${p.slug}-1200x627.png" alt="${esc(p.hero_alt||p.title)}" width="1200" height="627" loading="lazy"><div><time datetime="${p.date}">${fmtDate(p.date)}</time><h2>${esc(p.title)}</h2><p>${esc(p.excerpt)}</p></div></a>`).join("\n");
const desc = "Operator notes from CrooHQ founder Jordan Andrian on restaurant scheduling, time punches, labor, and running a calmer shift.";
fs.writeFileSync(path.join(OUT,"index.html"), head({title:"CrooHQ Blog: Operator Notes on Running Restaurant Shifts",desc,url:`${SITE}/blog/`,img:`${SITE}/blog/assets/${posts[0].slug}-1200x627.png`,type:"website",
  ld:{"@context":"https://schema.org","@type":"Blog",name:"CrooHQ Blog",url:`${SITE}/blog/`,blogPost:posts.map(p=>({"@type":"BlogPosting",headline:p.title,url:`${SITE}/blog/${p.slug}/`,datePublished:p.date,author:{"@type":"Person",name:"Jordan Andrian"}}))}})
  + `${HEADER}<main class="wrap list"><div class="kicker">CrooHQ Blog · Operator notes</div><h1>Operator notes</h1><p class="lede">Straight talk on schedules, punches, and labor from someone who ran four restaurant locations. <a href="/">See what CrooHQ does</a>.</p><div class="cards">${cards}</div></main>${FOOTER}</body></html>\n`);
// blog sitemap (referenced from public/sitemap.xml index)
fs.writeFileSync(path.join(ROOT,"public/blog-sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/blog/</loc><lastmod>${posts[0].date}</lastmod></url>\n${posts.map(p=>`  <url><loc>${SITE}/blog/${p.slug}/</loc><lastmod>${p.updated||p.date}</lastmod></url>`).join("\n")}\n</urlset>\n`);
console.log(`listing: ${posts.length} posts`);
