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

  useEffect(() => {
    fetchReadings();
  }, []);

  const fetchReadings = async () => {
    try {
      const { data, error } = await supabase
        .from('checklist_responses')
        .select(`
          id,
          item_id,
          submission_id,
          response_image_url,
          extracted_temperature,
          temperature_valid,
          temperature_validated_at,
          created_at,
          checklist_items!inner(question, checklists!inner(title)),
          profiles!checklist_responses_completed_by_fkey(full_name)
        `)
        .not('response_image_url', 'is', null)
        .not('extracted_temperature', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const formatted = (data || []).map((r: any) => ({
        id: r.id,
        item_id: r.item_id,
        submission_id: r.submission_id,
        response_image_url: r.response_image_url,
        extracted_temperature: r.extracted_temperature,
        temperature_valid: r.temperature_valid,
        temperature_validated_at: r.temperature_validated_at,
        created_at: r.created_at,
        checklist_title: r.checklist_items?.checklists?.title || 'Unknown',
        item_question: r.checklist_items?.question || 'Unknown',
        completer_name: r.profiles?.full_name || 'Unknown',
      }));

      setReadings(formatted);
    } catch (error) {
      console.error('Error fetching temperature readings:', error);
      toast.error('Failed to load temperature readings');
    } finally {
      setLoading(false);
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
      const isValid = temp <= 41.9 || temp >= 165;

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
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Temperature Validation</h1>
          <p className="text-muted-foreground">
            Review and correct AI-extracted temperature readings
          </p>
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
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{reading.checklist_title}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {reading.item_question}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        By {reading.completer_name} • {format(new Date(reading.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                    {getStatusBadge(reading.temperature_valid, reading.extracted_temperature)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4 items-start">
                    <div className="flex-shrink-0">
                      <img
                        src={reading.response_image_url}
                        alt="Thermometer reading"
                        className="w-32 h-32 object-cover rounded-lg cursor-pointer border"
                        onClick={() => setPreviewImage(reading.response_image_url)}
                      />
                    </div>
                    <div className="flex-1 space-y-3">
                      {editingId === reading.id ? (
                        <div className="space-y-2">
                          <Label>Correct Temperature (°F)</Label>
                          <div className="flex gap-2">
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
                              <Save className="w-4 h-4 mr-1" />
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancel}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div>
                            <Label className="text-muted-foreground">AI Reading</Label>
                            <p className="text-2xl font-bold">
                              {reading.extracted_temperature}°F
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(reading)}
                          >
                            <Edit2 className="w-4 h-4 mr-1" />
                            Correct
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Safe temperature zones: ≤41.9°F (cold) or ≥165°F (hot)
                      </p>
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
