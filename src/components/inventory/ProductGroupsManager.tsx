import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, GripVertical, Layers } from "lucide-react";
import { toast } from "sonner";

interface ProductGroupsManagerProps {
  locationId: string;
}

interface ProductGroup {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  pos_categories: string[] | null;
}

const ProductGroupsManager = ({ locationId }: ProductGroupsManagerProps) => {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProductGroup | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPosCategories, setSelectedPosCategories] = useState<string[]>([]);

  const { data: groups, isLoading } = useQuery({
    queryKey: ["inventory-product-groups", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_product_groups")
        .select("*")
        .eq("location_id", locationId)
        .order("display_order", { ascending: true });

      if (error) throw error;
      return data as ProductGroup[];
    },
  });

  // Fetch distinct POS categories from sales_cache product_mix
  const { data: posCategories } = useQuery({
    queryKey: ["pos-categories", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_cache")
        .select("product_mix")
        .eq("location_id", locationId)
        .not("product_mix", "is", null)
        .order("sale_date", { ascending: false })
        .limit(7);

      if (error) throw error;

      const categories = new Set<string>();
      for (const row of data || []) {
        const mix = row.product_mix as any[];
        if (Array.isArray(mix)) {
          for (const item of mix) {
            if (item.category) categories.add(item.category);
          }
        }
      }
      return Array.from(categories).sort();
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async ({ id, name, description, posCategories }: { id?: string; name: string; description: string; posCategories: string[] }) => {
      if (id) {
        const { error } = await supabase
          .from("inventory_product_groups")
          .update({ name, description: description || null, pos_categories: posCategories })
          .eq("id", id);
        if (error) throw error;
      } else {
        const maxOrder = groups?.length ? Math.max(...groups.map(g => g.display_order)) + 1 : 0;
        const { error } = await supabase
          .from("inventory_product_groups")
          .insert({
            location_id: locationId,
            name,
            description: description || null,
            display_order: maxOrder,
            pos_categories: posCategories,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-product-groups", locationId] });
      toast.success(editingGroup ? "Group updated" : "Group added");
      closeDialog();
    },
    onError: (err: any) => {
      if (err?.message?.includes("duplicate")) {
        toast.error("A group with that name already exists");
      } else {
        toast.error("Failed to save group");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("inventory_product_groups")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-product-groups", locationId] });
      toast.success("Group deleted");
    },
    onError: () => {
      toast.error("Failed to delete group — it may have usage rates linked");
    },
  });

  const openAdd = () => {
    setEditingGroup(null);
    setName("");
    setDescription("");
    setSelectedPosCategories([]);
    setShowDialog(true);
  };

  const openEdit = (group: ProductGroup) => {
    setEditingGroup(group);
    setName(group.name);
    setDescription(group.description || "");
    setSelectedPosCategories(group.pos_categories || []);
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingGroup(null);
    setName("");
    setDescription("");
    setSelectedPosCategories([]);
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    upsertMutation.mutate({
      id: editingGroup?.id,
      name: name.trim(),
      description: description.trim(),
      posCategories: selectedPosCategories,
    });
  };

  const togglePosCategory = (category: string) => {
    setSelectedPosCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Product Groups
            </CardTitle>
            <Button size="sm" variant="outline" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Define pizza size/type categories for usage rate tracking (e.g., Large, Regular, Specialty)
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
          ) : !groups || groups.length === 0 ? (
            <div className="text-center py-6 space-y-2">
              <p className="text-sm text-muted-foreground">No product groups yet</p>
              <Button size="sm" onClick={openAdd}>
                <Plus className="h-4 w-4 mr-1" />
                Add First Group
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-center justify-between py-3 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{group.name}</p>
                        {!group.is_active && (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      {group.description && (
                        <p className="text-xs text-muted-foreground truncate">{group.description}</p>
                      )}
                      {group.pos_categories && group.pos_categories.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {group.pos_categories.map(cat => (
                            <Badge key={cat} variant="outline" className="text-[10px] px-1.5 py-0">
                              {cat}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(group)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(group.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Group" : "Add Product Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                placeholder="e.g., Large Pizza"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-desc">Description (optional)</Label>
              <Input
                id="group-desc"
                placeholder="e.g., 16-inch large pizzas"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* POS Category Mapping */}
            <div className="space-y-2">
              <Label>POS Categories</Label>
              <p className="text-xs text-muted-foreground">
                Which QUBeyond menu categories count toward this group's units sold?
              </p>
              {posCategories && posCategories.length > 0 ? (
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
                  {posCategories.map(cat => (
                    <label
                      key={cat}
                      className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedPosCategories.includes(cat)}
                        onCheckedChange={() => togglePosCategory(cat)}
                      />
                      <span className="text-sm">{cat}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No POS data found — categories will appear after sales sync
                </p>
              )}
              {selectedPosCategories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedPosCategories.map(cat => (
                    <Badge key={cat} variant="secondary" className="text-xs">
                      {cat}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={upsertMutation.isPending}
              >
                {editingGroup ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProductGroupsManager;
