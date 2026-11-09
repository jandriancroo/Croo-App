import { lazy, Suspense, useLayoutEffect, useRef, type CSSProperties } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import LatestPosts from "@/components/home/LatestPosts";
import { HeroStage, PRODUCT_CSS, ProductSequence } from "@/components/home/ProductMocks";

const HomeDemos = lazy(() => import('@/components/home/HomeDemos'));

const MAILTO = "mailto:jordan@croohq.com";
const DEMO_REQUEST = "https://supaclose.lovable.app/demo";
const CSS = `.hme *{box-sizing:border-box;margin:0;padding:0}.hme a{color:inherit;text-decoration:none}.hme{--paper:#f3eee6;--ink:#1a1a1a;--muted:#5c5852;--teal:#417f8e;--teal-d:#2e6270;--white:#fffcf7;--line:rgba(26,26,26,.12);--orange:#eb7d3c}.hme{background:var(--paper);color:var(--ink);font-family:Manrope,sans-serif;font-weight:500;line-height:1.45;-webkit-font-smoothing:antialiased}.hme .serif{font-family:Fraunces,Georgia,serif;letter-spacing:0;font-weight:500}.hme .wrap{width:min(1200px,calc(100% - 40px));margin:0 auto}.hme .btn{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:12px 20px;font-weight:700;font-size:14px;border:1.5px solid transparent;white-space:nowrap}.hme .bp{background:var(--teal);color:var(--home-tone-1)}.hme .bo{background:var(--orange);color:var(--home-tone-1)}.hme .bg{border-color:var(--line)}.hme .lg{padding:16px 26px;font-size:16px}.hme .eyebrow{color:var(--teal);font-weight:800;font-size:12px;letter-spacing:.12em;text-transform:uppercase}.hme .chip{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:700;color:var(--muted);background:var(--white);margin:0 6px 8px 0}.hme .quote{font-family:Fraunces,Georgia,serif;font-style:italic}.hme .by{display:flex;align-items:center;gap:12px}.hme .by img.ph{width:48px;height:48px;border-radius:99px;object-fit:cover}.hme .by small{display:block;color:var(--muted);font-size:12px}.hme footer{border-top:1px solid var(--line);padding:28px 0 40px;font-size:14px;color:var(--muted);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.hme footer nav{display:flex;gap:20px;flex-wrap:wrap}.hme .hd{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0}.hme .logo{height:32px}.hme .nv{display:flex;gap:26px;font-size:14px;font-weight:700;color:var(--muted)}.hme .act{display:flex;gap:10px}.hme .tcard{display:block;background:var(--white);border:1px solid var(--home-tone-2);border-radius:20px;padding:26px}.hme .tcard .quote{font-size:19px;line-height:1.4}.hme .tfoot{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:18px;flex-wrap:wrap}.hme .ask{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--teal-d)}.hme .ask img{height:44px}
@media(max-width:760px){.hme .nv{display:none}.hme .act .bo{display:none}.hme .logo{height:26px}.hme footer{flex-direction:column}}.hme{background:var(--home-tone-3)}.hme h1,.hme h2{font-family:Manrope;font-weight:800;letter-spacing:0;line-height:.92}.hme .hero{display:grid;grid-template-columns:1.1fr .9fr;min-height:780px;margin:0 20px;border-radius:36px;overflow:hidden;background:var(--teal);color:var(--home-tone-1)}.hme .hl{padding:70px 64px;display:flex;flex-direction:column;justify-content:space-between}.hme .hl h1{font-size:150px}.hme .hl .s1{font-size:24px;font-weight:700;max-width:24ch;line-height:1.25;margin-top:24px;color:var(--home-tone-4)}.hme .hr{position:relative}.hme .hr img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hme .tag{position:absolute;left:28px;bottom:28px;background:var(--home-tone-3);color:var(--ink);border-radius:18px;padding:16px 20px;font-weight:800}.hme .tag small{display:block;font-weight:600;color:var(--muted)}.hme .wh{background:var(--home-tone-1);color:var(--teal-d)}.hme .fine{font-size:14px;color:var(--home-tone-5);margin-top:12px}.hme .marq{display:flex;gap:44px;padding:34px 0;font-size:34px;font-weight:800;letter-spacing:0;white-space:nowrap;overflow:hidden;color:var(--ink)}.hme .marq span:nth-child(even){color:var(--orange)}.hme .sec{padding:110px 0}.hme h2{font-size:84px}.hme .big{font-size:22px;color:var(--muted);max-width:44ch;margin-top:20px;line-height:1.4}.hme .split{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:56px}.hme .tile{border-radius:30px;padding:44px;min-height:420px;display:flex;flex-direction:column;justify-content:space-between}.hme .t1{background:var(--ink);color:var(--home-tone-3)}.hme .t2{background:var(--orange);color:var(--home-tone-1)}.hme .t1 .quote{font-size:34px;line-height:1.2}.hme .t1 .by small{color:var(--home-tone-6)}.hme .t1 .stamp{height:70px;background:var(--home-tone-3);border-radius:99px;padding:3px}.hme .t2 h3{font-size:56px;letter-spacing:0;line-height:.95;font-weight:800}.hme .t2 .chip{background:var(--home-tone-7);color:var(--home-tone-1);border-color:var(--home-tone-8)}.hme .rows{margin-top:50px;border-top:2px solid var(--ink)}.hme .r{display:grid;grid-template-columns:1fr 60px 1fr;padding:26px 0;border-bottom:1px solid var(--line);font-size:26px;font-weight:700;letter-spacing:0;align-items:center}.hme .r s{color:var(--home-tone-9)}.hme .r i{font-style:normal;color:var(--orange)}.hme .r b{color:var(--teal-d)}.hme .price{display:grid;grid-template-columns:1fr auto;align-items:center;margin-top:40px;background:var(--home-tone-10);border-radius:30px;padding:44px}.hme .price .n{font-size:140px;font-weight:800;letter-spacing:0;line-height:.9}.hme .price .n small{font-size:28px;letter-spacing:0;color:var(--muted)}.hme .how{background:var(--ink);color:var(--home-tone-3);margin:0 20px;border-radius:36px;padding:100px 0}.hme .how h2{color:var(--home-tone-1)}.hme .st{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:56px}.hme .st div{background:var(--home-tone-11);border-radius:24px;padding:28px;font-size:18px;min-height:220px;display:flex;flex-direction:column;justify-content:space-between}.hme .st b{font-size:64px;letter-spacing:0;color:var(--orange);line-height:1}.hme .how .chip{background:transparent;color:var(--home-tone-12);border-color:var(--home-tone-13)}.hme .end{padding:130px 0;text-align:center}.hme .end h2{font-size:110px}.hme .end p{font-size:22px;color:var(--muted);margin:20px auto 34px;max-width:40ch}.hme .jb{display:flex;justify-content:space-between;align-items:center;background:var(--home-tone-14);border-radius:24px;padding:26px 32px;font-size:18px;font-weight:700;gap:16px;flex-wrap:wrap}
@media(max-width:760px){.hme .hero{grid-template-columns:1fr;margin:0 10px;border-radius:24px;min-height:0}.hme .hl{padding:36px 24px}.hme .hl h1{font-size:66px}.hme .hl .s1{font-size:18px}.hme .hr{height:300px}.hme .marq{font-size:22px;gap:24px}.hme .sec{padding:64px 0}.hme h2{font-size:44px}.hme .split,.hme .st{grid-template-columns:1fr}.hme .tile{padding:28px;min-height:0;gap:24px}.hme .t1 .quote{font-size:24px}.hme .t2 h3{font-size:36px}.hme .r{font-size:17px;grid-template-columns:1fr 30px 1fr}.hme .price{grid-template-columns:1fr;padding:28px;gap:20px}.hme .price .n{font-size:84px}.hme .how{margin:0 10px;padding:60px 0}.hme .st div{min-height:0;gap:14px}.hme .st b{font-size:44px}.hme .end h2{font-size:54px}.hme .end{padding:70px 0}}.hme .rv{opacity:0;transform:translateY(40px);transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1);transition-delay:var(--d,0s)}.hme .rv.in{opacity:1;transform:none}.hme .tile.rv{transform:translateY(60px) rotate(-2deg) scale(.96)}.hme .tile.rv:nth-child(2){transform:translateY(60px) rotate(2deg) scale(.96)}.hme .tile.rv.in{transform:none;box-shadow:0 30px 60px var(--home-tone-15)}.hme .tile{transition:transform .5s,box-shadow .5s}.hme .tile.in:hover{transform:translateY(-6px) rotate(-.5deg)}.hme .w{display:inline-block;opacity:0;transform:translateY(.5em) rotate(4deg);animation:hme-wd .9s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:calc(var(--i)*.12s + .15s)}
@keyframes hme-wd{to{opacity:1;transform:none}}.hme .marq{overflow:hidden}.hme .track{display:flex;gap:44px;width:max-content;animation:hme-mq 28s linear infinite}.hme .marq:hover .track{animation-play-state:paused}
@keyframes hme-mq{to{transform:translateX(-50%)}}.hme .how{position:relative}.hme .pin{position:sticky;top:0;min-height:100vh;display:flex;align-items:center;padding:60px 0}.hme .st div{transition:transform .5s,background .5s,opacity .5s;opacity:.35;transform:translateY(16px)}.hme .st div.on{opacity:1;transform:none;background:var(--home-tone-16)}.hme .st div.on b{text-shadow:0 0 30px var(--home-tone-17)}.hme .prog{height:4px;background:var(--home-tone-18);border-radius:4px;margin-top:30px;overflow:hidden}.hme .prog i{display:block;height:100%;width:0;background:var(--orange)}
@media(max-width:760px){.hme .pin{position:static;min-height:0}.hme .st div{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.hme .rv,.hme .tile.rv,.hme .w{opacity:1!important;transform:none!important;animation:none!important;transition:none!important}.hme .track{animation:none}.hme .hr img{transform:none!important}.hme .st div{opacity:1;transform:none}}.hme .hr{overflow:hidden;background:radial-gradient(120% 90% at 70% 30%,var(--home-tone-19) 0%,var(--home-tone-20) 55%,var(--home-tone-21) 100%)}.hme .hr::before{content:"";position:absolute;inset:0;background-image:radial-gradient(var(--home-tone-22) 1.2px,transparent 1.3px);background-size:22px 22px}.hme .stage{position:absolute;left:50%;top:50%;width:560px;height:660px;margin:-330px 0 0 -280px;transform:scale(var(--s,1));perspective:1400px}.hme .L{position:absolute;transform:translate3d(0,calc(var(--py,0)*1px),calc(var(--z,0)*110px)) rotate(calc(var(--r,0deg) + var(--py,0)*-.012deg));will-change:transform}.hme .L>.in{animation:hme-pop 1.15s cubic-bezier(.16,.84,.24,1) both;animation-delay:var(--d,.2s)}
@keyframes hme-pop{from{opacity:0;transform:translate3d(0,84px,0) scale(.94)}to{opacity:1;transform:none}}.hme .card{background:var(--home-tone-23);color:var(--home-tone-24);border-radius:22px;box-shadow:0 2px 0 var(--home-tone-25) inset,0 30px 60px -20px var(--home-tone-26),0 10px 24px -10px var(--home-tone-27)}.hme .pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;font-weight:800;font-size:12px;padding:6px 11px}.hme .ser{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:0}.hme .av{width:26px;height:26px;border-radius:99px;display:inline-grid;place-items:center;font-size:10px;font-weight:800;color:var(--home-tone-1);flex:none}.hme .ck{width:26px;height:26px;border-radius:99px;background:var(--home-tone-20);display:grid;place-items:center;flex:none}.hme .ck svg{width:14px;height:14px}.hme .ck.o{background:none;border:2px dashed var(--home-tone-28)}.hme .draw path{stroke-dasharray:30;stroke-dashoffset:30;animation:hme-dr .5s ease forwards;animation-delay:var(--cd,1s)}
@keyframes hme-dr{to{stroke-dashoffset:0}}.hme .tag{z-index:5}
@media(max-width:760px){.hme .hr{height:460px}}
@media(prefers-reduced-motion:reduce){.hme .L>.in,.hme .L>.in>.fl,.hme .draw path,.hme .grow,.hme .ringp{animation:none!important;stroke-dashoffset:0!important}}

.hme{--step-line:#333;min-height:100vh;--page:#fbf8f3;--light:#fff;--hero-sub:#e6f2f4;--hero-fine:#d4e8ec;background:var(--page)}
.hme *{box-sizing:border-box;margin:0;padding:0}.hme a{color:inherit;text-decoration:none}.hme h1,.hme h2,.hme h3{letter-spacing:0}
.hme .hero{min-height:min(780px,calc(100svh - 108px));grid-template-columns:1.1fr .9fr}
.hme .hl{padding:70px 64px;gap:24px;min-width:0}.hme .hl h1{font-size:150px;max-width:5ch}.hme .hl .s1{color:var(--hero-sub)}
.hme .btn.bp{color:var(--light)}.hme .btn.bo{color:var(--light)}.hme .btn.wh{color:var(--teal-d)}.hme .btn:focus-visible,.hme a:focus-visible{outline:3px solid var(--orange);outline-offset:5px}.hme .btn:hover{filter:brightness(.95)}
.hme .why-sec{padding-top:60px}.hme #stack{padding-top:0}.hme .tile{gap:30px;min-width:0}.hme .t2 .eyebrow{color:var(--light);margin-bottom:16px}.hme .t2 .pos-copy{font-size:18px;margin-bottom:16px}.hme .testimonial-foot{display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between}.hme .by{min-width:0}.hme .ask{color:inherit;flex-wrap:wrap}.hme .ask img{height:60px;max-width:100%;object-fit:contain;background:var(--page);border-radius:99px;padding:3px}
.hme .price-label{font-weight:800;color:var(--muted)}.hme .price-note{color:var(--muted);margin-top:10px}.hme .price-fine{font-size:13px;color:var(--muted);margin-top:10px}.hme .feature-chips{margin-top:36px}.hme .jb span{flex:1;min-width:0}.hme footer{margin-top:28px}.hme .marq-group{display:flex;gap:44px;padding-right:44px}.hme .track{gap:0}.hme .marq-group span:nth-child(even){color:var(--orange)}
.hme .w:nth-child(1){--i:0}.hme .w:nth-child(2){--i:1}.hme .w:nth-child(3){--i:2}
.hme .how{position:relative}.hme .how.is-animated{height:260vh}.hme .how .pin{min-height:100svh}.hme .prog{height:4px;background:var(--step-line);border-radius:4px;margin-top:30px;overflow:hidden}.hme .prog i{display:block;height:100%;width:0;background:var(--orange)}
.hme .rv{opacity:1;transform:none}.hme.motion-ready .rv:not(.in){opacity:var(--p,0);transform:translateY(calc((1 - var(--p,0))*72px));transition:none}.hme.motion-ready .tile.rv:not(.in){transform:translateY(calc((1 - var(--p,0))*84px)) rotate(calc((1 - var(--p,0))*-1.8deg)) scale(calc(.96 + var(--p,0)*.04))}.hme.motion-ready .tile.rv:nth-child(2):not(.in){transform:translateY(calc((1 - var(--p,0))*84px)) rotate(calc((1 - var(--p,0))*1.8deg)) scale(calc(.96 + var(--p,0)*.04))}
@keyframes hme-rg{from{stroke-dashoffset:314}to{stroke-dashoffset:52}}
@media(min-width:761px) and (max-width:1400px){.hme .hl{padding:70px 64px}.hme .hl h1{font-size:140px}.hme .hl .s1{font-size:24px}.hme .hero .btn.lg{padding:16px 24px;font-size:16px}.hme .hl{padding-right:24px}.hme .t2 h3{font-size:48px}}
@media(min-width:761px) and (max-width:1100px){.hme .hl{padding:48px 32px}.hme .hl h1{font-size:110px}.hme .hl .s1{font-size:21px}.hme h2{font-size:68px}.hme .nv{gap:16px}.hme .tile{padding:32px}.hme .t1 .quote{font-size:28px}.hme .t2 h3{font-size:40px}.hme .st{grid-template-columns:repeat(2,1fr)}.hme .price{padding:32px}.hme .price .n{font-size:110px}}
@media(max-width:760px){.hme .hero{min-height:0;grid-template-columns:1fr;margin:0 10px;border-radius:24px}.hme .hl{padding:36px 24px;gap:28px}.hme .hl h1{font-size:66px;max-width:6ch}.hme .hl .s1{font-size:18px}.hme .hero .btn.lg{font-size:14px;padding:14px 18px;white-space:normal}.hme .hr{height:460px}.hme .act{gap:6px}.hme .act .btn{padding:10px 12px;font-size:12px}.hme .act .bo{display:inline-flex}.hme .logo{width:auto;max-width:105px}.hme .hd{gap:8px}.hme .marq-group{gap:24px;padding-right:24px}.hme .why-sec{padding-top:36px}.hme .price .n small{font-size:24px}.hme .how.is-animated{height:auto}.hme .how .pin{position:static;min-height:0;padding:0}.hme .st div{opacity:1;transform:none}.hme .st{margin-top:32px}.hme .t2 h3{font-size:36px}.hme .jb{padding:24px}.hme footer nav{gap:16px}.hme .chip{white-space:normal}.hme .end h2{font-size:54px}}
@media(max-width:360px){.hme .hl h1{font-size:58px}.hme .hd{flex-wrap:wrap}.hme .act{width:100%;justify-content:space-between}.hme .act .btn{padding:9px;font-size:11px}.hme .logo{max-width:90px}.hme .price .n{font-size:70px}.hme .price .n small{display:block;margin-top:8px}.hme .price .btn{white-space:normal}}
.hme .lgc{display:flex;flex-direction:column;align-items:flex-start;flex-shrink:0}.hme .nvm{display:none}@media(max-width:760px){.hme .nvm{display:block;font-size:13px;font-weight:700;color:var(--muted);line-height:1;padding:5px 8px 2px 0}}
@media(prefers-reduced-motion:reduce){.hme.motion-ready .rv,.hme.motion-ready .tile.rv,.hme .w{opacity:1!important;transform:none!important;transition:none!important;animation:none!important}.hme .L{transform:rotate(var(--r,0deg))!important;will-change:auto}.hme .L>.in,.hme .draw path,.hme .ringp,.hme .track{animation:none!important}.hme .draw path{stroke-dashoffset:0!important}.hme .ringp{stroke-dashoffset:52!important}.hme .how.is-animated{height:auto}.hme .how .pin{position:static;min-height:0}.hme .st div{opacity:1;transform:none}.hme .tile.in:hover{transform:none}.hme .prog i{width:100%!important}}

.hme{--art-1:#e4eff1;--art-2:#2e6270;--art-3:rgba(26,26,26,.08);--art-4:#fff;--art-5:#eb7d3c;--art-6:#8a847b;--art-7:#417f8e;--art-8:#8a6fb5;--art-9:#fde9dc;--art-10:#c25e22;--art-11:#e8e1d6;--art-12:#1a1a1a;--art-13:#efd9c6;--art-14:#dcbfa5;--art-15:#fffcf7;--art-16:#b48c6c;--art-17:#f6c27e;--art-18:rgba(26,26,26,.7);--art-19:#cfe3e7;--art-20:#e9f4f6;--art-21:#9cc3cc;}

.hme .cta-row{display:flex;gap:10px;flex-wrap:wrap}

.hme{--home-tone-1:#fff;--home-tone-2:rgba(65,127,142,.28);--home-tone-3:#fbf8f3;--home-tone-4:#e6f2f4;--home-tone-5:#d4e8ec;--home-tone-6:#bdb7ae;--home-tone-7:rgba(255,255,255,.18);--home-tone-8:rgba(255,255,255,.35);--home-tone-9:#a8a39b;--home-tone-10:#efe8dd;--home-tone-11:#242424;--home-tone-12:#d8d3cb;--home-tone-13:#444;--home-tone-14:#e4eff1;--home-tone-15:rgba(0,0,0,.12);--home-tone-16:#2d2d2d;--home-tone-17:rgba(235,125,60,.5);--home-tone-18:#333;--home-tone-19:#4f93a3;--home-tone-20:#417f8e;--home-tone-21:#356c79;--home-tone-22:rgba(255,255,255,.10);--home-tone-23:#fffcf7;--home-tone-24:#1a1a1a;--home-tone-25:rgba(255,255,255,.6);--home-tone-26:rgba(10,40,48,.55);--home-tone-27:rgba(10,40,48,.35);--home-tone-28:#c9c1b5;}

.hme .tile:nth-child(2){--d:.15s}
${PRODUCT_CSS}`;

