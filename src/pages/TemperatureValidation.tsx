import { useEffect, useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Edit2, Save, X } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { getTodayInPST } from '@/utils/dateUtils';

interface TemperatureReading {
  id: string;
  item_id: string;
  submission_id: string;
  response_image_url: string;
  extracted_temperature: number | null;
  temperature_valid: boolean | null;
  temperature_validated_at: string | null;
  created_at: string;
  checklist_title: string;
  item_question: string;
  completer_name: string;
}

export default function TemperatureValidation() {
  const [readings, setReadings] = useState<TemperatureReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  useEffect(() => {
    fetchReadings();
  }, []);

  const fetchReadings = async () => {
    try {
      // First get responses with temperature data
      const { data: responses, error: responsesError } = await supabase
        .from('checklist_responses')
        .select('id, item_id, submission_id, response_image_url, extracted_temperature, temperature_valid, temperature_validated_at, created_at, completed_by')
        .not('response_image_url', 'is', null)
        .not('extracted_temperature', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);

      if (responsesError) throw responsesError;

      if (!responses || responses.length === 0) {
        setReadings([]);
        setLoading(false);
        return;
      }

      // Get unique item IDs and submission IDs
      const itemIds = [...new Set(responses.map(r => r.item_id))];
      const submissionIds = [...new Set(responses.map(r => r.submission_id))];
      const completerIds = [...new Set(responses.map(r => r.completed_by).filter(Boolean))];

      // Fetch checklist items - filter for temperature-related questions only
      const { data: items, error: itemsError } = await supabase
        .from('checklist_items')
        .select('id, question, checklist_id')
        .in('id', itemIds);

      if (itemsError) throw itemsError;
      
      // Filter to only temperature-related items (exclude dough scales, etc.)
      const temperatureItems = (items || []).filter((item: any) => 
        item.question.toLowerCase().includes('temp') || 
        item.question.toLowerCase().includes('thermometer')
      );
      
      // Filter responses to only include temperature items
      const filteredResponses = responses.filter(r => 
        temperatureItems.some((item: any) => item.id === r.item_id)
      );

      if (filteredResponses.length === 0) {
        setReadings([]);
        setLoading(false);
        return;
      }

      // Get unique checklist IDs
      const checklistIds = [...new Set(temperatureItems.map((i: any) => i.checklist_id))];

      // Fetch checklists
      const { data: checklists, error: checklistsError } = await supabase
        .from('checklists')
        .select('id, title')
        .in('id', checklistIds);

      if (checklistsError) throw checklistsError;

      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', completerIds);

      if (profilesError) throw profilesError;

      // Create lookup maps
      const itemsMap = new Map(temperatureItems.map((i: any) => [i.id, i]));
      const checklistsMap = new Map((checklists || []).map((c: any) => [c.id, c]));
      const profilesMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      // Format data
      const formatted = filteredResponses.map((r: any) => {
        const item = itemsMap.get(r.item_id);
        const checklist = item ? checklistsMap.get(item.checklist_id) : null;
        const profile = r.completed_by ? profilesMap.get(r.completed_by) : null;

        return {
          id: r.id,
          item_id: r.item_id,
          submission_id: r.submission_id,
          response_image_url: r.response_image_url,
          extracted_temperature: r.extracted_temperature,
          temperature_valid: r.temperature_valid,
          temperature_validated_at: r.temperature_validated_at,
          created_at: r.created_at,
          checklist_title: checklist?.title || 'Unknown',
          item_question: item?.question || 'Unknown',
          completer_name: profile?.full_name || 'Unknown',
        };
      });

      setReadings(formatted);
    } catch (error) {
      console.error('Error fetching temperature readings:', error);
      toast.error('Failed to load temperature readings');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (readingId: string) => {
    try {
      const { error } = await supabase
        .from('checklist_responses')
        .update({
          temperature_validated_at: new Date().toISOString(),
        })
        .eq('id', readingId);

      if (error) throw error;

      toast.success('Temperature confirmed');
      fetchReadings();
    } catch (error) {
      console.error('Error confirming temperature:', error);
      toast.error('Failed to confirm temperature');
    }
  };

  const handleEdit = (reading: TemperatureReading) => {
    setEditingId(reading.id);
    setEditValue(reading.extracted_temperature?.toString() || '');
  };

  const handleSave = async (readingId: string) => {
    const temp = parseFloat(editValue);
    if (isNaN(temp)) {
      toast.error('Please enter a valid number');
      return;
    }

    try {
      // Food safety: ≤41.0°F (cold) or ≥135.0°F (hot holding)
      const isValid = temp <= 41.0 || temp >= 135.0;

      const { error } = await supabase
        .from('checklist_responses')
        .update({
          extracted_temperature: temp,
          temperature_valid: isValid,
          temperature_validated_at: new Date().toISOString(),
        })
        .eq('id', readingId);

      if (error) throw error;

      toast.success('Temperature corrected successfully');
      setEditingId(null);
      fetchReadings();
    } catch (error) {
      console.error('Error updating temperature:', error);
      toast.error('Failed to update temperature');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleRescanAll = async () => {
    setRescanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=rescan-temperatures', {
        body: { targetDate: getTodayInPST() }
      });

      if (error) throw error;

      toast.success(`Rescanned ${data.summary.successful} of ${data.summary.total} readings. ${data.summary.changed} changed.`);
      
      // Refresh the readings
      await fetchReadings();
    } catch (error) {
      console.error('Error rescanning temperatures:', error);
      toast.error('Failed to rescan temperatures');
    } finally {
      setRescanning(false);
    }
  };

  const getStatusBadge = (valid: boolean | null, temp: number | null) => {
    if (temp === null) return null;
    
    if (valid) {
      return (
        <Badge className="bg-green-500 text-white">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Safe
        </Badge>
      );
    } else {
      return (
        <Badge variant="destructive">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Out of Range
        </Badge>
      );
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading temperature readings...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-full md:max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Temperature Validation</h1>
            <p className="text-muted-foreground">
              Review and correct AI-extracted temperature readings
            </p>
          </div>
          <Button
            onClick={handleRescanAll}
            disabled={rescanning || loading}
            variant="outline"
          >
            {rescanning ? "Rescanning..." : "Rescan All Today"}
          </Button>
        </div>

        {readings.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No temperature readings found
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {readings.map((reading) => (
              <Card key={reading.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4">
                     <div className="flex-shrink-0 py-4 flex justify-center items-center overflow-hidden" style={{ minHeight: '250px' }}>
                      <img
                        src={reading.response_image_url}
                        alt="Thermometer reading"
                        className="h-auto w-full max-w-full object-contain rounded-lg cursor-pointer border"
                        style={{ 
                          maxHeight: '300px'
                        }}
                        onClick={() => setPreviewImage(reading.response_image_url)}
                      />
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-muted-foreground">{reading.checklist_title}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(reading.created_at), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                      {editingId === reading.id ? (
                        <div className="space-y-2">
                          <Label>Correct Temperature (°F)</Label>
                          <div className="flex gap-2 flex-wrap">
                            <Input
                              type="number"
                              step="0.1"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-32"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={() => handleSave(reading.id)}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Apply
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancel}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Safe zones: ≤41.0°F (cold) or ≥135.0°F (hot holding)
                          </p>
                        </div>
                      ) : (
                          <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-3xl font-bold">
                              {reading.extracted_temperature}°F
                            </p>
                            {getStatusBadge(reading.temperature_valid, reading.extracted_temperature)}
                            {reading.temperature_validated_at && (
                              <Badge className="bg-green-700 text-white">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Corrected
                              </Badge>
                            )}
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              onClick={() => handleConfirm(reading.id)}
                              className="bg-green-600 hover:bg-green-700 flex-1 sm:flex-none"
                            >
                              <CheckCircle2 className="w-4 h-4 mr-1" />
                              Confirm Correct
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(reading)}
                              className="flex-1 sm:flex-none"
                            >
                              <Edit2 className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-3xl">
            {previewImage && (
              <img
                src={previewImage}
                alt="Full size thermometer"
                className="w-full h-auto"
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
