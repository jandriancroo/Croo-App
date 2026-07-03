import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Muted, read-only breadcrumb showing the raw vendor invoice description
 * for an inventory item. Used in edit dialogs so admins can verify they're
 * renaming the correct underlying SKU without leaving the dialog.
 *
 * Lookup order:
 *   1. pfg_bid_items.description  (stable bid-guide label)
 *   2. latest vendor_invoice_items.product_name (fallback)
 */
export function VendorInvoiceNameHint({
  itemNumber,
  vendorSource,
}: {
  itemNumber?: string | null;
  vendorSource?: string | null;
}) {
  const { data: invoiceName } = useQuery({
    queryKey: ['vendor-invoice-name-hint', itemNumber],
    enabled: !!itemNumber,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!itemNumber) return null;
      // 1) PFG bid guide
      const { data: bid } = await supabase
        .from('pfg_bid_items')
        .select('description')
        .eq('item_number', itemNumber)
        .limit(1)
        .maybeSingle();
      if (bid?.description) return bid.description as string;

      // 2) Latest invoice line
      const { data: inv } = await supabase
        .from('vendor_invoice_items')
        .select('product_name')
        .eq('item_number', itemNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (inv?.product_name as string) || null;
    },
  });

  if (!itemNumber && !vendorSource) return null;

  return (
    <div className="flex items-start gap-2 px-2 py-1 rounded-md">
      <span className="text-[10px] text-muted-foreground font-mono shrink-0">Vendor:</span>
      <div className="min-w-0 flex-1">
        {invoiceName && (
          <div
            className="text-[10px] text-muted-foreground font-mono select-all leading-tight break-words"
            title={invoiceName}
          >
            "{invoiceName}"
          </div>
        )}
        <div className="text-[10px] text-muted-foreground/70 font-mono select-all truncate">
          {[vendorSource, itemNumber && `#${itemNumber}`].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    </div>
  );
}
