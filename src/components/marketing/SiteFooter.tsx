import type { ReactNode } from "react";

const CSS = `
.croo-site-footer{display:flex;justify-content:flex-start;align-items:center;gap:16px 28px;flex-wrap:wrap;width:100%}
footer.croo-site-footer a.croo-site-footer-contact{display:inline-flex;align-items:center;justify-content:center;order:-1;border-radius:999px;padding:12px 20px;font-weight:700;font-size:14px;line-height:1;background:#417f8e;color:#fff;text-decoration:none;white-space:nowrap}
footer.croo-site-footer a.croo-site-footer-contact:hover{filter:brightness(.95)}
@media(max-width:760px){
  .croo-site-footer{flex-direction:column;align-items:flex-start}
}
`;

/** First block of the public-site footer. Legal links stay in children. */
export function SiteFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="croo-site-footer">
      <style>{CSS}</style>
      <a className="croo-site-footer-contact" href="mailto:jordan@croohq.com">Contact Us</a>
      {children}
    </footer>
  );
}
