import { format } from "date-fns";

interface WriteUpExport {
  type: "writeup";
  employeeName: string;
  reason: string;
  isFinalWarning: boolean;
  issueDescription: string;
  nextSteps: string;
  photoUrl?: string | null;
  signatureUrl?: string | null;
  signedAt?: string | null;
  createdAt: string;
  createdByName?: string;
  locationName?: string;
}

interface DocumentExport {
  type: "document";
  employeeName: string;
  title: string;
  items: { content: string; children?: { content: string }[] }[];
  signatureUrl?: string | null;
  signedAt?: string | null;
  createdAt: string;
  createdByName?: string;
}

export type RecordExport = WriteUpExport | DocumentExport;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getBaseStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #1a1a1a;
      background: white;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      border-bottom: 3px solid #1a1a1a;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .header-meta {
      display: flex;
      justify-content: space-between;
      color: #666;
      font-size: 12px;
      margin-top: 8px;
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-destructive { background: #dc2626; color: white; }
    .badge-warning { background: #b91c1c; color: white; }
    .badge-outline { border: 1px solid #d1d5db; color: #374151; }
    .badges { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .section {
      margin-bottom: 20px;
    }
    .section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #888;
      margin-bottom: 6px;
    }
    .section-content {
      padding: 12px 16px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      white-space: pre-wrap;
      font-size: 13px;
      line-height: 1.6;
    }
    .section-content.highlight {
      border-color: #3b82f6;
      background: #eff6ff;
    }
    .photo {
      max-width: 100%;
      max-height: 300px;
      object-fit: contain;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
    }
    .signature-section {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
    }
    .signature-label {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .signature-img {
      max-height: 80px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 8px;
      background: white;
    }
    .signature-date {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
    .item-list {
      padding: 12px 16px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }
    .item { margin-bottom: 8px; }
    .item:last-child { margin-bottom: 0; }
    .item-number { font-weight: 600; min-width: 24px; display: inline-block; }
    .sub-items {
      margin-left: 28px;
      margin-top: 4px;
      padding-left: 12px;
      border-left: 2px solid #e5e7eb;
    }
    .sub-item { margin-bottom: 3px; color: #555; }
    .sub-item-letter { font-size: 12px; color: #888; min-width: 20px; display: inline-block; }
    .pending {
      color: #d97706;
      font-style: italic;
      font-size: 12px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 10px;
      color: #999;
      text-align: center;
    }
    @media print {
      body { padding: 20px; }
      @page { margin: 0.75in; }
    }
  `;
}

function buildWriteUpHtml(data: WriteUpExport): string {
  const dateStr = format(new Date(data.createdAt), "MMMM d, yyyy");
  const signedDateStr = data.signedAt
    ? format(new Date(data.signedAt), "MMMM d, yyyy 'at' h:mm a")
    : null;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Corrective Action – ${escapeHtml(data.employeeName)}</title>
<style>${getBaseStyles()}</style>
</head><body>
<div class="header">
  <h1>Corrective Action</h1>
  <div class="header-meta">
    <span>Employee: <strong>${escapeHtml(data.employeeName)}</strong></span>
    <span>Date: ${dateStr}</span>
  </div>
  <div class="header-meta">
    <span>Issued by: ${escapeHtml(data.createdByName || "Manager")}</span>
    ${data.locationName ? `<span>Location: ${escapeHtml(data.locationName)}</span>` : ""}
  </div>
</div>

<div class="badges">
  <span class="badge badge-destructive">${escapeHtml(data.reason)}</span>
  ${data.isFinalWarning ? '<span class="badge badge-warning">Final Warning</span>' : ""}
</div>

<div class="section">
  <div class="section-label">Issue Description</div>
  <div class="section-content">${escapeHtml(data.issueDescription)}</div>
</div>

<div class="section">
  <div class="section-label">Next Steps / Corrective Action</div>
  <div class="section-content highlight">${escapeHtml(data.nextSteps)}</div>
</div>

${data.photoUrl ? `
<div class="section">
  <div class="section-label">Supporting Photo</div>
  <img src="${data.photoUrl}" class="photo" />
</div>
` : ""}

<div class="signature-section">
  ${signedDateStr ? `
    <div class="signature-label">Employee Acknowledgment</div>
    ${data.signatureUrl ? `<img src="${data.signatureUrl}" class="signature-img" />` : ""}
    <div class="signature-date">Signed on ${signedDateStr}</div>
  ` : '<div class="pending">⏳ Pending employee acknowledgment</div>'}
</div>

<div class="footer">Confidential Employee Record – Generated ${format(new Date(), "MMM d, yyyy 'at' h:mm a")}</div>
</body></html>`;
}

function buildDocumentHtml(data: DocumentExport): string {
  const dateStr = data.createdAt ? format(new Date(data.createdAt), "MMMM d, yyyy") : "";
  const signedDateStr = data.signedAt
    ? format(new Date(data.signedAt), "MMMM d, yyyy 'at' h:mm a")
    : null;

  const itemsHtml = data.items
    .map((item, idx) => {
      const childrenHtml =
        item.children && item.children.length > 0
          ? `<div class="sub-items">${item.children
              .map(
                (child, ci) =>
                  `<div class="sub-item"><span class="sub-item-letter">${String.fromCharCode(97 + ci)}.</span> ${escapeHtml(child.content)}</div>`
              )
              .join("")}</div>`
          : "";
      return `<div class="item"><span class="item-number">${idx + 1}.</span> ${escapeHtml(item.content)}${childrenHtml}</div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${escapeHtml(data.title)} – ${escapeHtml(data.employeeName)}</title>
<style>${getBaseStyles()}</style>
</head><body>
<div class="header">
  <h1>${escapeHtml(data.title)}</h1>
  <div class="header-meta">
    <span>Employee: <strong>${escapeHtml(data.employeeName)}</strong></span>
    <span>Created: ${dateStr}</span>
  </div>
  ${data.createdByName ? `<div class="header-meta"><span>Issued by: ${escapeHtml(data.createdByName)}</span></div>` : ""}
</div>

<div class="section">
  <div class="section-label">Document Contents</div>
  <div class="item-list">${itemsHtml}</div>
</div>

<div class="signature-section">
  ${signedDateStr ? `
    <div class="signature-label">Employee Signature</div>
    ${data.signatureUrl ? `<img src="${data.signatureUrl}" class="signature-img" />` : ""}
    <div class="signature-date">Signed on ${signedDateStr}</div>
  ` : '<div class="pending">⏳ Pending signature</div>'}
</div>

<div class="footer">Confidential Employee Record – Generated ${format(new Date(), "MMM d, yyyy 'at' h:mm a")}</div>
</body></html>`;
}

export function exportRecordToPdf(data: RecordExport) {
  const html =
    data.type === "writeup" ? buildWriteUpHtml(data) : buildDocumentHtml(data);

  // Inject a toolbar at the top that hides when printing
  const toolbarHtml = `
    <div id="pdf-toolbar" style="
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: #1a1a1a; color: white; padding: 10px 20px;
      display: flex; align-items: center; justify-content: space-between;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
    ">
      <span>To save as PDF: use <strong>Share → Save as PDF</strong> (iOS) or <strong>⌘P → Save as PDF</strong> (Desktop)</span>
      <button onclick="document.getElementById('pdf-toolbar').style.display='none'; window.print();" style="
        background: #dc2626; color: white; border: none; padding: 8px 20px;
        border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;
      ">Print / Save PDF</button>
    </div>
    <style>
      @media print { #pdf-toolbar { display: none !important; } }
      body { padding-top: 56px !important; }
    </style>
  `;

  // Insert toolbar right after <body>
  const finalHtml = html.replace(/<body>/, "<body>" + toolbarHtml);

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to export PDF");
    return;
  }

  printWindow.document.write(finalHtml);
  printWindow.document.close();
}
