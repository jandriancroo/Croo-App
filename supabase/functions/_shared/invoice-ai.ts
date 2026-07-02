// Shared AI vision helper — used by both parse-vendor-invoice (Brand) and
// parse-vendor-invoice-lite. Stateless: takes an image + API key, returns the
// parsed invoice JSON. No database access here.

export interface ParsedInvoiceLine {
  product_name: string;
  item_number?: string;
  pa_product_id?: string;
  pack_size?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  total_price?: number;
  [k: string]: unknown;
}


export interface ParsedInvoice {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  delivery_date?: string;
  total_amount?: number;
  line_items: ParsedInvoiceLine[];
}

const SYSTEM_PROMPT = `You are an invoice parser. Extract all line items from this vendor invoice image.

CRITICAL — VENDOR IDENTIFICATION:
- vendor_name MUST be the SELLER / DISTRIBUTOR / SUPPLIER — the company that issued the invoice and is being paid.
- Look for labels like "Remit To", "From", "Sold By", "Vendor", the letterhead/logo at the top, or a "Please make checks payable to" line.
- NEVER use the "Sold To", "Bill To", "Ship To", "Customer", or "Deliver To" party — that is the buyer (the restaurant/store).
- If the letterhead shows a beer/beverage distributor, produce house, or broadline supplier, that is the vendor.
- If unsure between two names, pick the one with the remit address, phone number for orders, or account/customer number formatted as "Customer #".

For each line item extract: product_name, item_number (vendor/distributor SKU if visible), pa_product_id (ONLY the value from a column literally labeled PA Product ID or equivalent), pack_size, quantity, unit (case/each/lb/etc), unit_price, total_price.
pack_size is the verbatim pack/case breakdown text as printed on the invoice line — e.g. "2/1 LB", "24/12 OZ", "4/1 GAL", "6/#10". Copy it EXACTLY as shown, preserving the slash and units. If a line has no visible pack-size text, omit the field. Do NOT guess or fabricate one.
If the invoice has multiple code columns (for example Dist Item, Item, and PA Product ID), keep the PA Product ID in pa_product_id and keep the other vendor/distributor code in item_number.
For Worldwide Produce / Produce Alliance style invoices, prefer the human-readable Description column for product_name and capture the PA Product ID exactly as shown.
Also extract: invoice_number, invoice_date (YYYY-MM-DD), delivery_date (YYYY-MM-DD if shown), total_amount.
Return ONLY valid JSON, no markdown.`;


const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "extract_invoice",
    description: "Extract structured invoice data from image",
    parameters: {
      type: "object",
      properties: {
        vendor_name: { type: "string" },
        invoice_number: { type: "string" },
        invoice_date: { type: "string", description: "YYYY-MM-DD" },
        delivery_date: { type: "string", description: "YYYY-MM-DD or null" },
        total_amount: { type: "number" },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              product_name: { type: "string" },
              item_number: { type: "string" },
              pa_product_id: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string" },
              unit_price: { type: "number" },
              total_price: { type: "number" },
            },
            required: ["product_name"],
          },
        },
      },
      required: ["vendor_name", "line_items"],
    },
  },
};

export class AiRateLimitedError extends Error {
  constructor() { super("Rate limited"); this.name = "AiRateLimitedError"; }
}
export class AiCreditsExhaustedError extends Error {
  constructor() { super("AI credits exhausted"); this.name = "AiCreditsExhaustedError"; }
}

/** Convert an image ArrayBuffer to base64 in 8KB chunks (avoids call-stack overflow). */
export function imageBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Call Lovable AI Gateway with the invoice image and return the parsed JSON. */
export async function extractInvoiceFromImage(
  base64Image: string,
  contentType: string,
  lovableApiKey: string,
): Promise<ParsedInvoice> {
  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${contentType};base64,${base64Image}` } },
            { type: "text", text: "Parse this invoice. Extract all line items and invoice metadata." },
          ],
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "extract_invoice" } },
    }),
  });

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    console.error("AI gateway error:", aiResp.status, errText);
    if (aiResp.status === 429) throw new AiRateLimitedError();
    if (aiResp.status === 402) throw new AiCreditsExhaustedError();
    throw new Error("AI parsing failed: " + errText);
  }

  const aiResult = await aiResp.json();
  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) throw new Error("AI returned no structured data");

  return JSON.parse(toolCall.function.arguments) as ParsedInvoice;
}
