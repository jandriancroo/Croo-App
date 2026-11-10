/** Public hero loop. Screen 1 is the current hero; screen 2 is Theo's two phones. */
export const LOOP_MS = 31_000;
export const PLATFORM_MS = 15_000;
export const THEO_MS = 16_000;
export const CHAT_MS = 8_000;
export const SALES_LAG_MS = 1_500;

export const THEO_HEADLINE = "Theo, a manager's best friend";

export const SHIFT_ASK = "Hey, can you get this shift covered for me?";
export const SHIFT_REPLY = "On it. I sent the open shift to available crew. Alex picked it up, so you're covered.";
export const SALES_ASK = "Where are sales gonna land by the end of the night?";
export const SALES_REPLY = "You're looking really strong. Keep up the momentum, and make sure we're keeping customer service great.";

const TYPE_MS = 2_400;
const DOTS_MS = 2_200;
const REPLY_MS = 2_800;

export function chatStartMs(which: "shift" | "sales", mobile: boolean) {
  if (which === "shift") return PLATFORM_MS;
  return PLATFORM_MS + (mobile ? CHAT_MS : SALES_LAG_MS);
}

const pct = (ms: number) => ((ms / LOOP_MS) * 100).toFixed(2);

function reveal(name: string, start: number) {
  const typeEnd = start + TYPE_MS;
  const hold = PLATFORM_MS + THEO_MS - 280;
  return `@keyframes ${name}{
  0%, ${pct(start - 120)}% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-top: 0; }
  ${pct(start)}% { max-height: 0; opacity: 1; padding-top: 0; padding-bottom: 0; }
  ${pct(typeEnd)}%, ${pct(hold)}% { max-height: 16em; opacity: 1; padding-top: 8px; padding-bottom: 8px; }
  100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; margin-top: 0; }
}`;
}

function dots(name: string, start: number) {
  const dotsStart = start + TYPE_MS;
  const dotsEnd = dotsStart + DOTS_MS;
  return `@keyframes ${name}{
  0%, ${pct(dotsStart - 80)}% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }
  ${pct(dotsStart)}%, ${pct(dotsEnd)}% { max-height: 36px; opacity: 1; padding-top: 8px; padding-bottom: 8px; }
  ${pct(dotsEnd + 80)}%, 100% { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }
}`;
}

function reply(name: string, start: number) {
  const replyStart = start + TYPE_MS + DOTS_MS;
  const replyEnd = replyStart + REPLY_MS;
  const hold = PLATFORM_MS + THEO_MS - 280;
  return `@keyframes ${name}{
  0%, ${pct(replyStart - 80)}% { max-height: 0; opacity: 0; }
  ${pct(replyStart)}% { max-height: 0; opacity: 1; }
  ${pct(replyEnd)}%, ${pct(hold)}% { max-height: 18em; opacity: 1; }
  100% { max-height: 0; opacity: 0; }
}`;
}

const shiftStart = chatStartMs("shift", false);
const salesStart = chatStartMs("sales", false);
const salesMobileStart = chatStartMs("sales", true);

