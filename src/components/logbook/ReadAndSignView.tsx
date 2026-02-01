import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LandscapeSignatureOverlay } from "@/components/ui/LandscapeSignatureOverlay";
import { AlertTriangle, FileText, Loader2, CheckCircle2, Paperclip, Image as ImageIcon, ExternalLink, Eye, EyeOff, PenLine } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DocumentItem {
  id: string;
  content: string;
  order_index: number;
  children?: DocumentItem[];
}

interface Attachment {
  url: string;
  name: string;
  type: string;
  size?: number;
}

interface ReadAndSignViewProps {
  assignment: {
    id: string;
    document_id: string;
  };
  document: {
    id: string;
    title: string;
    list_style: string;
    created_at: string;
    created_by_profile?: { full_name: string };
    attachments?: Attachment[] | null;
  };
  items: DocumentItem[];
  onComplete: () => void;
}

export function ReadAndSignView({
  assignment,
  document,
  items,
  onComplete,
}: ReadAndSignViewProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [viewedAttachments, setViewedAttachments] = useState<Set<number>>(new Set());
  const [isSigning, setIsSigning] = useState(false);
  const [showSignatureOverlay, setShowSignatureOverlay] = useState(false);

  // Get all item IDs that need to be checked
  const allItemIds = items.flatMap((item) => [
    item.id,
    ...(item.children?.map((c) => c.id) || []),
  ]);

  const allChecked = allItemIds.every((id) => checkedItems.has(id));
  
  // Check if all attachments have been viewed
  const attachmentCount = document.attachments?.length || 0;
  const allAttachmentsViewed = attachmentCount === 0 || viewedAttachments.size >= attachmentCount;
  
  // Can only sign if all items checked AND all attachments viewed
  const canSign = allChecked && allAttachmentsViewed;

  const toggleItem = (itemId: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(itemId)) {
      newChecked.delete(itemId);
    } else {
      newChecked.add(itemId);
    }
    setCheckedItems(newChecked);
  };

  const handleSignature = async (signatureDataUrl: string) => {
    setIsSigning(true);
    try {
      // Convert base64 to blob
      const response = await fetch(signatureDataUrl);
      const blob = await response.blob();

      // Get current user ID for storage policy compliance
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload signature to storage - path must start with user ID for RLS policy
      const fileName = `${user.id}/read-and-sign/${assignment.id}/${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("logbook-attachments")
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("logbook-attachments").getPublicUrl(fileName);

      // Record item checks
      const itemChecks = Array.from(checkedItems).map((itemId) => ({
        assignment_id: assignment.id,
        item_id: itemId,
      }));

      if (itemChecks.length > 0) {
        const { error: checksError } = await supabase
          .from("read_and_sign_item_checks")
          .insert(itemChecks);

        if (checksError) throw checksError;
      }

      // Update assignment with signature
      const { error: updateError } = await supabase
        .from("read_and_sign_assignments")
        .update({
          signature_url: publicUrl,
          signed_at: new Date().toISOString(),
        })
        .eq("id", assignment.id);

      if (updateError) throw updateError;

      toast.success("Document signed successfully");
      onComplete();
    } catch (error: any) {
      console.error("Error signing document:", error);
      toast.error("Failed to save signature: " + error.message);
    } finally {
      setIsSigning(false);
    }
  };

  const getListMarker = (index: number, isChild: boolean = false) => {
    if (isChild) {
      return String.fromCharCode(97 + index) + ".";
    }
    switch (document.list_style) {
      case "numbered":
        return `${index + 1}.`;
      case "bulleted":
        return "•";
      case "checklist":
        return null; // Use checkbox
      default:
        return `${index + 1}.`;
    }
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  const openAttachment = (attachment: Attachment, index: number) => {
    // Mark attachment as viewed
    setViewedAttachments(prev => new Set([...prev, index]));
    window.open(attachment.url, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b bg-primary/5">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-lg truncate">{document.title}</h1>
        </div>
        <Badge variant="outline" className="text-xs">
          {format(new Date(document.created_at), "MMM d, yyyy")}
        </Badge>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {/* Info */}
        <div className="text-sm text-muted-foreground">
          Please read each item carefully and check the box to confirm you understand.
          {document.created_by_profile?.full_name && (
            <span> Created by {document.created_by_profile.full_name}.</span>
          )}
        </div>

        {/* Attachments */}
        {document.attachments && document.attachments.length > 0 && (
          <Card className={`border-2 transition-colors ${
            allAttachmentsViewed 
              ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20' 
              : 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20'
          }`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                Attachments
                <Badge variant={allAttachmentsViewed ? "default" : "secondary"} className="ml-auto text-xs">
                  {viewedAttachments.size}/{attachmentCount} viewed
                </Badge>
              </CardTitle>
              {!allAttachmentsViewed && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  You must open each attachment before signing
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {document.attachments.map((attachment, index) => {
                const isViewed = viewedAttachments.has(index);
                return (
                  <Button
                    key={index}
                    variant={isViewed ? "default" : "outline"}
                    className={`w-full justify-start gap-2 h-auto py-2 ${
                      isViewed ? 'bg-green-600 hover:bg-green-700 text-white' : ''
                    }`}
                    onClick={() => openAttachment(attachment, index)}
                  >
                    {isViewed ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                    {getFileIcon(attachment.type)}
                    <span className="flex-1 text-left truncate">{attachment.name}</span>
                    {isViewed ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <ExternalLink className="h-4 w-4 opacity-60" />
                    )}
                  </Button>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Items */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Document Items
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, index) => (
              <div key={item.id} className="space-y-2">
                {/* Parent item */}
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`item-${item.id}`}
                    checked={checkedItems.has(item.id)}
                    onCheckedChange={() => toggleItem(item.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <label
                      htmlFor={`item-${item.id}`}
                      className={`text-sm cursor-pointer ${
                        checkedItems.has(item.id) ? "text-muted-foreground line-through" : ""
                      }`}
                    >
                      {getListMarker(index) && (
                        <span className="font-medium mr-2">{getListMarker(index)}</span>
                      )}
                      {item.content}
                    </label>
                  </div>
                </div>

                {/* Children */}
                {item.children && item.children.length > 0 && (
                  <div className="ml-8 space-y-2 border-l-2 border-muted pl-4">
                    {item.children.map((child, childIndex) => (
                      <div key={child.id} className="flex items-start gap-3">
                        <Checkbox
                          id={`item-${child.id}`}
                          checked={checkedItems.has(child.id)}
                          onCheckedChange={() => toggleItem(child.id)}
                          className="mt-0.5"
                        />
                        <label
                          htmlFor={`item-${child.id}`}
                          className={`text-sm cursor-pointer ${
                            checkedItems.has(child.id) ? "text-muted-foreground line-through" : ""
                          }`}
                        >
                          <span className="text-muted-foreground mr-2">
                            {getListMarker(childIndex, true)}
                          </span>
                          {child.content}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Progress */}
        <div className="flex items-center gap-2 text-sm">
          {allChecked ? (
            <Badge variant="default" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              All items acknowledged
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              {checkedItems.size}/{allItemIds.length} items checked
            </Badge>
          )}
        </div>

        {/* Acknowledgment Message */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-sm text-primary/80 italic">
              By signing below, I confirm that I have read and understand all the items in this
              document and agree to follow the guidelines outlined above.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sign Button - Fixed Footer */}
      <div className="flex-shrink-0 border-t bg-background p-4 pb-safe">
        {!canSign ? (
          <div className="text-center py-4 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
            {!allAttachmentsViewed && attachmentCount > 0 ? (
              <p className="text-sm">Please open all attachments before signing</p>
            ) : (
              <p className="text-sm">Please check all items before signing</p>
            )}
          </div>
        ) : (
          <Button
            className="w-full h-12 text-base gap-2"
            onClick={() => setShowSignatureOverlay(true)}
            disabled={isSigning}
          >
            <PenLine className="h-5 w-5" />
            Tap to Sign Document
          </Button>
        )}
      </div>

      {/* Landscape Signature Overlay */}
      <LandscapeSignatureOverlay
        open={showSignatureOverlay}
        onClose={() => setShowSignatureOverlay(false)}
        onSave={handleSignature}
        title={`Sign: ${document.title}`}
        disabled={isSigning}
      />

      {/* Loading overlay */}
      {isSigning && (
        <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">Saving signature...</span>
          </div>
        </div>
      )}
    </div>
  );
}
