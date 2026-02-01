import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface DocumentItem {
  id: string;
  content: string;
  children: DocumentItem[];
}

interface ReadAndSignFormProps {
  locationId: string;
  employees: { id: string; full_name: string; profile_photo_url?: string }[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function ReadAndSignForm({ locationId, employees, onSuccess, onCancel }: ReadAndSignFormProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [listStyle, setListStyle] = useState<"numbered" | "bulleted" | "checklist">("numbered");
  const [items, setItems] = useState<DocumentItem[]>([{ id: crypto.randomUUID(), content: "", children: [] }]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const addItem = () => {
    setItems([...items, { id: crypto.randomUUID(), content: "", children: [] }]);
  };

  const addSubItem = (parentId: string) => {
    setItems(items.map(item => {
      if (item.id === parentId) {
        return {
          ...item,
          children: [...item.children, { id: crypto.randomUUID(), content: "", children: [] }]
        };
      }
      return item;
    }));
    // Auto-expand parent when adding child
    setExpandedItems(new Set([...expandedItems, parentId]));
  };

  const updateItem = (id: string, content: string, parentId?: string) => {
    if (parentId) {
      setItems(items.map(item => {
        if (item.id === parentId) {
          return {
            ...item,
            children: item.children.map(child => 
              child.id === id ? { ...child, content } : child
            )
          };
        }
        return item;
      }));
    } else {
      setItems(items.map(item => item.id === id ? { ...item, content } : item));
    }
  };

  const removeItem = (id: string, parentId?: string) => {
    if (parentId) {
      setItems(items.map(item => {
        if (item.id === parentId) {
          return {
            ...item,
            children: item.children.filter(child => child.id !== id)
          };
        }
        return item;
      }));
    } else {
      if (items.length > 1) {
        setItems(items.filter(item => item.id !== id));
      }
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedEmployees(employees.map(e => e.id));
    } else {
      setSelectedEmployees([]);
    }
  };

  const toggleEmployee = (employeeId: string) => {
    if (selectedEmployees.includes(employeeId)) {
      setSelectedEmployees(selectedEmployees.filter(id => id !== employeeId));
      setSelectAll(false);
    } else {
      const newSelected = [...selectedEmployees, employeeId];
      setSelectedEmployees(newSelected);
      if (newSelected.length === employees.length) {
        setSelectAll(true);
      }
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    const validItems = items.filter(item => item.content.trim());
    if (validItems.length === 0) {
      toast.error("Please add at least one item");
      return;
    }

    if (selectedEmployees.length === 0) {
      toast.error("Please select at least one employee");
      return;
    }

    setSaving(true);
    try {
      // Create document
      const { data: doc, error: docError } = await supabase
        .from("read_and_sign_documents")
        .insert({
          title: title.trim(),
          list_style: listStyle,
          location_id: locationId,
          created_by: user?.id,
        })
        .select()
        .single();

      if (docError) throw docError;

      // First insert parent items
      const parentItems = validItems.filter(item => item.content.trim()).map((item, idx) => ({
        document_id: doc.id,
        parent_id: null,
        content: item.content,
        order_index: idx,
      }));

      const { data: insertedParents, error: parentError } = await supabase
        .from("read_and_sign_items")
        .insert(parentItems)
        .select();

      if (parentError) throw parentError;

      // Now insert children with parent_id
      const childItems: { document_id: string; parent_id: string; content: string; order_index: number }[] = [];
      validItems.forEach((item, parentIdx) => {
        const parentDbRow = insertedParents?.find((_, idx) => idx === parentIdx);
        if (parentDbRow) {
          item.children.filter(c => c.content.trim()).forEach((child, childIdx) => {
            childItems.push({
              document_id: doc.id,
              parent_id: parentDbRow.id,
              content: child.content,
              order_index: childIdx,
            });
          });
        }
      });

      if (childItems.length > 0) {
        const { error: childError } = await supabase
          .from("read_and_sign_items")
          .insert(childItems);

        if (childError) throw childError;
      }

      // Create assignments for selected employees
      const assignments = selectedEmployees.map(employeeId => ({
        document_id: doc.id,
        employee_id: employeeId,
      }));

      const { error: assignError } = await supabase
        .from("read_and_sign_assignments")
        .insert(assignments);

      if (assignError) throw assignError;

      toast.success(`Document sent to ${selectedEmployees.length} employee(s)`);
      onSuccess();
    } catch (error: any) {
      console.error("Error creating read & sign document:", error);
      toast.error(error.message || "Failed to create document");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col space-y-6 pb-6">
      {/* Title */}
      <div className="space-y-2">
        <Label>Document Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., New Cleaning Procedures"
        />
      </div>

      {/* List Style */}
      <div className="space-y-2">
        <Label>List Style</Label>
        <Select value={listStyle} onValueChange={(v) => setListStyle(v as any)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="numbered">Numbered (1, 2, 3...)</SelectItem>
            <SelectItem value="bulleted">Bulleted (•)</SelectItem>
            <SelectItem value="checklist">Checklist (☐)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Items */}
      <div className="space-y-3">
        <Label>Document Items</Label>
        {items.map((item, index) => (
          <div key={item.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-muted-foreground min-w-[32px]">
                {item.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.id)}
                    className="p-0.5 hover:bg-muted rounded"
                  >
                    {expandedItems.has(item.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                )}
                <span className="text-sm font-medium">{index + 1}.</span>
              </div>
              <Textarea
                value={item.content}
                onChange={(e) => updateItem(item.id, e.target.value)}
                placeholder="Enter item text..."
                className="min-h-[60px] flex-1"
              />
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => addSubItem(item.id)}
                  title="Add sub-item"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                {items.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(item.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Sub-items */}
            {item.children.length > 0 && (
              <div className="ml-10 space-y-2 border-l-2 border-muted pl-4">
                {item.children.map((child, childIndex) => (
                  <div key={child.id} className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground min-w-[24px]">
                      {String.fromCharCode(97 + childIndex)}.
                    </span>
                    <Input
                      value={child.content}
                      onChange={(e) => updateItem(child.id, e.target.value, item.id)}
                      placeholder="Sub-item text..."
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(child.id, item.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" onClick={addItem} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Add Item
        </Button>
      </div>

      {/* Employee Selection */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Assign to Employees</Label>
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all"
              checked={selectAll}
              onCheckedChange={handleSelectAll}
            />
            <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
              Select All ({employees.length})
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto border rounded-lg p-3">
          {employees.map((employee) => (
            <div key={employee.id} className="flex items-center gap-2">
              <Checkbox
                id={`emp-${employee.id}`}
                checked={selectedEmployees.includes(employee.id)}
                onCheckedChange={() => toggleEmployee(employee.id)}
              />
              <label
                htmlFor={`emp-${employee.id}`}
                className="text-sm cursor-pointer truncate"
              >
                {employee.full_name || "Unknown"}
              </label>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedEmployees.length} employee(s) selected
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        <Button variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving} className="flex-1">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            "Send to Employees"
          )}
        </Button>
      </div>
    </div>
  );
}
