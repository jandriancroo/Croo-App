import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Upload, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LibraryScope } from "@/hooks/useLibrary";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scope: LibraryScope;
  brandId: string | null;
  organizationId: string | null;
}

export function DocumentUploader({ open, onOpenChange, scope, brandId, organizationId }: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return toast.error("Title required");
    setSaving(true);
    try {
      let fileUrl: string | null = null;
      let fileType: string | null = null;
      if (file) {
        const path = `${scope}/${(scope === "brand" ? brandId : organizationId) || "misc"}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("library-assets").upload(path, file);
        if (upErr) throw upErr;
        const { data: signed } = await supabase.storage.from("library-assets").createSignedUrl(path, 60 * 60 * 24 * 365);
        fileUrl = signed?.signedUrl ?? null;
        fileType = file.type;
      }
      const payload: any = {
        scope,
        brand_id: scope === "brand" ? brandId : null,
        organization_id: scope === "org" ? organizationId : null,
        doc_type: "document",
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        file_url: fileUrl,
        file_type: fileType,
      };
      const { error } = await supabase.from("library_documents" as any).insert(payload);
      if (error) throw error;
      toast.success("Document added");
      qc.invalidateQueries({ queryKey: ["library-documents"] });
      onOpenChange(false);
      setTitle(""); setDescription(""); setTags(""); setCategory(""); setFile(null);
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tags</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="sop, safety" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>File</Label>
            <label className="flex items-center gap-2 border border-dashed rounded-lg p-4 cursor-pointer hover:bg-accent">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{file ? file.name : "Choose PDF or image"}</span>
              <input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
