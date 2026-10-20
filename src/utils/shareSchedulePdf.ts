import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { buildSchedulePrintHtml, type SchedulePrintData } from "./exportSchedulePrint";

/**
 * Renders the same weekly schedule page desktop Print uses into a PDF,
 * then shares it (iOS/Android share sheet) or downloads it as a fallback.
 */
export async function shareSchedulePdf(data: SchedulePrintData): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const html = buildSchedulePrintHtml(data);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:1400px;height:1000px;border:0;";
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((r) => setTimeout(r, 150));
    const body = doc.body;
    iframe.style.height = `${body.scrollHeight + 40}px`;
    const canvas = await html2canvas(body, { scale: 2, backgroundColor: "#ffffff", windowWidth: 1400 });

    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    const img = canvas.toDataURL("image/jpeg", 0.92);
    let offset = 0;
    const usable = pageH - margin * 2;
    while (offset < imgH) {
      if (offset > 0) pdf.addPage();
      pdf.addImage(img, "JPEG", margin, margin - offset, imgW, imgH);
      offset += usable;
    }

    const name = `Schedule ${data.locationName} ${format(data.weekStart, "MMM d")}-${format(addDays(data.weekStart, 6), "MMM d")}.pdf`.replace(/[\\/:*?"<>|]/g, "");
    const blob = pdf.output("blob");
    const file = new File([blob], name, { type: "application/pdf" });
    const download = () => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    // iOS only allows share right after a tap, so ask for a fresh tap once the PDF is built.
    toast("Schedule PDF ready", {
      duration: 15000,
      action: {
        label: "Share",
        onClick: async () => {
          if (!nav.share || !nav.canShare?.({ files: [file] })) return download();
          try {
            await nav.share({ files: [file], title: name });
          } catch (e) {
            if ((e as { name?: string })?.name !== "AbortError") download();
          }
        },
      },
    });
  } finally {
    iframe.remove();
  }
}
