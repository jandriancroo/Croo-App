// Heimark reading profile: the AI copy step. The rules that turn the copied
// text into checked lines live in ./heimarkRules.ts (pure, unit-tested).
export * from "./heimarkRules.ts";
import type { HeimarkRawInvoice } from "./heimarkRules.ts";

export const HEIMARK_SYSTEM_PROMPT = `You are copying a Heimark Distributing invoice (a narrow thermal receipt) into JSON.
Copy text exactly as printed. Do NOT calculate, infer or fix anything.
Columns, left to right: ITEM# | QTY | DESCRIPTION | PRICE | DISC | CRV/DEP | AMOUNT.
For every product line copy: item_number (ITEM#), quantity (QTY), description (the DESCRIPTION text exactly, including codes like 24/16CALNR2/12, 6/4CN, LOOSE), price (PRICE), discount (DISC, 0 if printed 0.00 or blank), crv_deposit (CRV/DEP), amount (AMOUNT).
Then copy the footer totals exactly: Total CRV Units, Total CRV$, Cases, Gals, Content$, Deposit$, Discount$, Invoice Total. Leave a footer value out if it is not visible.
Also copy invoice_number (Invoice#), invoice_date and delivery_date as YYYY-MM-DD.
vendor_name is the seller (Heimark Distributing, LLC), never the store it was sold to.`;

const n = { type: ["number", "null"] };
const t = { type: ["string", "null"] };
const LINE_KEYS = ["item_number", "quantity", "description", "price", "discount", "crv_deposit", "amount"];
const FOOTER_KEYS = ["total_crv_units", "total_crv_dollars", "cases", "gallons", "content_dollars", "deposit_dollars", "discount_dollars", "invoice_total"];

/** Strict JSON schema for the copy step (all keys required, nullable values). */
export const HEIMARK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor_name", "invoice_number", "invoice_date", "delivery_date", "lines", "footer"],
  properties: {
    vendor_name: t,
    invoice_number: t,
    invoice_date: { ...t, description: "YYYY-MM-DD" },
    delivery_date: { ...t, description: "YYYY-MM-DD" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: LINE_KEYS,
        properties: {
          item_number: t, quantity: n, description: t, price: n, discount: n, crv_deposit: n, amount: n,
        },
      },
    },
    footer: {
      type: "object",
      additionalProperties: false,
      required: FOOTER_KEYS,
      properties: Object.fromEntries(FOOTER_KEYS.map((k) => [k, n])),
    },
  },
};

export const HEIMARK_MODEL = "openai/gpt-6-astra";

/** Ask the model to COPY the Heimark columns. Interpretation happens in code. */
export async function extractHeimarkInvoice(
  base64Image: string,
  contentType: string,
  lovableApiKey: string,
): Promise<HeimarkRawInvoice> {
  // iPhone photos arrive as HEIC, which this reader doesn't accept: turn them
  // into JPEG first (same photo, no cropping or resizing).
  const head = atob(base64Image.slice(0, 24));
  const isHeic = /hei[cf]/i.test(contentType) || (head.slice(4, 8) === "ftyp" && /hei|mif1|msf1|hevc/.test(head.slice(8, 12)));
  if (isHeic) {
    // @ts-ignore npm specifier resolves in the edge runtime only
    const { default: convert } = await import("npm:heic-convert@2.1.0");
    const bin = Uint8Array.from(atob(base64Image), (c) => c.charCodeAt(0));
    const jpg = new Uint8Array(await convert({ buffer: bin, format: "JPEG", quality: 0.9 }));
    let str = "";
    for (let i = 0; i < jpg.length; i += 8192) str += String.fromCharCode(...jpg.subarray(i, i + 8192));
    base64Image = btoa(str);
    contentType = "image/jpeg";
  }
  const dataUrl = `data:${contentType};base64,${base64Image}`;
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Lovable-API-Key": lovableApiKey, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: HEIMARK_MODEL,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      instructions: HEIMARK_SYSTEM_PROMPT,
      input: [{
        role: "user",
        content: [
          contentType.includes("pdf")
            ? { type: "input_file", filename: "invoice.pdf", file_data: dataUrl }
            : { type: "input_image", image_url: dataUrl },
          { type: "input_text", text: "Copy every product line and the footer totals exactly as printed. Return json." },
        ],
      }],
      text: { format: { type: "json_schema", name: "heimark_invoice", strict: true, schema: HEIMARK_JSON_SCHEMA } },
    }),
  });
  if (!resp.ok || !resp.body) {
    const body = await resp.text().catch(() => "");
    const err: any = new Error(`Heimark read failed: ${resp.status} ${body.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  // Read the stream; keep the text deltas.
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") out += ev.delta;
        else if (ev.type === "error" || ev.type === "response.failed") throw new Error(`Heimark read failed: ${JSON.stringify(ev).slice(0, 200)}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Heimark read failed")) throw e;
      }
    }
  }
  if (!out.trim()) throw new Error("Heimark read returned no structured data");
  const parsed = JSON.parse(out) as HeimarkRawInvoice;
  parsed.lines = Array.isArray(parsed.lines) ? parsed.lines : [];
  return parsed;
}
