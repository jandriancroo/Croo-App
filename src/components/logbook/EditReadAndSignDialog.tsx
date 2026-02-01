import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DocumentItem {
  id: string;
  content: string;
  order_index: number;
  parent_id: string | null;
  children: DocumentItem[];
}

interface EditReadAndSignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  currentTitle: string;
  signedCount: number;
}

export function EditReadAndSignDialog({
  open,
  onOpenChange,
  documentId,
  currentTitle,
  signedCount,
}: EditReadAndSignDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // Load document items when dialog opens
  useEffect(() => {
    if (open && documentId) {
      loadDocumentItems();
    }
  }, [open, documentId]);

  const loadDocumentItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("read_and_sign_items")
        .select("*")
        .eq("document_id", documentId)
        .order("order_index");

      if (error) throw error;

      // Organize into hierarchy
      const allItems = data || [];
      const parentItems = allItems.filter((i) => !i.parent_id);
      const childrenMap = allItems.reduce((acc, item) => {
        if (item.parent_id) {
          if (!acc[item.parent_id]) acc[item.parent_id] = [];
          acc[item.parent_id].push(item);
        }
        return acc;
      }, {} as Record<string, typeof allItems>);

      setItems(
        parentItems.map((parent) => ({
          ...parent,
          children: (childrenMap[parent.id] || []).map((child) => ({
            ...child,
            children: [],
          })),
        }))
      );
      setTitle(currentTitle);
    } catch (error) {
      console.error("Error loading document items:", error);
      toast.error("Failed to load document");
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setItems([
      ...items,
      {
        id: `new-${crypto.randomUUID()}`,
        content: "",
        order_index: items.length,
        parent_id: null,
        children: [],
      },
    ]);
  };

  const addSubItem = (parentId: string) => {
    setItems(
      items.map((item) => {
        if (item.id === parentId) {
          return {
            ...item,
            children: [
              ...item.children,
              {
                id: `new-${crypto.randomUUID()}`,
                content: "",
                order_index: item.children.length,
                parent_id: parentId,
                children: [],
              },
            ],
          };
        }
        return item;
      })
    );
  };

  const updateItem = (id: string, content: string, parentId?: string) => {
    if (parentId) {
      setItems(
        items.map((item) => {
          if (item.id === parentId) {
            return {
              ...item,
              children: item.children.map((child) =>
                child.id === id ? { ...child, content } : child
              ),
            };
          }
          return item;
        })
      );
    } else {
      setItems(items.map((item) => (item.id === id ? { ...item, content } : item)));
    }
  };

  const removeItem = (id: string, parentId?: string) => {
    if (parentId) {
      setItems(
        items.map((item) => {
          if (item.id === parentId) {
            return {
              ...item,
              children: item.children.filter((child) => child.id !== id),
            };
          }
          return item;
        })
      );
    } else {
      if (items.length > 1) {
        setItems(items.filter((item) => item.id !== id));
      }
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    const validItems = items.filter((item) => item.content.trim());
    if (validItems.length === 0) {
      toast.error("Please add at least one item");
      return;
    }

    setSaving(true);
    try {
      // Get current revision number first
      const { data: currentDoc } = await supabase
        .from("read_and_sign_documents")
        .select("revision_number")
        .eq("id", documentId)
        .single();

      // Update document title, revision timestamp, and increment revision_number atomically
      const { error: docError } = await supabase
        .from("read_and_sign_documents")
        .update({
          title: title.trim(),
          revised_at: new Date().toISOString(),
          revision_number: (currentDoc?.revision_number || 0) + 1,
        })
        .eq("id", documentId);

      if (docError) throw docError;

      // Delete existing items
      await supabase.from("read_and_sign_items").delete().eq("document_id", documentId);

      // Insert updated parent items
      const parentInserts = validItems.map((item, idx) => ({
        document_id: documentId,
        parent_id: null,
        content: item.content,
        order_index: idx,
      }));

      const { data: insertedParents, error: parentError } = await supabase
        .from("read_and_sign_items")
        .insert(parentInserts)
        .select();

      if (parentError) throw parentError;

      // Insert child items
      const childInserts: {
        document_id: string;
        parent_id: string;
        content: string;
        order_index: number;
      }[] = [];

      validItems.forEach((item, parentIdx) => {
        const parentDbRow = insertedParents?.[parentIdx];
        if (parentDbRow) {
          item.children
            .filter((c) => c.content.trim())
            .forEach((child, childIdx) => {
              childInserts.push({
                document_id: documentId,
                parent_id: parentDbRow.id,
                content: child.content,
                order_index: childIdx,
              });
            });
        }
      });

      if (childInserts.length > 0) {
        const { error: childError } = await supabase
          .from("read_and_sign_items")
          .insert(childInserts);

        if (childError) throw childError;
      }

      // Reset all signatures if document was revised (full re-sign required)
      if (signedCount > 0) {
        await supabase
          .from("read_and_sign_assignments")
          .update({ signed_at: null, signature_url: null })
          .eq("document_id", documentId);
      }

      // Note: Item checks are automatically cleaned up via ON DELETE CASCADE
      // when the items are deleted above

      toast.success(
        signedCount > 0
          ? "Document revised - all employees must re-sign"
          : "Document updated successfully"
      );

      queryClient.invalidateQueries({ queryKey: ["read-and-sign"] });
      queryClient.invalidateQueries({ queryKey: ["read-and-sign-details", documentId] });
      queryClient.invalidateQueries({ queryKey: ["read-and-sign-counts", documentId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });

      onOpenChange(false);
    } catch (error: any) {
      console.error("Error updating document:", error);
      toast.error(error.message || "Failed to update document");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Read & Sign Document</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {signedCount > 0 && (
              <Alert variant="destructive" className="bg-amber-500/10 border-amber-500/50 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {signedCount} employee(s) have already signed. Saving changes will require
                  everyone to re-sign.
                </AlertDescription>
              </Alert>
            )}

            {/* Title */}
            <div className="space-y-2">
              <Label>Document Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., New Cleaning Procedures"
              />
            </div>

            {/* Items */}
            <div className="space-y-3">
              <Label>Document Items</Label>
              {items.map((item, index) => (
                <div key={item.id} className="space-y-2 bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                      Item {index + 1}
                    </span>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(item.id)}
                        className="text-destructive hover:text-destructive h-8 w-8 p-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <Textarea
                    value={item.content}
                    onChange={(e) => {
                      updateItem(item.id, e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = e.target.scrollHeight + "px";
                    }}
                    placeholder="Enter item text..."
                    className="w-full min-h-[60px] resize-none overflow-hidden"
                  />

                  {/* Sub-items */}
                  {item.children.length > 0 && (
                    <div className="space-y-2 border-l-2 border-primary/30 pl-3 ml-2">
                      {item.children.map((child, childIndex) => (
                        <div key={child.id} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {String.fromCharCode(97 + childIndex)}.
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeItem(child.id, item.id)}
                              className="text-destructive hover:text-destructive h-6 w-6 p-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <Textarea
                            value={child.content}
                            onChange={(e) => {
                              updateItem(child.id, e.target.value, item.id);
                              e.target.style.height = "auto";
                              e.target.style.height = e.target.scrollHeight + "px";
                            }}
                            placeholder="Enter sub-item text..."
                            className="w-full min-h-[40px] resize-none overflow-hidden text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => addSubItem(item.id)}
                    className="text-xs text-muted-foreground"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add sub-item
                  </Button>
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : signedCount > 0 ? (
              "Save & Require Re-Sign"
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