export const THEO_HERO_CSS = `
.hme .hero-beats{position:relative}
.hme .hero-beat-platform{animation:theo-platform ${LOOP_MS}ms linear infinite}
.hme .hero-beat-theo{position:absolute;left:0;right:0;top:0;opacity:0;margin:0;animation:theo-beat ${LOOP_MS}ms linear infinite}
.hme .hero-theo-title{max-width:9ch;font-size:clamp(48px,5.2vw,84px);line-height:.96;font-weight:800;color:#fff}
.hme .theo-phones{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;perspective:1400px;opacity:0;pointer-events:none;animation:theo-beat ${LOOP_MS}ms linear infinite}
.hme .theo-phone{position:relative;filter:drop-shadow(-18px 28px 16px rgba(0,0,0,.42));transform-style:preserve-3d}
.hme .theo-phone .pm-phone{width:100%;aspect-ratio:9/17.6}
.hme .hero .hr{overflow:visible}
.hme .theo-tag{display:block;margin:10px auto 0;width:fit-content;text-align:center;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:rgba(8,24,30,.62);border-radius:999px;padding:5px 10px}
.hme .theo-chat{height:100%;min-height:0;display:flex;flex-direction:column;background:hsl(38 38% 93%);color:hsl(220 25% 5%);font-family:Manrope,sans-serif;font-weight:600;line-height:1.35}
.hme .theo-head{display:flex;align-items:center;gap:8px;background:hsl(22 80% 56%);color:#fff;padding:26px 12px 10px}
.hme .theo-orb{width:28px;height:28px;border-radius:99px;flex:none;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,.95), rgba(255,255,255,.45) 42%, rgba(255,255,255,.16))}
.hme .theo-id{display:flex;flex-direction:column;gap:2px;min-width:0}
.hme .theo-id strong{font-size:15px;font-weight:800;letter-spacing:-.01em;line-height:1.1}
.hme .theo-status{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:rgba(255,255,255,.92)}
.hme .theo-status i{width:7px;height:7px;border-radius:99px;background:#34d399;display:block}
.hme .theo-thread{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:10px;overflow:hidden}
.hme .theo-user{align-self:flex-end;max-width:92%;background:hsl(190 54% 40%);color:#fff;border-radius:16px;border-bottom-right-radius:6px;padding:8px 11px;font-weight:600;overflow:hidden;overflow-wrap:anywhere}
.hme .theo-dots{display:flex;align-items:center;gap:5px;width:fit-content;overflow:hidden;background:#fff;border:1px solid hsl(220 25% 78%);border-radius:16px;padding:8px 12px}
.hme .theo-dots b{width:7px;height:7px;border-radius:99px;background:hsl(190 54% 40% / .55);animation:theo-dot 1.2s ease-in-out infinite}
.hme .theo-dots b:nth-child(2){animation-delay:.15s}
.hme .theo-dots b:nth-child(3){animation-delay:.3s}
.hme .theo-reply{display:flex;flex-direction:column;gap:4px;overflow:hidden}
.hme .theo-who{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800}
.hme .theo-who .theo-orb{width:18px;height:18px;background:radial-gradient(circle at 35% 30%, hsl(190 57% 72%), hsl(190 54% 40%) 58%, hsl(190 40% 28%))}
.hme .theo-card{border:1px solid hsl(220 25% 78%);background:#fff;border-radius:16px;padding:10px 12px;font-weight:600;overflow-wrap:anywhere}
.hme .theo-compose{margin-top:auto;display:flex;align-items:center;gap:6px;border-top:1px solid hsl(220 25% 78%);padding:8px}
.hme .theo-field{flex:1;min-width:0;border:1px solid hsl(220 25% 78%);background:#fff;border-radius:999px;padding:8px 12px;color:hsl(220 20% 35%);font-size:12px;font-weight:600}
.hme .theo-send{width:32px;height:32px;border-radius:99px;background:hsl(190 54% 40%);flex:none;position:relative}
.hme .theo-send::before{content:"";position:absolute;left:9px;top:9px;border-left:7px solid #fff;border-top:5px solid transparent;border-bottom:5px solid transparent}
.hme .theo-phone-shift .theo-chat{font-size:16px}
.hme .theo-phone-sales .theo-chat{font-size:13.5px}
.hme .theo-phone-shift .theo-user{animation:theo-shift-ask ${LOOP_MS}ms linear infinite}
.hme .theo-phone-shift .theo-dots{animation:theo-shift-dots ${LOOP_MS}ms linear infinite}
.hme .theo-phone-shift .theo-reply{animation:theo-shift-reply ${LOOP_MS}ms linear infinite}
.hme .theo-phone-sales .theo-user{animation:theo-sales-ask ${LOOP_MS}ms linear infinite}
.hme .theo-phone-sales .theo-dots{animation:theo-sales-dots ${LOOP_MS}ms linear infinite}
.hme .theo-phone-sales .theo-reply{animation:theo-sales-reply ${LOOP_MS}ms linear infinite}
@keyframes theo-platform{0%, ${pct(PLATFORM_MS - 420)}%{opacity:1} ${pct(PLATFORM_MS + 220)}%, ${pct(LOOP_MS - 420)}%{opacity:0} 100%{opacity:1}}
@keyframes theo-beat{0%, ${pct(PLATFORM_MS - 420)}%{opacity:0} ${pct(PLATFORM_MS + 220)}%, ${pct(LOOP_MS - 420)}%{opacity:1} 100%{opacity:0}}
@keyframes theo-dot{0%,60%,100%{opacity:.35;transform:translateY(0)} 30%{opacity:1;transform:translateY(-3px)}}
${reveal("theo-shift-ask", shiftStart)}
${dots("theo-shift-dots", shiftStart)}
${reply("theo-shift-reply", shiftStart)}
${reveal("theo-sales-ask", salesStart)}
${dots("theo-sales-dots", salesStart)}
${reply("theo-sales-reply", salesStart)}
${reveal("theo-sales-ask-m", salesMobileStart)}
${dots("theo-sales-dots-m", salesMobileStart)}
${reply("theo-sales-reply-m", salesMobileStart)}
@keyframes theo-m-shift{
  0%, ${pct(PLATFORM_MS - 420)}%{opacity:0;transform:translate(-20%, -32%) rotateZ(-8deg) scale(.8);z-index:1}
  ${pct(PLATFORM_MS + 220)}%, ${pct(PLATFORM_MS + CHAT_MS - 280)}%{opacity:1;transform:translate(-62%, -50%) rotateZ(-8deg) scale(1);z-index:2}
  ${pct(PLATFORM_MS + CHAT_MS + 220)}%, ${pct(LOOP_MS - 420)}%{opacity:1;transform:translate(-20%, -32%) rotateZ(-8deg) scale(.8);z-index:1}
  100%{opacity:0;transform:translate(-20%, -32%) rotateZ(-8deg) scale(.8);z-index:1}
}
@keyframes theo-m-sales{
  0%, ${pct(PLATFORM_MS - 420)}%{opacity:0;transform:translate(-20%, -32%) rotateZ(6deg) scale(.8);z-index:1}
  ${pct(PLATFORM_MS + 220)}%, ${pct(PLATFORM_MS + CHAT_MS - 280)}%{opacity:1;transform:translate(-20%, -32%) rotateZ(6deg) scale(.8);z-index:1}
  ${pct(PLATFORM_MS + CHAT_MS + 220)}%, ${pct(LOOP_MS - 420)}%{opacity:1;transform:translate(-62%, -50%) rotateZ(6deg) scale(1);z-index:2}
  100%{opacity:0;transform:translate(-20%, -32%) rotateZ(6deg) scale(.8);z-index:1}
}
@media(min-width:768px){
  .hme .theo-phones{align-items:center;justify-content:flex-end;padding:24px 18px 24px 0}
  .hme .theo-phone-shift{width:min(236px,40%);margin-right:-22px;z-index:1;transform:translateY(46px) rotateY(12deg) rotateZ(-8deg)}
  .hme .theo-phone-sales{width:min(292px,48%);z-index:2;transform:translateY(-18px) rotateY(8deg) rotateZ(6deg)}
}
@media(max-width:767px){
  .hme .hero{grid-template-columns:1fr}
  .hme .hero .hr{height:590px;overflow:hidden}
  .hme .theo-phones{display:block}
  .hme .theo-phone{position:absolute;left:50%;top:48%;width:min(236px,68vw)}
  .hme .theo-phone .pm-phone{aspect-ratio:9/19.4}
  .hme .theo-head{padding:36px 10px 8px}
  .hme .theo-thread{padding:8px;gap:6px}
  .hme .theo-compose{padding:6px}
  .hme .theo-phone-shift{animation:theo-m-shift ${LOOP_MS}ms linear infinite}
  .hme .theo-phone-sales{animation:theo-m-sales ${LOOP_MS}ms linear infinite}
  .hme .theo-phone-sales .theo-user{animation-name:theo-sales-ask-m}
  .hme .theo-phone-sales .theo-dots{animation-name:theo-sales-dots-m}
  .hme .theo-phone-sales .theo-reply{animation-name:theo-sales-reply-m}
  .hme .theo-phone-sales .theo-chat{font-size:13px}
  .hme .theo-phone-shift .theo-chat{font-size:14.5px}
}
@media(prefers-reduced-motion:reduce){
  .hme .hero-beat-platform,.hme .hero-beat-theo,.hme .theo-phones,.hme .theo-user,.hme .theo-dots,.hme .theo-reply,.hme .theo-phone-shift,.hme .theo-phone-sales,.hme .theo-dots b{animation:none!important}
  .hme .hero-beat-platform{opacity:1!important}
  .hme .hero-beat-theo{position:relative;opacity:1!important;margin-top:18px}
  .hme .theo-phones{opacity:1!important}
  .hme .theo-user,.hme .theo-reply{max-height:none!important;opacity:1!important}
  .hme .theo-dots{display:none!important}
}
@media(max-width:767px) and (prefers-reduced-motion:reduce){
  .hme .hero .hr{height:auto}
  .hme .theo-phones{position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;height:auto}
  .hme .theo-phone{position:relative;left:auto;top:auto;width:min(280px,88vw);transform:none!important}
}
`;
