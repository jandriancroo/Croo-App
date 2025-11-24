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
import { CalendarIcon, Paperclip, Search, User, Settings } from "lucide-react";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { useUserRole } from "@/hooks/useUserRole";
import { ManageCategoriesDialog } from "@/components/logbook/ManageCategoriesDialog";
import { useSearchParams } from "react-router-dom";

export default function LogBook() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['logbook-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('logbook_categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data;
    },
  });

  // Set initial category
  useEffect(() => {
    if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, selectedCategory]);

  // Handle navigation from alert link
  useEffect(() => {
    const entryId = searchParams.get('entryId');
    if (entryId && categories.length > 0) {
      setPendingEntryId(entryId);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, categories]);

  // Process pending entry once categories are loaded
  useEffect(() => {
    if (pendingEntryId && categories.length > 0) {
      supabase
        .from('logbook_entries')
        .select('entry_date, category_id')
        .eq('id', pendingEntryId)
        .single()
        .then(({ data, error }) => {
          if (data && !error) {
            setSelectedCategory(data.category_id);
            setSelectedDate(new Date(data.entry_date + 'T00:00:00'));
            setPendingEntryId(null);
            toast({
              title: "Entry found",
              description: "Showing the selected log entry",
            });
          } else {
            toast({
              title: "Entry not found",
              description: "Could not locate the log entry",
              variant: "destructive",
            });
            setPendingEntryId(null);
          }
        });
    }
  }, [pendingEntryId, categories, toast]);

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
    queryKey: ['logbook-entry', selectedCategory, selectedDate.toISOString().split('T')[0]],
    queryFn: async () => {
      const dateStr = selectedDate.toISOString().split('T')[0];
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
    queryKey: ['logbook-all-entries', searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('logbook_entries')
        .select(`
          *,
          logbook_entry_values(*),
          profiles(full_name, profile_photo_url),
          logbook_categories(name)
        `)
        .order('entry_date', { ascending: false })
        .limit(50);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const [formData, setFormData] = useState<Record<string, any>>({});

  // Handle file upload
  const handleFileUpload = async (fieldId: string, file: File) => {
    try {
      setUploadingFiles({ ...uploadingFiles, [fieldId]: true });
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${user!.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('logbook-attachments')
        .upload(fileName, file);

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
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      // Create or update entry
      const { data: entryData, error: entryError } = await supabase
        .from('logbook_entries')
        .upsert({
          category_id: selectedCategory,
          entry_date: dateStr,
          created_by: user!.id,
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

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Log Book</h1>
          {isAdmin && (
            <Button variant="outline" onClick={() => setManageCategoriesOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Manage Categories
            </Button>
          )}
        </div>

        <Tabs defaultValue="entry" className="space-y-4">
          <TabsList>
            <TabsTrigger value="entry">New Entry</TabsTrigger>
            <TabsTrigger value="search">Search Entries</TabsTrigger>
          </TabsList>

          <TabsContent value="entry" className="space-y-4">
            {/* Category Tabs */}
            <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
              <TabsList className="w-full justify-start overflow-x-auto">
                {categories.map((category: any) => (
                  <TabsTrigger key={category.id} value={category.id}>
                    {category.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>
                    {categories.find((c: any) => c.id === selectedCategory)?.name}
                  </CardTitle>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm">
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        {format(selectedDate, 'PPP')}
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
                <CardDescription>
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

            <div className="space-y-2">
              {filteredEntries.map((entry: any) => (
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
                              {entry.logbook_categories?.name} • {format(new Date(entry.entry_date), 'PPP')}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(entry.created_at), 'p')}
                          </div>
                        </div>
                        <div className="mt-2 space-y-1">
                          {entry.logbook_entry_values?.map((val: any) => (
                            <div key={val.id} className="text-sm">
                              {val.value_text || val.value_number || val.value_date || val.attachment_url}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredEntries.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No entries found</p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {isAdmin && (
          <ManageCategoriesDialog
            open={manageCategoriesOpen}
            onOpenChange={setManageCategoriesOpen}
          />
        )}
      </div>
    </Layout>
  );
}