const STACK_ROWS: [string, string][] = [
  ["Scheduling software", "Scheduling"],
  ["Checklist / audit app", "Checklists, tasks, manager logs"],
  ["Hiring software", "Hiring"],
  ["Inventory and labor tools", "Inventory, labor, USAGE"],
  ["Punch clock, paper, group text", "Punch clock, time, team chat, recipes"],
];

const STEPS = [
  "Checklists and recipes in one store.",
  "Punch clock, cash, inventory in a workshop. Weeks, not a self-serve login.",
  "Scheduling and labor once the team is actually using it.",
  "Expand when the first rollout is real.",
];

const CHIPS = [
  "Checklists, recipes, manager logs",
  "Scheduling and labor %",
  "Punch clock (PIN, tablet, PWA)",
  "Team chat",
  "Hiring / jobs board",
  "Sales / labor dashboard",
  "Inventory and COGS",
];

const FEATURES = ["Punch clock", "Checklists", "Scheduling", "Team chat", "Hiring", "Inventory", "Dashboard", "POS sync"];

const STACK_CSS = `
.hme .stack-map{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,320px);gap:88px;align-items:center;margin-top:56px}
.hme .stack-old{list-style:none;display:flex;flex-direction:column;gap:22px}
.hme .stack-old li{min-height:52px;display:flex;align-items:center;font-size:26px;font-weight:700;line-height:1.25}
.hme .stack-old s{position:relative;text-decoration:none;color:var(--ink);transition:color .45s cubic-bezier(.16,.84,.24,1)}
.hme .stack-old s::after{content:"";position:absolute;left:0;right:0;top:50%;height:2px;background:#6f6a63;transform:scaleX(0);transform-origin:left center;transition:transform .45s cubic-bezier(.16,.84,.24,1)}
.hme .stack-down{display:none}
.hme .stack-old li.is-struck s{color:var(--home-tone-9);text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:#6f6a63}
.hme .stack-old li.is-struck s::after{transform:scaleX(1)}
.hme .stack-arrows{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.hme .stack-arrows path{fill:none;stroke:var(--orange);stroke-width:2.5;stroke-linecap:round}
.hme .stack-solution{position:relative;z-index:1}
.hme .stack-kicker{margin:0 0 12px;text-align:center;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--teal)}
.hme .stack-phone{opacity:.42;filter:saturate(.2);transition:opacity .6s cubic-bezier(.16,.84,.24,1),filter .6s cubic-bezier(.16,.84,.24,1)}
.hme .stack-map.is-lit .stack-phone{opacity:1;filter:none}
.hme .stack-mods{list-style:none;display:flex;flex-direction:column;gap:8px;padding:14px 12px 6px}
.hme .stack-mod{border-radius:12px;padding:10px 12px;font-size:14px;font-weight:800;line-height:1.3;color:var(--teal-d);background:transparent;border:1px solid transparent;opacity:.4;transition:opacity .45s cubic-bezier(.16,.84,.24,1),background .45s cubic-bezier(.16,.84,.24,1),border-color .45s cubic-bezier(.16,.84,.24,1)}
.hme .stack-map.is-lit .stack-mod{opacity:1;background:var(--art-1);border-color:var(--art-3)}
@media(max-width:760px){
  .hme .stack-map{grid-template-columns:1fr;gap:36px;margin-top:28px}
  .hme .stack-old li{font-size:17px;min-height:44px}
  .hme .stack-solution{width:min(100%,320px);justify-self:center}
  .hme .stack-mod{font-size:13px}
  .hme .stack-arrows{display:none}
  .hme .stack-old li{flex-direction:column;align-items:flex-start;gap:0}
  .hme .stack-down{display:block;position:relative;width:2px;height:0;margin:8px 0 2px 18px;background:var(--orange);transition:height .4s cubic-bezier(.16,.84,.24,1)}
  .hme .stack-down::before{content:"";position:absolute;left:-4px;bottom:-1px;border:5px solid transparent;border-top:6px solid var(--orange);border-bottom:0;opacity:0}
  .hme .stack-old li.is-struck .stack-down{height:18px}
  .hme .stack-old li.is-struck .stack-down::before{opacity:1}
}
@media(prefers-reduced-motion:reduce){
  .hme .stack-old s,.hme .stack-old s::after,.hme .stack-phone,.hme .stack-mod{transition:none!important}
  .hme .stack-old s{color:var(--home-tone-9);text-decoration:line-through;text-decoration-thickness:2px}
  .hme .stack-old s::after{transform:scaleX(1)}
  .hme .stack-down{height:18px;transition:none}
  .hme .stack-down::before{opacity:1}
  .hme .stack-phone,.hme .stack-mod{opacity:1;filter:none}
  .hme .stack-mod{background:var(--art-1);border-color:var(--art-3)}
}
`;

function StackMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leftRefs = useRef<(HTMLLIElement | null)[]>([]);
  const rightRefs = useRef<(HTMLLIElement | null)[]>([]);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const heads = useRef<(SVGPolygonElement | null)[]>([]);
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    let frame = 0;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const lengthOf = (path: SVGPathElement) => {
      try { return typeof path.getTotalLength === "function" ? path.getTotalLength() : 0; }
      catch { return 0; }
    };
    const layout = () => {
      const box = map.getBoundingClientRect();
      const mobile = mobileQuery.matches;
      paths.current.forEach((path, index) => {
        const from = leftRefs.current[index];
        const to = rightRefs.current[index];
        const head = heads.current[index];
        if (!path || !from || !to) return;
        const start = from.getBoundingClientRect();
        const end = to.getBoundingClientRect();
        const x1 = (mobile ? start.left + start.width / 2 : start.right) - box.left;
        const y1 = (mobile ? start.bottom : start.top + start.height / 2) - box.top;
        const x2 = (mobile ? end.left + end.width / 2 : end.left) - box.left;
        const y2 = (mobile ? end.top : end.top + end.height / 2) - box.top;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        path.setAttribute("d", mobile
          ? `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        const len = lengthOf(path);
        path.style.strokeDasharray = `${len}`;
        path.dataset.len = String(len);
        if (head) {
          const angle = Math.atan2(y2 - (mobile ? midY : y2), x2 - (mobile ? x2 : midX));
          const size = 7;
          const tipX = x2;
          const tipY = y2;
          const p1x = tipX - Math.cos(angle) * size - Math.sin(angle) * size * 0.7;
          const p1y = tipY - Math.sin(angle) * size + Math.cos(angle) * size * 0.7;
          const p2x = tipX - Math.cos(angle) * size + Math.sin(angle) * size * 0.7;
          const p2y = tipY - Math.sin(angle) * size - Math.cos(angle) * size * 0.7;
          head.setAttribute("points", `${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`);
        }
      });
    };
    const paint = () => {
      const reduced = media.matches;
      const rect = map.getBoundingClientRect();
      const raw = clamp((window.innerHeight * 0.9 - rect.top) / (window.innerHeight * 0.4), 0, 1);
      const progress = reduced ? 1 : raw;
      const steps = STACK_ROWS.length;
      leftRefs.current.forEach((item, index) => item?.classList.toggle("is-struck", progress >= index / (steps + 1)));
      paths.current.forEach((path, index) => {
        if (!path) return;
        const len = Number(path.dataset.len || 0);
        const start = index / (steps + 1);
        const span = 1 / (steps + 1);
        const t = reduced ? 1 : clamp((progress - start) / span, 0, 1);
        const eased = t * t * (3 - 2 * t);
        path.style.strokeDashoffset = String(len * (1 - eased));
        const head = heads.current[index];
        if (head) head.style.opacity = String(eased > 0.82 ? clamp((eased - 0.82) / 0.18, 0, 1) : 0);
      });
      map.classList.toggle("is-lit", progress >= (steps - 0.2) / (steps + 1));
    };
    const update = () => { frame = 0; layout(); paint(); };
    const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    media.addEventListener("change", queue);
    mobileQuery.addEventListener("change", queue);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      media.removeEventListener("change", queue);
      mobileQuery.removeEventListener("change", queue);
    };
  }, []);
  return (
    <div className="stack-map" ref={mapRef}>
      <ul className="stack-old">
        {STACK_ROWS.map(([before], index) => (
          <li key={before} ref={node => { leftRefs.current[index] = node; }}><s>{before}</s><span className="stack-down" aria-hidden="true" /></li>
        ))}
      </ul>
      <svg className="stack-arrows" aria-hidden="true">
        {STACK_ROWS.map(([before], index) => (
          <g key={before}>
            <path ref={node => { paths.current[index] = node; }} d="M0 0" />
            <polygon ref={node => { heads.current[index] = node; }} points="0,0 0,0 0,0" fill="var(--orange)" />
          </g>
        ))}
      </svg>
      <div className="stack-solution">
        <p className="stack-kicker">One solution</p>
        <div className="pm-device stack-phone">
          <div className="pm-hardware">
            <div className="pm-bar"><span className="pm-cam" /><span>CrooHQ</span></div>
            <ul className="stack-mods">
              {STACK_ROWS.map(([, after], index) => (
                <li key={after} className="stack-mod" ref={node => { rightRefs.current[index] = node; }}>{after}</li>
              ))}
            </ul>
            <div className="pm-home" />
          </div>
        </div>
      </div>
    </div>
  );
}

const Home = () => {

  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileQuery = window.matchMedia('(max-width:760px)');
    const narrowQuery = window.matchMedia('(max-width:1100px)');
    const heroArt = root.querySelector<HTMLElement>('.hr');
    const stage = root.querySelector<HTMLElement>('.stage');
    const how = root.querySelector<HTMLElement>('.how');
    const layers = Array.from(root.querySelectorAll<HTMLElement>('.L'));
    const steps = Array.from(root.querySelectorAll<HTMLElement>('.st > div'));
    const screens = Array.from(root.querySelectorAll<HTMLElement>('.pm-step'));
    const labels = Array.from(root.querySelectorAll<HTMLElement>('.pm-label'));
    const bar = root.querySelector<HTMLElement>('.prog i');
    let reveals = Array.from(root.querySelectorAll<HTMLElement>('.rv')).filter(el => !el.closest('.hd-root'));
    let frame = 0;
    let intro = 0;
    let primed = false;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const ease = (value: number) => 1 - Math.pow(1 - value, 3);
    let fittedW = -1;
    let fittedH = -1;
    const fit = () => {
      if (!heroArt || !stage) return;
      const width = heroArt.clientWidth;
      const height = heroArt.clientHeight;
      if (!width || !height) return;
      const pad = 14;
      const saved = layers.map(layer => layer.style.getPropertyValue('--py'));
      const inners = layers.map(layer => layer.querySelector<HTMLElement>(':scope > .in'));
      stage.style.setProperty('--s', '1');
      layers.forEach(layer => layer.style.setProperty('--py', '0'));
      inners.forEach(inner => { if (inner) inner.style.animation = 'none'; });
      const stageRect = stage.getBoundingClientRect();
      const centerX = stageRect.left + stageRect.width / 2;
      const centerY = stageRect.top + stageRect.height / 2;
      let halfW = stageRect.width / 2;
      let halfH = stageRect.height / 2;
      layers.forEach(layer => {
        const rect = layer.getBoundingClientRect();
        const depth = Number(layer.dataset.z || 0);
        const shift = height * depth * 0.55;
        halfW = Math.max(halfW, centerX - rect.left, rect.right - centerX);
        halfH = Math.max(halfH, centerY - (rect.top - shift), rect.bottom - centerY);
      });
      const scale = Math.min((width - pad * 2) / (halfW * 2), (height - pad * 2) / (halfH * 2), 1.05);
      stage.style.setProperty('--s', String(Math.max(0.3, Number.isFinite(scale) ? scale : 1)));
      layers.forEach((layer, index) => {
        if (saved[index]) layer.style.setProperty('--py', saved[index]);
        else layer.style.removeProperty('--py');
      });
      inners.forEach(inner => { if (inner) inner.style.animation = ''; });
      fittedW = width;
      fittedH = height;
    };
    const update = () => {
      frame = 0;
      if (heroArt && (heroArt.clientWidth !== fittedW || heroArt.clientHeight !== fittedH)) fit();
      const reduced = media.matches;
      const mobile = mobileQuery.matches;
      const narrow = narrowQuery.matches;
      how?.classList.toggle('is-animated', !narrow && !reduced);
      if (!reduced && heroArt) {
        const rect = heroArt.getBoundingClientRect();
        const span = Math.max(rect.height, 1);
        const travel = clamp(-rect.top / span, 0, 1);
        const eased = travel * travel * (3 - 2 * travel);
        layers.forEach(layer => {
          const depth = Number(layer.dataset.z || 0);
          layer.style.setProperty('--z', String(depth));
          layer.style.setProperty('--py', (-eased * span * depth * 0.55).toFixed(2));
        });
      } else layers.forEach(layer => { layer.style.removeProperty('--py'); layer.style.removeProperty('--z'); });
      if (how) {
        const rect = how.getBoundingClientRect();
        const progress = reduced ? 1 : (mobile || narrow) ? clamp((window.innerHeight - rect.top) / Math.max(rect.height, 1), 0, 1) : clamp(-rect.top / Math.max(1, rect.height - window.innerHeight), 0, 1);
        if (bar) bar.style.width = `${progress * 100}%`;
        steps.forEach((step, i) => step.classList.toggle('on', reduced || mobile || progress >= i / steps.length - .001));
        const stageBox = root.querySelector<HTMLElement>('.pm-stage');
        const screenProgress = (mobile || narrow) && stageBox
          ? clamp((window.innerHeight * 0.25 - stageBox.getBoundingClientRect().top) / (window.innerHeight * 0.48), 0, 1)
          : progress;
        const fade = (items: HTMLElement[]) => {
          if (reduced) items.forEach(item => { item.style.opacity = ''; item.style.transform = ''; });
          else if (items.length) {
            const span = clamp(screenProgress / 0.75, 0, 1) * (items.length - 1);
            const current = Math.min(items.length - 1, Math.floor(span + 1e-4));
            const frac = span - current;
            const edge = 0.2;
            items.forEach((item, index) => {
              let shown = 0;
              if (index === current) shown = current === items.length - 1 || frac < 1 - edge ? 1 : (1 - frac) / edge;
              else if (index === current + 1) shown = frac < 1 - edge ? 0 : (frac - (1 - edge)) / edge;
              const eased = Math.min(1, Math.max(0, shown));
              const smooth = eased * eased * (3 - 2 * eased);
              item.style.opacity = smooth.toFixed(3);
              item.style.transform = `translate3d(0, ${((1 - smooth) * 18).toFixed(1)}px, 0)`;
            });
          }
        };
        fade(screens);
        fade(labels);
      }
      if (reduced || !primed) return;
      const viewport = window.innerHeight;
      reveals.forEach(el => {
        if (el.classList.contains('in')) return;
        const rect = el.getBoundingClientRect();
        const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('rv') && !node.closest('.hd-root')) : [el];
        const index = Math.max(0, siblings.indexOf(el));
        const progress = ease(clamp((viewport * 0.96 - rect.top) / (viewport * 0.5) - index * 0.12, 0, 1));
        if (progress >= 0.995) { el.style.setProperty('--p', '1'); el.classList.add('in'); }
        else el.style.setProperty('--p', progress.toFixed(3));
      });
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
    const setup = () => {
      primed = false;
      reveals = Array.from(root.querySelectorAll<HTMLElement>('.rv')).filter(el => !el.closest('.hd-root'));
      root.classList.toggle('motion-ready', !media.matches);
      if (media.matches) reveals.forEach(el => { el.classList.add('in'); el.style.setProperty('--p', '1'); });
      else reveals.forEach(el => { el.classList.remove('in'); el.style.setProperty('--p', '0'); });
      fit();
      update();
      cancelAnimationFrame(intro);
      if (!media.matches) {
        intro = requestAnimationFrame(() => {
          primed = true;
          reveals.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight - 8 && rect.bottom > 24) el.classList.add('in');
          });
          queue();
        });
      } else primed = true;
    };
    document.fonts?.ready.then(() => { fittedW = -1; queue(); });
    setup();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    media.addEventListener('change', setup);
    mobileQuery.addEventListener('change', setup);
    narrowQuery.addEventListener('change', setup);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(intro);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      media.removeEventListener('change', setup);
      mobileQuery.removeEventListener('change', setup);
      narrowQuery.removeEventListener('change', setup);
    };
  }, []);
  return (
    <div className="hme" ref={rootRef}>
      <Helmet>
        <title>CrooHQ — Restaurant Operations Software for Multi-Unit Teams</title>
        <meta
          name="description"
          content="Restaurant operations software for multi-unit QSR and fast-casual teams. Scheduling, time clock, checklists, inventory and hiring, with POS sync."
        />
        <link rel="canonical" href="https://croohq.com/" />
        <meta property="og:title" content="CrooHQ — Restaurant Operations Software for Multi-Unit Teams" />
        <meta
          property="og:description"
          content="Restaurant operations software for multi-unit QSR and fast-casual teams. Scheduling, time clock, checklists, inventory and hiring, with POS sync."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://croohq.com/" />
        <meta property="og:image" content="https://croohq.com/croohq-ipad-punch.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="CrooHQ — Restaurant Operations Software for Multi-Unit Teams" />
        <meta name="twitter:description" content="Restaurant operations software for multi-unit QSR and fast-casual teams. Scheduling, time clock, checklists, inventory and hiring, with POS sync." />
        <meta name="twitter:image" content="https://croohq.com/croohq-ipad-punch.png" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Manrope:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <style type="text/css">{CSS + STACK_CSS}</style>
      </Helmet>
      <div className="wrap"><header className="hd">
        <div className="lgc"><img className="logo" src="/croohq-wordmark.png" alt="CrooHQ" width={136} height={32} /><a className="nvm" href="/blog/">Blog</a></div>
        <nav className="nv" aria-label="Main navigation"><a href="#how">How it works</a><a href="#stack">Replace the stack</a><Link to="/jobs">Jobs</Link><a href="/blog/">Blog</a></nav>
        <div className="act"><Link className="btn bo" to="/auth">App Login</Link><a className="btn bp" href={DEMO_REQUEST}>Book a walkthrough</a></div>
      </header></div>
      <main>
        <section className="hero" aria-label="Your crew’s HQ">
          <div className="hl"><div><h1><span className="w">Your</span>{' '}<span className="w">crew’s</span>{' '}<span className="w">HQ.</span></h1><p className="s1 rv">The all-in-one ops platform for multi-unit fast-casual and QSR restaurants.</p></div>
            <div><div className="cta-row"><a className="btn lg wh rv" href={DEMO_REQUEST}>Book a 20-minute walkthrough</a><a className="btn lg bo rv" href="#stack">Starting at $199/month</a></div><p className="fine">Try it for 14 days for free.</p></div>
          </div>
          <div className="hr" aria-hidden="true"><HeroStage /></div>
        </section>
        <div className="marq rv" aria-label={FEATURES.join(', ')}><div className="track" aria-hidden="true">{[0, 1].map(copy => <div className="marq-group" key={copy}>{FEATURES.map(word => <span key={word}>{word}</span>)}</div>)}</div></div>
        <div className="wrap">
          <section className="sec why-sec" id="why"><h2 className="rv">Operators buy it.<br />The crew runs it.</h2><p className="big rv">Meet them on the floor, on an iPad, not on a desktop. One system instead of the stack.</p>
            <div className="split"><a className="tile t1 rv" href="https://eljefe-enterprises.com" target="_blank" rel="noopener noreferrer"><p className="quote">“I have seen a lot of restaurant software. Some of it is useful. None of it combined ease of use with an operations perspective the way CrooHQ does.”</p><div className="testimonial-foot"><div className="by"><img className="ph" src="/johnny-headshot.jpg" alt="Johnny Tellez" width={48} height={48} loading="lazy" /><div><b>Johnny Tellez</b><small>20+ Year Restaurant Exec · El Jefe Enterprises</small></div></div><p className="ask">Ask me how I can help your business through <img src="/eljefe-stamp.png" alt="El Jefe Enterprises" loading="lazy" /></p></div></a>
              <div className="tile t2 rv"><div><p className="eyebrow">Why CrooHQ</p><h3>Built by a real multi-unit restaurant owner.</h3></div><div><p className="pos-copy">POS sync with Toast, Qu, Aloha, and Clover.</p><span className="chip">Encrypted in transit (HTTPS)</span><span className="chip">Role-based access for owners, managers, and crew</span></div></div>
            </div>
            {/* TODO: add more client logos/testimonials when real assets exist */}
          </section>
          <Suspense fallback={null}><HomeDemos /></Suspense>
          <section className="sec" id="stack"><h2 className="rv">The whole stack out.<br />One system in.</h2><StackMap />
            <div className="price rv"><div><p className="price-label">Starting at</p><div className="n">$199<small>/month.</small></div><p className="price-note">Less than half your current stack. One bill, one system.</p></div><div><a className="btn bp lg" href={DEMO_REQUEST}>Book a walkthrough</a><p className="price-fine">Try it for 14 days for free.</p></div></div>
          </section>
        </div>
        <section className="how" id="how"><div className="pin"><div className="wrap how-grid"><h2 className="rv">No rip-and-replace<br />on day one.</h2><ProductSequence /><div className="how-rest"><div className="st rv">{STEPS.map((step, i) => <div key={step}><b>{String(i + 1).padStart(2, '0')}</b><p>{step}</p></div>)}</div><div className="prog" aria-hidden="true"><i /></div><div className="feature-chips">{CHIPS.map(chip => <span className="chip" key={chip}>{chip}</span>)}</div></div></div></div></section>
        <div className="wrap"><LatestPosts /><section className="end"><h2 className="rv">Not stuck.<br />Not sold to.</h2><p className="rv">If you do not love it, you are not stuck. Talk to an operator, not a sales pod.</p><a className="btn bo lg rv" href={DEMO_REQUEST}>Book a 20-minute walkthrough</a></section><div className="jb rv"><span>Looking for a job? Open crew and manager roles in Southern California.</span><Link className="btn bp" to="/jobs">See open jobs</Link></div></div>
      </main>
      <div className="wrap"><footer><span>croohq.com · Built for operators, by operators. · Proudly made in America.</span><nav aria-label="Footer navigation"><Link to="/jobs">Jobs</Link><a href="/blog/">Blog</a><Link to="/privacy">Privacy Policy</Link><a href={MAILTO}>Contact: jordan@croohq.com</a><Link to="/terms">Terms</Link><Link to="/auth">Log in</Link></nav></footer></div>
    </div>
  );
};

export default Home;
