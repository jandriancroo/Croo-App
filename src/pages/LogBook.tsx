import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Paperclip, Search, User, Settings, MoreVertical, Trash2, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { useUserRole } from "@/hooks/useUserRole";
import { ManageCategoriesDialog } from "@/components/logbook/ManageCategoriesDialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { compressImage } from "@/utils/imageCompression";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { DrawerCountForm, DrawerCountData } from "@/components/logbook/DrawerCountForm";
import { DrawerCountEntry, parseDrawerCountData } from "@/components/logbook/DrawerCountEntry";
import { SafeCountForm, SafeCountData } from "@/components/logbook/SafeCountForm";
import { SafeCountEntry, parseSafeCountData } from "@/components/logbook/SafeCountEntry";
import { CateringOrdersSection } from "@/components/logbook/CateringOrdersSection";

// Helper to get date string in PST timezone (YYYY-MM-DD format)
const getDateInPST = (date: Date): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
};

export default function LogBook() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isManager, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<string>("entry");
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Redirect team members away from logs page
  useEffect(() => {
    if (!roleLoading && !isAdmin && !isManager) {
      toast({ title: "Access denied", description: "You don't have permission to view logs", variant: "destructive" });
      navigate('/dashboard');
    }
  }, [roleLoading, isAdmin, isManager, navigate, toast]);

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['logbook-categories', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('logbook_categories')
        .select('*')
        .eq('is_active', true)
        .eq('location_id', currentLocation.id)
        .order('display_order');
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
  });

  // Set initial category
  useEffect(() => {
    if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, selectedCategory]);

  // Handle navigation from alert link
  useEffect(() => {
    const fromAlert = searchParams.get('fromAlert');
    if (fromAlert === 'true') {
      setActiveTab('search');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  // Fetch fields for selected category
  const { data: fields = [] } = useQuery({
    queryKey: ['logbook-fields', selectedCategory],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('logbook_fields')
        .select('*')
        .eq('category_id', selectedCategory)
        .order('display_order');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCategory,
  });

  // Fetch entry for selected date and category
  const { data: entry } = useQuery({
    queryKey: ['logbook-entry', selectedCategory, getDateInPST(selectedDate)],
    queryFn: async () => {
      const dateStr = getDateInPST(selectedDate);
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`
          *,
          logbook_entry_values(*),
          profiles(full_name, profile_photo_url)
        `)
        .eq('category_id', selectedCategory)
        .eq('entry_date', dateStr)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!selectedCategory,
  });

  // Fetch all entries for search
  const { data: allEntries = [] } = useQuery({
    queryKey: ['logbook-all-entries', searchQuery, currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      let query = supabase
        .from('logbook_entries')
        .select(`
          *,
          logbook_entry_values(*),
          profiles(full_name, profile_photo_url),
          logbook_categories(name)
        `)
        .eq('location_id', currentLocation.id)
        .order('entry_date', { ascending: false })
        .limit(50);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
  });

  // Find safe count category ID
  const safeCountCategoryId = categories.find((c: any) => c.name?.toLowerCase() === 'safe count')?.id;
  const drawerCountCategoryId = categories.find((c: any) => c.name?.toLowerCase() === 'drawer count')?.id;

  // Fetch safe count entries for selected date
  const { data: safeCountEntries = [] } = useQuery({
    queryKey: ['safe-count-entries', safeCountCategoryId, getDateInPST(selectedDate), currentLocation?.id],
    queryFn: async () => {
      if (!safeCountCategoryId || !currentLocation) return [];
      const dateStr = getDateInPST(selectedDate);
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*)`)
        .eq('category_id', safeCountCategoryId)
        .eq('entry_date', dateStr)
        .eq('location_id', currentLocation.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!safeCountCategoryId && !!currentLocation,
  });

  // Fetch drawer count entries for selected date
  const { data: drawerCountEntries = [] } = useQuery({
    queryKey: ['drawer-count-entries', drawerCountCategoryId, getDateInPST(selectedDate), currentLocation?.id],
    queryFn: async () => {
      if (!drawerCountCategoryId || !currentLocation) return [];
      const dateStr = getDateInPST(selectedDate);
      const { data, error } = await supabase
        .from('logbook_entries')
        .select(`*, logbook_entry_values(*)`)
        .eq('category_id', drawerCountCategoryId)
        .eq('entry_date', dateStr)
        .eq('location_id', currentLocation.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!drawerCountCategoryId && !!currentLocation,
  });

  // Get existing shifts from safe count entries
  const existingSafeCountShifts: ('AM' | 'PM')[] = safeCountEntries
    .map((entry: any) => {
      try {
        const data = JSON.parse(entry.logbook_entry_values?.[0]?.value_text || '{}');
        return data.shift as 'AM' | 'PM';
      } catch {
        return null;
      }
    })
    .filter((shift): shift is 'AM' | 'PM' => shift === 'AM' || shift === 'PM');

  const [formData, setFormData] = useState<Record<string, any>>({});

  // Handle file upload
  const handleFileUpload = async (fieldId: string, file: File) => {
    try {
      setUploadingFiles({ ...uploadingFiles, [fieldId]: true });
      
      // Compress images to reduce memory usage on mobile
      let fileToUpload: File | Blob = file;
      let fileName = `${user!.id}/${Date.now()}.${file.name.split('.').pop()}`;
      
      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.8);
        fileName = `${user!.id}/${Date.now()}.jpg`;
      }
      
      const { error: uploadError } = await supabase.storage
        .from('logbook-attachments')
        .upload(fileName, fileToUpload);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('logbook-attachments')
        .getPublicUrl(fileName);

      setFormData({ ...formData, [fieldId]: publicUrl });
      toast({ title: "File uploaded successfully" });
    } catch (error: any) {
      toast({
        title: "Error uploading file",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploadingFiles({ ...uploadingFiles, [fieldId]: false });
    }
  };

  // Save entry mutation
  const saveEntryMutation = useMutation({
    mutationFn: async () => {
      const dateStr = getDateInPST(selectedDate);
      
      // Create or update entry
      const { data: entryData, error: entryError } = await supabase
        .from('logbook_entries')
        .upsert({
          category_id: selectedCategory,
          entry_date: dateStr,
          created_by: user!.id,
          location_id: currentLocation?.id,
        }, {
          onConflict: 'category_id,entry_date'
        })
        .select()
        .single();

      if (entryError) throw entryError;

      // Delete existing values
      await supabase
        .from('logbook_entry_values')
        .delete()
        .eq('entry_id', entryData.id);

      // Insert new values
      const values = fields.map((field: any) => ({
        entry_id: entryData.id,
        field_id: field.id,
        value_text: field.field_type === 'text' || field.field_type === 'textarea' ? formData[field.id] : null,
        value_number: field.field_type === 'number' ? formData[field.id] : null,
        value_date: field.field_type === 'date' ? formData[field.id] : null,
        attachment_url: field.field_type === 'attachment' ? formData[field.id] : null,
      }));

      const { error: valuesError } = await supabase
        .from('logbook_entry_values')
        .insert(values);

      if (valuesError) throw valuesError;

      // Check if category has push notifications enabled and send notification
      const currentCategory = categories.find((c: any) => c.id === selectedCategory);
      if (currentCategory?.push_notification_enabled && currentLocation) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              notification_type: 'logbook_entry',
              title: `New Log Entry - ${currentLocation.name}`,
              body: `${currentCategory.name} entry submitted`,
              location_id: currentLocation.id,
              roles: ['admin', 'manager', 'general_manager', 'shift_manager'],
            }
          });
        } catch (notifError) {
          console.error('Failed to send push notification:', notifError);
        }
      }
    },
    onSuccess: () => {
      toast({ title: "Entry saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
      setFormData({});
    },
    onError: (error: any) => {
      toast({
        title: "Error saving entry",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveEntryMutation.mutate();
  };

  // Delete entry mutation
  const deleteEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      // First delete the entry values
      const { error: valuesError } = await supabase
        .from('logbook_entry_values')
        .delete()
        .eq('entry_id', entryId);

      if (valuesError) throw valuesError;

      // Then delete the entry
      const { error: entryError } = await supabase
        .from('logbook_entries')
        .delete()
        .eq('id', entryId);

      if (entryError) throw entryError;
    },
    onSuccess: () => {
      toast({ title: "Entry deleted" });
      queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
      setDeleteEntryId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting entry",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Follow-up completion mutation
  const followupMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from('logbook_entries')
        .update({
          followup_completed_at: new Date().toISOString(),
          followup_completed_by: user?.id,
        })
        .eq('id', entryId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Follow-up completed" });
      queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating follow-up",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filteredEntries = allEntries.filter((entry: any) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      entry.profiles?.full_name?.toLowerCase().includes(searchLower) ||
      entry.logbook_categories?.name?.toLowerCase().includes(searchLower) ||
      entry.logbook_entry_values?.some((val: any) => 
        val.value_text?.toLowerCase().includes(searchLower)
      )
    );
  });

  // Group entries by day
  const entriesByDay = filteredEntries.reduce((acc: any, entry: any) => {
    const dateKey = format(new Date(entry.entry_date), 'yyyy-MM-dd');
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(entry);
    return acc;
  }, {});

  const sortedDays = Object.keys(entriesByDay).sort((a, b) => b.localeCompare(a));

  // Don't render if role is still loading or user doesn't have access
  if (roleLoading || (!isAdmin && !isManager)) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto p-4 md:p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <h1 className="text-3xl font-bold">Logs</h1>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setManageCategoriesOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Manage Categories
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <TabsList>
              <TabsTrigger value="entry">New Entry</TabsTrigger>
              <TabsTrigger value="search">Search Entries</TabsTrigger>
            </TabsList>
            <Button 
              variant={activeTab === 'catering' ? 'default' : 'outline'}
              onClick={() => setActiveTab('catering')}
              className={activeTab === 'catering' ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'border-orange-500 text-orange-500 hover:bg-orange-500/10'}
            >
              🍽️ Catering Orders
            </Button>
          </div>

          <TabsContent value="entry" className="space-y-4">
            {/* Category Selection - Dropdown on mobile/tablet, Tabs on desktop */}
            {isMobile ? (
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category: any) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
                <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
                  {categories.map((category: any) => (
                    <TabsTrigger key={category.id} value={category.id} className="text-xs sm:text-sm whitespace-nowrap">
                      {category.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}

            {/* Check if this is a specialized category */}
            {(() => {
              const currentCategoryName = categories.find((c: any) => c.id === selectedCategory)?.name?.toLowerCase();
              const isDrawerCount = currentCategoryName === 'drawer count';
              const isSafeCount = currentCategoryName === 'safe count';
              
              if (isDrawerCount) {
                return (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <h2 className="text-lg font-semibold">Drawer Count</h2>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full sm:w-auto">
                            <CalendarIcon className="h-4 w-4 mr-2" />
                            <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(date) => date && setSelectedDate(date)}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    {entry && (
                      <p className="text-xs text-muted-foreground">
                        Last entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
                      </p>
                    )}
                    <DrawerCountForm
                      key={selectedDate.toISOString().split('T')[0]}
                      onSave={async (data: DrawerCountData) => {
                        try {
                          const dateStr = selectedDate.toISOString().split('T')[0];
                          
                          // Ensure a field exists for drawer count data
                          let fieldId = fields[0]?.id;
                          
                          if (!fieldId) {
                            // Auto-create a field for drawer count if none exists
                            const { data: newField, error: fieldError } = await supabase
                              .from('logbook_fields')
                              .insert({
                                category_id: selectedCategory,
                                field_name: 'drawer_data',
                                field_type: 'text',
                                display_order: 0,
                                is_required: false,
                              })
                              .select()
                              .single();
                            
                            if (fieldError) throw fieldError;
                            fieldId = newField.id;
                            
                            // Invalidate fields query to refresh
                            queryClient.invalidateQueries({ queryKey: ['logbook-fields', selectedCategory] });
                          }
                          
                          // Create or update entry
                          const { data: entryData, error: entryError } = await supabase
                            .from('logbook_entries')
                            .upsert({
                              category_id: selectedCategory,
                              entry_date: dateStr,
                              created_by: user!.id,
                              location_id: currentLocation?.id,
                            }, {
                              onConflict: 'category_id,entry_date'
                            })
                            .select()
                            .single();

                          if (entryError) throw entryError;

                          // Delete existing values
                          await supabase
                            .from('logbook_entry_values')
                            .delete()
                            .eq('entry_id', entryData.id);

                          // Store drawer count data as JSON in a single text value
                          const { error: valuesError } = await supabase
                            .from('logbook_entry_values')
                            .insert({
                              entry_id: entryData.id,
                              field_id: fieldId,
                              value_text: JSON.stringify(data),
                            });

                          if (valuesError) throw valuesError;

                          toast({ title: "Drawer count saved successfully" });
                          queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
                          queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
                          queryClient.invalidateQueries({ queryKey: ['drawer-count-entries'] });

                          // Send push notification to managers/admins
                          try {
                            const overUnderText = data.variance > 0 
                              ? `OVER $${data.variance.toFixed(2)}` 
                              : data.variance < 0 
                                ? `SHORT $${Math.abs(data.variance).toFixed(2)}`
                                : 'BALANCED';
                            
                            await supabase.functions.invoke('send-push-notification', {
                              body: {
                                notification_type: 'drawer_count',
                                title: `Drawer Count - ${currentLocation?.name || 'Location'}`,
                                body: `Deposit: $${data.actualDeposit.toFixed(2)} | ${overUnderText}`,
                                location_id: currentLocation?.id,
                                roles: ['admin', 'general_manager', 'shift_manager', 'manager', 'super_admin'],
                              }
                            });
                          } catch (notifError) {
                            console.error('Error sending drawer count notification:', notifError);
                          }
                        } catch (error: any) {
                          toast({
                            title: "Error saving drawer count",
                            description: error.message,
                            variant: "destructive",
                          });
                        }
                      }}
                      isSaving={saveEntryMutation.isPending}
                      existingData={entry?.logbook_entry_values?.[0]?.value_text 
                        ? JSON.parse(entry.logbook_entry_values[0].value_text) 
                        : null}
                      entryCount={drawerCountEntries.length}
                    />
                  </div>
                );
              }

              if (isSafeCount) {
                return (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <h2 className="text-lg font-semibold">Safe Count</h2>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full sm:w-auto">
                            <CalendarIcon className="h-4 w-4 mr-2" />
                            <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(date) => date && setSelectedDate(date)}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    {entry && (
                      <p className="text-xs text-muted-foreground">
                        Last entry by {entry.profiles?.full_name} at {format(new Date(entry.created_at), 'PPp')}
                      </p>
                    )}
                    <SafeCountForm
                      key={`${selectedDate.toISOString().split('T')[0]}`}
                      onSave={async (data: SafeCountData) => {
                        try {
                          const dateStr = selectedDate.toISOString().split('T')[0];
                          
                          // Ensure a field exists for safe count data
                          let fieldId = fields[0]?.id;
                          
                          if (!fieldId) {
                            const { data: newField, error: fieldError } = await supabase
                              .from('logbook_fields')
                              .insert({
                                category_id: selectedCategory,
                                field_name: 'safe_data',
                                field_type: 'text',
                                display_order: 0,
                                is_required: false,
                              })
                              .select()
                              .single();
                            
                            if (fieldError) throw fieldError;
                            fieldId = newField.id;
                            queryClient.invalidateQueries({ queryKey: ['logbook-fields', selectedCategory] });
                          }
                          
                          // Create entry
                          const { data: entryData, error: entryError } = await supabase
                            .from('logbook_entries')
                            .insert({
                              category_id: selectedCategory,
                              entry_date: dateStr,
                              created_by: user!.id,
                              location_id: currentLocation?.id,
                            })
                            .select()
                            .single();

                          if (entryError) throw entryError;

                          // Store safe count data as JSON
                          const { error: valuesError } = await supabase
                            .from('logbook_entry_values')
                            .insert({
                              entry_id: entryData.id,
                              field_id: fieldId,
                              value_text: JSON.stringify(data),
                            });

                          if (valuesError) throw valuesError;

                          toast({ title: "Safe count saved successfully" });
                          queryClient.invalidateQueries({ queryKey: ['logbook-entry'] });
                          queryClient.invalidateQueries({ queryKey: ['logbook-all-entries'] });
                          queryClient.invalidateQueries({ queryKey: ['safe-count-entries'] });

                          // Send push notification to managers/admins
                          try {
                            await supabase.functions.invoke('send-push-notification', {
                              body: {
                                notification_type: 'safe_count',
                                title: `Safe Count - ${currentLocation?.name || 'Location'}`,
                                body: `${data.shift} Safe Count Complete - $${data.totalSafe.toFixed(2)} balanced`,
                                location_id: currentLocation?.id,
                                roles: ['admin', 'general_manager', 'shift_manager', 'manager', 'super_admin'],
                              }
                            });
                          } catch (notifError) {
                            console.error('Error sending safe count notification:', notifError);
                          }
                        } catch (error: any) {
                          toast({
                            title: "Error saving safe count",
                            description: error.message,
                            variant: "destructive",
                          });
                        }
                      }}
                      isSaving={saveEntryMutation.isPending}
                      existingShifts={existingSafeCountShifts}
                    />
                  </div>
                );
              }
              
              // Default generic form
              return (
                <Card>
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <CardTitle className="text-base sm:text-lg">
                        {categories.find((c: any) => c.id === selectedCategory)?.name}
                      </CardTitle>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full sm:w-auto">
                            <CalendarIcon className="h-4 w-4 mr-2" />
                            <span className="text-xs sm:text-sm">{format(selectedDate, 'PPP')}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(date) => date && setSelectedDate(date)}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <CardDescription className="text-xs sm:text-sm">
                      {entry ? `Entry by ${entry.profiles?.full_name} at ${format(new Date(entry.created_at), 'PPp')}` : 'No entry for this date'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      {fields.map((field: any) => (
                        <div key={field.id} className="space-y-2">
                          <Label>
                            {field.field_name}
                            {field.is_required && <span className="text-destructive ml-1">*</span>}
                          </Label>
                          {field.field_type === 'text' && (
                            <Input
                              value={formData[field.id] || ''}
                              onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                              required={field.is_required}
                            />
                          )}
                          {field.field_type === 'textarea' && (
                            <Textarea
                              value={formData[field.id] || ''}
                              onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                              required={field.is_required}
                            />
                          )}
                          {field.field_type === 'number' && (
                            <Input
                              type="number"
                              value={formData[field.id] || ''}
                              onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                              required={field.is_required}
                            />
                          )}
                          {field.field_type === 'date' && (
                            <Input
                              type="date"
                              value={formData[field.id] || ''}
                              onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                              required={field.is_required}
                            />
                          )}
                          {field.field_type === 'attachment' && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Input
                                  type="file"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      handleFileUpload(field.id, file);
                                    }
                                  }}
                                  disabled={uploadingFiles[field.id]}
                                />
                                <Paperclip className="h-4 w-4 text-muted-foreground" />
                              </div>
                              {uploadingFiles[field.id] && (
                                <p className="text-xs text-muted-foreground">Uploading...</p>
                              )}
                              {formData[field.id] && !uploadingFiles[field.id] && (
                                <a 
                                  href={formData[field.id]} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline"
                                >
                                  View uploaded file
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      <Button type="submit" disabled={saveEntryMutation.isPending}>
                        {saveEntryMutation.isPending ? 'Saving...' : 'Add Entry'}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              );
            })()}
          </TabsContent>

          <TabsContent value="search" className="space-y-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>

            <div className="space-y-6">
              {sortedDays.map((dateKey) => (
                <div key={dateKey} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-background py-2">
                    {format(new Date(dateKey), 'EEEE, MMMM d, yyyy')}
                  </h3>
                  <div className="space-y-2">
                    {entriesByDay[dateKey].map((entry: any) => (
                      <Card key={entry.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Avatar>
                              <AvatarImage src={entry.profiles?.profile_photo_url} />
                              <AvatarFallback>
                                <User className="h-4 w-4" />
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium">{entry.profiles?.full_name}</div>
                                  <div className="text-sm text-muted-foreground">
                                    {entry.logbook_categories?.name}
                                  </div>
                                </div>
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-muted-foreground">
                                  {format(new Date(entry.created_at), 'h:mm a')}
                                </div>
                                {(isAdmin || isManager || entry.created_by === user?.id) && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem 
                                        onClick={() => {
                                          // Set up for editing: switch to entry tab, select category and date
                                          setSelectedCategory(entry.category_id);
                                          setSelectedDate(new Date(entry.entry_date));
                                          // Pre-fill form data from existing values
                                          const existingData: Record<string, any> = {};
                                          entry.logbook_entry_values?.forEach((val: any) => {
                                            existingData[val.field_id] = val.value_text || val.value_number || val.value_date || val.attachment_url;
                                          });
                                          setFormData(existingData);
                                          setActiveTab('entry');
                                          toast({ title: "Edit mode", description: "Update the entry and save" });
                                        }}
                                      >
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => setDeleteEntryId(entry.id)}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                              </div>
                              <div className="mt-2 space-y-1">
                                {entry.logbook_entry_values?.map((val: any) => {
                                  // Check if this is drawer count data
                                  const drawerData = val.value_text ? parseDrawerCountData(val.value_text) : null;
                                  if (drawerData && drawerData.actualDeposit !== undefined) {
                                    return (
                                      <DrawerCountEntry 
                                        key={val.id} 
                                        data={drawerData} 
                                        createdAt={entry.created_at} 
                                      />
                                    );
                                  }
                                  
                                  // Check if this is safe count data
                                  const safeData = val.value_text ? parseSafeCountData(val.value_text) : null;
                                  if (safeData) {
                                    return (
                                      <SafeCountEntry 
                                        key={val.id} 
                                        data={safeData} 
                                        createdAt={entry.created_at} 
                                      />
                                    );
                                  }
                                  
                                  return (
                                    <div key={val.id} className="text-sm">
                                      {val.value_text || val.value_number || val.value_date || 
                                        (val.attachment_url && (
                                          <a 
                                            href={val.attachment_url} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline inline-flex items-center gap-1"
                                          >
                                            <Paperclip className="h-3 w-3" />
                                            View attachment
                                          </a>
                                        ))
                                      }
                                    </div>
                                  );
                                })}
                              </div>
                              
                              {/* Follow-up action buttons for Guest Re-Makes and Online Refunds */}
                              {entry.logbook_categories?.name === 'Guest Re-Makes' && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  {entry.followup_completed_at ? (
                                    <div className="flex items-center gap-2">
                                      <Button 
                                        size="sm" 
                                        variant="outline"
                                        className="bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/30 cursor-default"
                                        disabled
                                      >
                                        ✓ Redeemed
                                      </Button>
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(entry.followup_completed_at), 'MMM d, h:mm a')}
                                      </span>
                                    </div>
                                  ) : (
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      onClick={() => followupMutation.mutate(entry.id)}
                                      disabled={followupMutation.isPending}
                                    >
                                      Redeem
                                    </Button>
                                  )}
                                </div>
                              )}
                              
                              {entry.logbook_categories?.name === 'Online Refunds' && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  {entry.followup_completed_at ? (
                                    <div className="flex items-center gap-2">
                                      <Button 
                                        size="sm" 
                                        variant="outline"
                                        className="bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/30 cursor-default"
                                        disabled
                                      >
                                        ✓ Refund Completed
                                      </Button>
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(entry.followup_completed_at), 'MMM d, h:mm a')}
                                      </span>
                                    </div>
                                  ) : (
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                                      onClick={() => followupMutation.mutate(entry.id)}
                                      disabled={followupMutation.isPending}
                                    >
                                      Need to Refund
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
              {sortedDays.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No entries found</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="catering">
            <CateringOrdersSection />
          </TabsContent>
        </Tabs>

        {isAdmin && (
          <ManageCategoriesDialog
            open={manageCategoriesOpen}
            onOpenChange={setManageCategoriesOpen}
          />
        )}

        <AlertDialog open={!!deleteEntryId} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Entry</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this log entry? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteEntryId && deleteEntryMutation.mutate(deleteEntryId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}
