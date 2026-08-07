import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical, Edit2, X, Copy, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DndContext, DragEndEvent, closestCenter, useSensor, useSensors, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CopyLogbookCategoryDialog } from "./CopyLogbookCategoryDialog";
import { useAuth } from "@/lib/auth";

interface ManageCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SortableCategoryItemProps {
  category: any;
  onDelete: (id: string) => void;
  onToggleAlert: (id: string, currentValue: boolean) => void;
  onTogglePushNotification: (id: string, currentValue: boolean) => void;
  onToggleActive: (id: string, currentValue: boolean) => void;
  onEditFields: (categoryId: string, fields: any[]) => void;
  onCopyTo: (category: any) => void;
}

function SortableCategoryItem({ category, onDelete, onToggleAlert, onTogglePushNotification, onToggleActive, onEditFields, onCopyTo }: SortableCategoryItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <AccordionItem 
      ref={setNodeRef} 
      style={style} 
      value={category.id} 
      className="border rounded-lg px-3"
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        
        <AccordionTrigger className="flex-1 hover:no-underline py-3">
          <div className="flex items-center justify-between w-full pr-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{category.name}</span>
              <Badge variant="secondary" className="text-xs">
                {category.logbook_fields?.length || 0} fields
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {!category.is_active && (
                <Badge variant="outline">Inactive</Badge>
              )}
              {category.alert_enabled && (
                <Badge variant="outline" className="text-xs">Alert</Badge>
              )}
            </div>
          </div>
        </AccordionTrigger>

        <div>
          <DropdownMenu
            modal={false}
            onOpenChange={(open) => {
              console.log("[Logbook Categories] dropdown open:", open, "category:", category?.id);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative z-20"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  console.log("[Logbook Categories] dots pointerdown", category?.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  console.log("[Logbook Categories] dots clicked", category?.id);
                }}
                aria-label={`Category actions for ${category.name}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="bg-popover text-popover-foreground border border-border shadow-xl"
            >
              <DropdownMenuItem onSelect={() => onEditFields(category.id, category.logbook_fields || [])}>
                <Edit2 className="h-4 w-4 mr-2" />
                Configure Fields
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCopyTo(category)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy to Location...
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (confirm(`Delete "${category.name}"? This will also delete all associated entries.`)) {
                    onDelete(category.id);
                  }
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AccordionContent className="pb-3">
          <div className="space-y-3 pt-2">
          {/* Category Settings */}
          <div className="flex flex-col gap-2 p-2 bg-muted rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={category.alert_enabled}
                    onCheckedChange={() => onToggleAlert(category.id, category.alert_enabled)}
                  />
                  <Label className="text-xs">Dashboard Alert</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={category.push_notification_enabled}
                    onCheckedChange={() => onTogglePushNotification(category.id, category.push_notification_enabled)}
                  />
                  <Label className="text-xs">Push Notification</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={category.is_active}
                    onCheckedChange={() => onToggleActive(category.id, category.is_active)}
                  />
                  <Label className="text-xs">Active</Label>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEditFields(category.id, category.logbook_fields || [])}
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Configure Fields
              </Button>
            </div>
          </div>

          {/* Show current fields */}
          {category.logbook_fields && category.logbook_fields.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Current Fields:</Label>
              <div className="grid grid-cols-2 gap-2">
                {category.logbook_fields.map((field: any) => (
                  <div key={field.id} className="text-xs p-2 bg-muted/50 rounded">
                    <span className="font-medium">{field.field_name}</span>
                    <span className="text-muted-foreground"> • {field.field_type}</span>
                    {field.is_required && <Badge variant="secondary" className="ml-1 text-[10px]">Required</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function ManageCategoriesDialog({ open, onOpenChange }: ManageCategoriesDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentLocation, locations } = useAppLocation();
  const { user } = useAuth();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<any[]>([]);
  const [localCategories, setLocalCategories] = useState<any[]>([]);
  const [copyTargetLocationId, setCopyTargetLocationId] = useState<string>("");
  const [isCopying, setIsCopying] = useState(false);
  const [targetExistingCategories, setTargetExistingCategories] = useState<string[]>([]);
  const [copyCategoryDialogOpen, setCopyCategoryDialogOpen] = useState(false);
  const [copyAllMode, setCopyAllMode] = useState(false);
  const [categoryToCopy, setCategoryToCopy] = useState<any>(null);
  const [safeTarget, setSafeTarget] = useState<number>(300);
  const [drawerBank, setDrawerBank] = useState<number>(200);
  const [amSafeCountWindow, setAmSafeCountWindow] = useState<number>(120);
  const [pmSafeCountWindow, setPmSafeCountWindow] = useState<number>(120);
  const [drawerCountNotifications, setDrawerCountNotifications] = useState<boolean>(true);
  const [safeCountNotifications, setSafeCountNotifications] = useState<boolean>(true);
  const [bankVerification, setBankVerification] = useState<boolean>(false);

  // Fetch location settings for cash handling values
  const { data: locationSettings } = useQuery({
    queryKey: ['location-settings-cash', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return null;
      const { data, error } = await supabase
        .from('location_settings')
        .select('safe_target, drawer_bank, am_safe_count_window_minutes, pm_safe_count_window_minutes, drawer_count_notifications_enabled, safe_count_notifications_enabled, bank_verification_enabled')
        .eq('location_id', currentLocation.id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setSafeTarget(data.safe_target ?? 300);
        setDrawerBank(data.drawer_bank ?? 200);
        setAmSafeCountWindow(data.am_safe_count_window_minutes ?? 120);
        setPmSafeCountWindow(data.pm_safe_count_window_minutes ?? 120);
        setDrawerCountNotifications(data.drawer_count_notifications_enabled ?? true);
        setSafeCountNotifications(data.safe_count_notifications_enabled ?? true);
        setBankVerification(data.bank_verification_enabled ?? false);
      }
      return data;
    },
    enabled: open && !!currentLocation,
  });


  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    })
  );

  const { data: categories = [] } = useQuery({
    queryKey: ['logbook-categories-manage', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('logbook_categories')
        .select(`
          *,
          logbook_fields(*)
        `)
        .eq('location_id', currentLocation.id)
        .order('display_order');
      if (error) throw error;
      setLocalCategories(data || []);
      return data;
    },
    enabled: open && !!currentLocation,
  });

  // Sync local categories with fetched data when categories change
  const displayCategories = localCategories.length > 0 ? localCategories : categories;

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!currentLocation) throw new Error("No location selected");
      const maxOrder = Math.max(...displayCategories.map(c => c.display_order), 0);
      const { error } = await supabase
        .from('logbook_categories')
        .insert({
          name,
          display_order: maxOrder + 1,
          is_active: true,
          alert_enabled: false,
          location_id: currentLocation.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Category created successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
      setNewCategoryName("");
    },
    onError: (error: any) => {
      toast({
        title: "Error creating category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase
        .from('logbook_categories')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('logbook_categories')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Category deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;

    const oldIndex = displayCategories.findIndex(c => c.id === active.id);
    const newIndex = displayCategories.findIndex(c => c.id === over.id);

    const reorderedCategories = arrayMove(displayCategories, oldIndex, newIndex);
    
    // Update local state immediately for real-time feedback
    setLocalCategories(reorderedCategories);

    // Update display_order in database
    try {
      await Promise.all(
        reorderedCategories.map((category, index) =>
          supabase
            .from('logbook_categories')
            .update({ display_order: index })
            .eq('id', category.id)
        )
      );
      
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
      toast({ title: "Category order updated" });
    } catch (error) {
      console.error("Error updating category order:", error);
      toast({
        title: "Error updating order",
        variant: "destructive",
      });
      // Revert on error
      setLocalCategories(categories);
    }
  };

  const handleToggleAlert = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { alert_enabled: !currentValue },
    });
  };

  const handleTogglePushNotification = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { push_notification_enabled: !currentValue },
    });
  };

  const handleToggleActive = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { is_active: !currentValue },
    });
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    createCategoryMutation.mutate(newCategoryName);
  };

  const handleEditFields = (categoryId: string, fields: any[]) => {
    setEditingCategoryId(categoryId);
    setEditingFields(fields.map((f, idx) => ({
      ...f,
      tempId: f.id || `temp-${idx}`,
    })));
  };

  const handleAddField = () => {
    setEditingFields([
      ...editingFields,
      {
        tempId: `temp-${Date.now()}`,
        field_name: '',
        field_type: 'text',
        is_required: false,
        display_order: editingFields.length,
      },
    ]);
  };

  const handleUpdateField = (tempId: string, updates: any) => {
    setEditingFields(editingFields.map(f => 
      f.tempId === tempId ? { ...f, ...updates } : f
    ));
  };

  const handleRemoveField = (tempId: string) => {
    setEditingFields(editingFields.filter(f => f.tempId !== tempId));
  };

  const handleSaveFields = async () => {
    if (!editingCategoryId) return;
    
    try {
      // Delete existing fields for this category
      await supabase
        .from('logbook_fields')
        .delete()
        .eq('category_id', editingCategoryId);

      // Insert new fields
      const fieldsToInsert = editingFields.map((field, index) => ({
        category_id: editingCategoryId,
        field_name: field.field_name,
        field_type: field.field_type,
        is_required: field.is_required,
        display_order: index,
        options: field.options ? field.options : null,
      }));

      const { error } = await supabase
        .from('logbook_fields')
        .insert(fieldsToInsert);

      if (error) throw error;

      toast({ title: "Fields saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-fields'] });
      setEditingCategoryId(null);
      setEditingFields([]);
    } catch (error: any) {
      toast({
        title: "Error saving fields",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingCategoryId ? 'Edit Category Fields' : 'Manage Logs Categories'}
          </DialogTitle>
          <DialogDescription>
            {editingCategoryId 
              ? 'Configure the fields for this category' 
              : 'Drag to reorder categories, configure fields, and manage settings'
            }
          </DialogDescription>
        </DialogHeader>

        {editingCategoryId ? (
          /* Field Editor */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Configure Fields for {displayCategories.find(c => c.id === editingCategoryId)?.name}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => {
                setEditingCategoryId(null);
                setEditingFields([]);
              }}>
                <X className="h-4 w-4 mr-2" />
                Back to Categories
              </Button>
            </div>

            {/* Only show field editor for non-cash-handling categories */}
            {(() => {
              const categoryName = displayCategories.find(c => c.id === editingCategoryId)?.name?.toLowerCase();
              const isCashHandling = categoryName === 'safe count' || categoryName === 'drawer count';
              
              if (isCashHandling) {
                return (
                  <div className="text-sm text-muted-foreground p-3 border rounded-lg bg-muted/30">
                    This category uses a specialized form and fields cannot be modified.
                  </div>
                );
              }
              
              return (
                <div className="space-y-3">
                  {editingFields.map((field) => (
                    <div key={field.tempId} className="flex items-start gap-3 p-3 border rounded-lg">
                      <GripVertical className="h-4 w-4 text-muted-foreground mt-2" />
                      
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Field Name</Label>
                          <Input
                            placeholder="e.g., Customer Name"
                            value={field.field_name}
                            onChange={(e) => handleUpdateField(field.tempId, { field_name: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Field Type</Label>
                        <Select
                          value={field.field_type}
                          onValueChange={(value) => handleUpdateField(field.tempId, { field_type: value, options: value === 'dropdown' || value === 'radio' ? [] : undefined })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text (short)</SelectItem>
                            <SelectItem value="textarea">Text Area (long)</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="attachment">File Attachment</SelectItem>
                            <SelectItem value="radio">Radio Buttons</SelectItem>
                            <SelectItem value="dropdown">Dropdown List</SelectItem>
                          </SelectContent>
                        </Select>
                        {(field.field_type === 'radio' || field.field_type === 'dropdown') && (
                          <div className="col-span-2 space-y-2">
                            <Label className="text-xs">Options (one per line)</Label>
                            <Textarea
                              placeholder="Option 1&#10;Option 2&#10;Option 3"
                              value={(field.options || []).join('\n')}
                              onChange={(e) => handleUpdateField(field.tempId, { 
                                options: e.target.value.split('\n').filter(o => o.trim()) 
                              })}
                              rows={3}
                            />
                          </div>
                        )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={field.is_required}
                            onCheckedChange={(checked) => handleUpdateField(field.tempId, { is_required: checked })}
                          />
                          <Label className="text-xs">Required Field</Label>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveField(field.tempId)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Cash Handling Settings - only for Safe Count and Drawer Count categories */}
            {(() => {
              const categoryName = displayCategories.find(c => c.id === editingCategoryId)?.name?.toLowerCase();
              const isSafeCount = categoryName === 'safe count';
              const isDrawerCount = categoryName === 'drawer count';
              
              if (!isSafeCount && !isDrawerCount) return null;
              
              return (
                <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
                  <Label className="text-sm font-medium">Cash Handling Settings</Label>
                  
                  {isSafeCount && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="safe-target" className="text-xs">Safe Target Amount ($)</Label>
                        <Input
                          id="safe-target"
                          type="number"
                          min="0"
                          step="50"
                          value={safeTarget}
                          onChange={(e) => setSafeTarget(parseFloat(e.target.value) || 0)}
                          className="max-w-[200px]"
                        />
                        <p className="text-xs text-muted-foreground">
                          Amount to keep in safe after balancing
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="am-window" className="text-xs">AM Count Window (minutes)</Label>
                          <Input
                            id="am-window"
                            type="number"
                            min="30"
                            max="480"
                            step="15"
                            value={amSafeCountWindow}
                            onChange={(e) => setAmSafeCountWindow(parseInt(e.target.value) || 120)}
                            className="max-w-[150px]"
                          />
                          <p className="text-xs text-muted-foreground">
                            Before/after open time
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="pm-window" className="text-xs">PM Count Window (minutes)</Label>
                          <Input
                            id="pm-window"
                            type="number"
                            min="30"
                            max="480"
                            step="15"
                            value={pmSafeCountWindow}
                            onChange={(e) => setPmSafeCountWindow(parseInt(e.target.value) || 120)}
                            className="max-w-[150px]"
                          />
                          <p className="text-xs text-muted-foreground">
                            After close time
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 pt-2">
                        <Switch
                          checked={safeCountNotifications}
                          onCheckedChange={setSafeCountNotifications}
                        />
                        <Label className="text-xs">Send push notifications on submission</Label>
                      </div>
                    </>
                  )}
                  
                  {isDrawerCount && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="drawer-bank" className="text-xs">Drawer Bank Amount ($)</Label>
                        <Input
                          id="drawer-bank"
                          type="number"
                          min="0"
                          step="50"
                          value={drawerBank}
                          onChange={(e) => setDrawerBank(parseFloat(e.target.value) || 0)}
                          className="max-w-[200px]"
                        />
                        <p className="text-xs text-muted-foreground">
                          Starting drawer amount to keep after deposit
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2 pt-2">
                        <Switch
                          checked={drawerCountNotifications}
                          onCheckedChange={setDrawerCountNotifications}
                        />
                        <Label className="text-xs">Send push notifications on submission</Label>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Bank Verification - only for Bank Deposit category */}
            {(() => {
              const categoryName = displayCategories.find(c => c.id === editingCategoryId)?.name?.toLowerCase() || '';
              if (!categoryName.includes('bank deposit')) return null;

              return (
                <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                  <Label className="text-sm font-medium">Bank Verification</Label>
                  <div className="flex items-center gap-2">
                    <Switch checked={bankVerification} onCheckedChange={setBankVerification} />
                    <Label className="text-xs">Require deposit slip &amp; bank receipt photos</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    When on, each day included in a bank deposit requires a photo of that day's deposit slip,
                    and the total requires a photo of the bank receipt. Photos are kept for one year.
                  </p>
                </div>
              );
            })()}

            <div className="flex gap-2">
              {(() => {
                const categoryName = displayCategories.find(c => c.id === editingCategoryId)?.name?.toLowerCase() || '';
                const isCashHandling = categoryName === 'safe count' || categoryName === 'drawer count';
                const isBankDeposit = categoryName.includes('bank deposit');
                

                
                return (
                  <>
                    {!isCashHandling && (
                      <Button onClick={handleAddField} variant="outline">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Field
                      </Button>
                    )}
                    <Button onClick={async () => {
                      // Save cash handling / bank verification settings if applicable
                      if ((isCashHandling || isBankDeposit) && currentLocation) {
                        try {

                          const { data: existingSettings } = await supabase
                            .from('location_settings')
                            .select('id')
                            .eq('location_id', currentLocation.id)
                            .maybeSingle();
                          
                          const updateData: any = {};
                          if (isBankDeposit) {
                            updateData.bank_verification_enabled = bankVerification;
                          } else if (categoryName === 'safe count') {
                            updateData.safe_target = safeTarget;
                            updateData.am_safe_count_window_minutes = amSafeCountWindow;
                            updateData.pm_safe_count_window_minutes = pmSafeCountWindow;
                            updateData.safe_count_notifications_enabled = safeCountNotifications;
                          } else {
                            updateData.drawer_bank = drawerBank;
                            updateData.drawer_count_notifications_enabled = drawerCountNotifications;
                          }

                          
                          if (existingSettings) {
                            await supabase
                              .from('location_settings')
                              .update(updateData)
                              .eq('location_id', currentLocation.id);
                          } else {
                            await supabase
                              .from('location_settings')
                              .insert({
                                location_id: currentLocation.id,
                                ...updateData,
                              });
                          }
                          queryClient.invalidateQueries({ queryKey: ['location-settings'] });
                          queryClient.invalidateQueries({ queryKey: ['location-settings-cash'] });
                          queryClient.invalidateQueries({ queryKey: ['bank-verification-enabled'] });
                        } catch (error) {
                          console.error('Error saving settings:', error);
                        }
                      }
                      if (!isCashHandling) {
                        handleSaveFields();
                      } else {
                        toast({ title: "Settings saved successfully" });
                        setEditingCategoryId(null);
                        setEditingFields([]);
                      }
                    }}>
                      {isCashHandling ? 'Save Settings' : 'Save Fields'}

                    </Button>
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          /* Category Manager */
          <div className="space-y-4">
            {/* Copy Categories Section */}
            {locations && locations.filter(l => l.id !== currentLocation?.id).length > 0 && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <Label className="text-sm font-medium mb-2 block">Copy All Categories To Another Location</Label>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Select 
                      value={copyTargetLocationId} 
                      onValueChange={async (locationId) => {
                        setCopyTargetLocationId(locationId);
                        // Fetch existing categories at target location
                        if (locationId) {
                          const { data } = await supabase
                            .from('logbook_categories')
                            .select('name')
                            .eq('location_id', locationId);
                          setTargetExistingCategories(data?.map(c => c.name.toLowerCase()) || []);
                        } else {
                          setTargetExistingCategories([]);
                        }
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select destination location..." />
                      </SelectTrigger>
                      <SelectContent>
                        {locations
                          .filter(l => l.id !== currentLocation?.id)
                          .map(location => (
                            <SelectItem key={location.id} value={location.id}>
                              {location.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button 
                      variant="outline"
                      disabled={!copyTargetLocationId || isCopying || displayCategories.length === 0}
                      onClick={async () => {
                        if (!copyTargetLocationId || !user) return;
                        setIsCopying(true);
                        try {
                          for (const category of displayCategories) {
                            const categoryNameLower = category.name.toLowerCase();
                            
                            // Check if category exists at target - if so, delete it first
                            if (targetExistingCategories.includes(categoryNameLower)) {
                              const { data: existingCat } = await supabase
                                .from('logbook_categories')
                                .select('id')
                                .eq('location_id', copyTargetLocationId)
                                .ilike('name', category.name)
                                .single();
                              
                              if (existingCat) {
                                await supabase
                                  .from('logbook_categories')
                                  .delete()
                                  .eq('id', existingCat.id);
                              }
                            }
                            
                            // Create category in target location
                            const { data: newCategory, error: catError } = await supabase
                              .from('logbook_categories')
                              .insert({
                                name: category.name,
                                display_order: category.display_order,
                                is_active: category.is_active,
                                alert_enabled: category.alert_enabled,
                                push_notification_enabled: category.push_notification_enabled,
                                location_id: copyTargetLocationId,
                                created_by: user.id
                              })
                              .select()
                              .single();
                            
                            if (catError) throw catError;
                            
                            // Copy fields for this category
                            if (category.logbook_fields && category.logbook_fields.length > 0) {
                              const fieldsToInsert = category.logbook_fields.map((field: any) => ({
                                category_id: newCategory.id,
                                field_name: field.field_name,
                                field_type: field.field_type,
                                is_required: field.is_required,
                                display_order: field.display_order
                              }));
                              
                              const { error: fieldsError } = await supabase
                                .from('logbook_fields')
                                .insert(fieldsToInsert);
                              
                              if (fieldsError) throw fieldsError;
                            }
                          }
                          
                          const replacedCount = displayCategories.filter(c => 
                            targetExistingCategories.includes(c.name.toLowerCase())
                          ).length;
                          const createdCount = displayCategories.length - replacedCount;
                          
                          toast({ 
                            title: `Copied ${displayCategories.length} categories`,
                            description: replacedCount > 0 
                              ? `${createdCount} created, ${replacedCount} replaced`
                              : undefined
                          });
                          setCopyTargetLocationId("");
                          setTargetExistingCategories([]);
                          queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
                        } catch (error: any) {
                          toast({
                            title: "Error copying categories",
                            description: error.message,
                            variant: "destructive"
                          });
                        } finally {
                          setIsCopying(false);
                        }
                      }}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      {isCopying ? 'Copying...' : 'Copy'}
                    </Button>
                  </div>
                  
                  {/* Preview of what will happen */}
                  {copyTargetLocationId && displayCategories.length > 0 && (
                    <div className="text-xs space-y-1">
                      {(() => {
                        const willReplace = displayCategories.filter(c => 
                          targetExistingCategories.includes(c.name.toLowerCase())
                        );
                        const willCreate = displayCategories.filter(c => 
                          !targetExistingCategories.includes(c.name.toLowerCase())
                        );
                        
                        return (
                          <>
                            {willCreate.length > 0 && (
                              <p className="text-muted-foreground">
                                <span className="text-green-600 font-medium">Will create:</span>{' '}
                                {willCreate.map(c => c.name).join(', ')}
                              </p>
                            )}
                            {willReplace.length > 0 && (
                              <p className="text-muted-foreground">
                                <span className="text-amber-600 font-medium">Will replace:</span>{' '}
                                {willReplace.map(c => c.name).join(', ')}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Create New Category + Copy All */}
            <div className="flex gap-2">
              <Input
                placeholder="New category name..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleCreateCategory()}
              />
              <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
              {displayCategories.length > 0 && (
                <Button variant="outline" onClick={() => {
                  setCopyAllMode(true);
                  setCategoryToCopy(null);
                  setCopyCategoryDialogOpen(true);
                }}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy All
                </Button>
              )}
            </div>

            {/* Categories List with Drag & Drop */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayCategories.map(c => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <Accordion type="single" collapsible className="space-y-2">
                  {displayCategories.map((category: any) => (
                    <SortableCategoryItem
                      key={category.id}
                      category={category}
                      onDelete={(id) => deleteCategoryMutation.mutate(id)}
                      onToggleAlert={handleToggleAlert}
                      onTogglePushNotification={handleTogglePushNotification}
                      onToggleActive={handleToggleActive}
                      onEditFields={handleEditFields}
                      onCopyTo={(cat) => {
                        setCategoryToCopy(cat);
                        setCopyCategoryDialogOpen(true);
                      }}
                    />
                  ))}
                </Accordion>
              </SortableContext>
            </DndContext>
          </div>
        )}
        
        <CopyLogbookCategoryDialog
          open={copyCategoryDialogOpen}
          onOpenChange={(open) => {
            setCopyCategoryDialogOpen(open);
            if (!open) setCopyAllMode(false);
          }}
          category={!copyAllMode ? categoryToCopy : undefined}
          categories={copyAllMode ? displayCategories : undefined}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
