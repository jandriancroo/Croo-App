import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Database, Cloud, Code, Layers, ArrowRight, ArrowDown,
  RefreshCw, HardDrive, Zap, Globe, Lock, Users,
  FileText, Calendar, MessageSquare, ClipboardList, Package,
  DollarSign, Bell, Settings, BarChart3, Truck
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface DataNode {
  id: string;
  name: string;
  type: 'layer' | 'table' | 'edge-function' | 'external-api' | 'hook' | 'context';
  icon: React.ReactNode;
  callFrequency: 'high' | 'medium' | 'low' | 'on-demand';
  estimatedSize?: string;
  description: string;
  connections: string[];
  layer: number;
}

const frequencyColors = {
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-green-500/20 text-green-400 border-green-500/30',
  'on-demand': 'bg-blue-500/20 text-blue-400 border-blue-500/30'
};

const frequencyPulse = {
  high: '',
  medium: '',
  low: '',
  'on-demand': ''
};

const layerColors = [
  'from-violet-500/20 to-purple-500/20 border-violet-500/30',
  'from-blue-500/20 to-cyan-500/20 border-blue-500/30',
  'from-emerald-500/20 to-green-500/20 border-emerald-500/30',
  'from-amber-500/20 to-orange-500/20 border-amber-500/30',
  'from-rose-500/20 to-pink-500/20 border-rose-500/30',
];

const architectureData: DataNode[] = [
  // Layer 0: UI Components
  {
    id: 'ui-pages',
    name: 'Pages & Views',
    type: 'layer',
    icon: <Layers className="w-4 h-4" />,
    callFrequency: 'high',
    description: '50+ pages including Dashboard, Schedule, Messages, Tasks, Inventory',
    connections: ['hooks-layer', 'contexts-layer'],
    layer: 0
  },
  
  // Layer 1: Hooks & Contexts
  {
    id: 'hooks-layer',
    name: 'Custom Hooks',
    type: 'layer',
    icon: <Code className="w-4 h-4" />,
    callFrequency: 'high',
    description: 'useLocation, useUnreadMessages, useRolePermissions, useTipDistribution',
    connections: ['supabase-client'],
    layer: 1
  },
  {
    id: 'contexts-layer',
    name: 'React Contexts',
    type: 'layer',
    icon: <Users className="w-4 h-4" />,
    callFrequency: 'high',
    description: 'LocationProvider, AuthProvider, DockToastContext, CrooCashAnimation',
    connections: ['supabase-client'],
    layer: 1
  },
  
  // Layer 2: Supabase Client
  {
    id: 'supabase-client',
    name: 'Supabase Client',
    type: 'layer',
    icon: <Database className="w-4 h-4" />,
    callFrequency: 'high',
    description: 'Central data layer - all DB queries flow through here',
    connections: ['profiles', 'locations', 'shifts', 'chats', 'checklists', 'inventory', 'edge-functions'],
    layer: 2
  },
  
  // Layer 3: Database Tables (grouped)
  {
    id: 'profiles',
    name: 'profiles',
    type: 'table',
    icon: <Users className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~500 rows',
    description: 'User profiles, roles, wages, settings',
    connections: [],
    layer: 3
  },
  {
    id: 'locations',
    name: 'locations',
    type: 'table',
    icon: <Globe className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~10 rows',
    description: 'Store locations, hours, settings',
    connections: [],
    layer: 3
  },
  {
    id: 'shifts',
    name: 'shifts + punch_records',
    type: 'table',
    icon: <Calendar className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~50K rows',
    description: 'Scheduled shifts and punch clock records',
    connections: ['labor_cache'],
    layer: 3
  },
  {
    id: 'chats',
    name: 'chats + messages',
    type: 'table',
    icon: <MessageSquare className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~100K rows',
    description: 'Chat rooms and message history (realtime)',
    connections: [],
    layer: 3
  },
  {
    id: 'checklists',
    name: 'checklists + submissions',
    type: 'table',
    icon: <ClipboardList className="w-4 h-4" />,
    callFrequency: 'medium',
    estimatedSize: '~20K rows',
    description: 'Task checklists, items, responses',
    connections: [],
    layer: 3
  },
  {
    id: 'inventory',
    name: 'inventory_*',
    type: 'table',
    icon: <Package className="w-4 h-4" />,
    callFrequency: 'low',
    estimatedSize: '~5K rows',
    description: 'Items, counts, locations, schedules',
    connections: ['pfg-api'],
    layer: 3
  },
  {
    id: 'sales_cache',
    name: 'sales_cache',
    type: 'table',
    icon: <DollarSign className="w-4 h-4" />,
    callFrequency: 'medium',
    estimatedSize: '~10K rows',
    description: 'Cached daily sales from QUBeyond',
    connections: ['qubeyond-api'],
    layer: 3
  },
  {
    id: 'labor_cache',
    name: 'labor_cache',
    type: 'table',
    icon: <BarChart3 className="w-4 h-4" />,
    callFrequency: 'medium',
    estimatedSize: '~10K rows',
    description: 'Labor hours/costs (source: qubeyond or punch_clock)',
    connections: ['qubeyond-api'],
    layer: 3
  },
  
  // Layer 4: Edge Functions
  {
    id: 'edge-functions',
    name: 'Edge Functions',
    type: 'layer',
    icon: <Zap className="w-4 h-4" />,
    callFrequency: 'on-demand',
    description: '40+ serverless functions for integrations & processing',
    connections: ['qubeyond-api', 'pfg-api', 'resend-api', 'ovation-api', 'ai-gateway'],
    layer: 4
  },
  
  // Layer 5: External APIs
  {
    id: 'qubeyond-api',
    name: 'QUBeyond API',
    type: 'external-api',
    icon: <Cloud className="w-4 h-4" />,
    callFrequency: 'medium',
    description: 'POS sales & labor data sync (daily cron + on-demand)',
    connections: [],
    layer: 5
  },
  {
    id: 'pfg-api',
    name: 'PFG API',
    type: 'external-api',
    icon: <Truck className="w-4 h-4" />,
    callFrequency: 'low',
    description: 'Food distributor order history sync',
    connections: [],
    layer: 5
  },
  {
    id: 'resend-api',
    name: 'Resend API',
    type: 'external-api',
    icon: <Bell className="w-4 h-4" />,
    callFrequency: 'on-demand',
    description: 'Email notifications (invites, schedules, alerts)',
    connections: [],
    layer: 5
  },
  {
    id: 'ovation-api',
    name: 'OvationUp API',
    type: 'external-api',
    icon: <BarChart3 className="w-4 h-4" />,
    callFrequency: 'low',
    description: 'Customer survey scores',
    connections: [],
    layer: 5
  },
  {
    id: 'ai-gateway',
    name: 'Lovable AI Gateway',
    type: 'external-api',
    icon: <Zap className="w-4 h-4" />,
    callFrequency: 'on-demand',
    description: 'AI processing (resume parsing, voice inventory, temp extraction)',
    connections: [],
    layer: 5
  },
];

const ArchitectureMap = () => {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const layers = useMemo(() => {
    const grouped: Record<number, DataNode[]> = {};
    architectureData.forEach(node => {
      if (!grouped[node.layer]) grouped[node.layer] = [];
      grouped[node.layer].push(node);
    });
    return grouped;
  }, []);

  const layerNames = [
    'UI Layer',
    'State Management',
    'Data Client',
    'Database Tables',
    'Serverless Functions',
    'External Services'
  ];

  const selectedNodeData = selectedNode ? architectureData.find(n => n.id === selectedNode) : null;
  const connectedIds = selectedNodeData?.connections || [];

  const getNodeStyle = (node: DataNode) => {
    const isSelected = selectedNode === node.id;
    const isConnected = connectedIds.includes(node.id);
    const isSourceOfSelected = selectedNodeData && node.connections.includes(selectedNode!);
    
    if (isSelected) return 'ring-2 ring-primary scale-105';
    if (isConnected || isSourceOfSelected) return 'ring-2 ring-primary/50 opacity-100';
    if (selectedNode && !isConnected && !isSourceOfSelected) return 'opacity-40';
    return '';
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
            CrooHQ Architecture Map
          </h1>
          <p className="text-muted-foreground text-sm">
            Interactive visualization of app layers, data flow, and external integrations
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/50" />
            <span className="text-muted-foreground">High frequency</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-amber-500/50" />
            <span className="text-muted-foreground">Medium</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-green-500/50" />
            <span className="text-muted-foreground">Low</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-blue-500/50" />
            <span className="text-muted-foreground">On-demand</span>
          </div>
        </div>

        {/* Architecture Layers */}
        <div className="space-y-4">
          {Object.entries(layers).map(([layerIndex, nodes]) => (
            <motion.div
              key={layerIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: parseInt(layerIndex) * 0.1 }}
              className="space-y-2"
            >
              {/* Layer Label */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn(
                  'text-xs border bg-gradient-to-r',
                  layerColors[parseInt(layerIndex) % layerColors.length]
                )}>
                  Layer {layerIndex}
                </Badge>
                <span className="text-sm font-medium text-muted-foreground">
                  {layerNames[parseInt(layerIndex)]}
                </span>
                {parseInt(layerIndex) < Object.keys(layers).length - 1 && (
                  <ArrowDown className="w-4 h-4 text-muted-foreground/50 ml-auto" />
                )}
              </div>

              {/* Nodes in Layer */}
              <div className="flex flex-wrap gap-3">
                {nodes.map((node) => (
                  <motion.div
                    key={node.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    className={cn(
                      'cursor-pointer rounded-lg p-3 border transition-all duration-200',
                      'bg-gradient-to-br',
                      layerColors[parseInt(layerIndex) % layerColors.length],
                      getNodeStyle(node),
                      frequencyPulse[node.callFrequency]
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className={cn(
                        'p-1.5 rounded-md',
                        frequencyColors[node.callFrequency]
                      )}>
                        {node.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{node.name}</span>
                          {node.estimatedSize && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              <HardDrive className="w-2.5 h-2.5 mr-1" />
                              {node.estimatedSize}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                          {node.description}
                        </p>
                      </div>
                    </div>
                    
                    {/* Connection indicators */}
                    {node.connections.length > 0 && (
                      <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                        <ArrowRight className="w-3 h-3" />
                        <span>{node.connections.length} connections</span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Selected Node Details */}
        <AnimatePresence>
          {selectedNodeData && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Card className="border-primary/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    {selectedNodeData.icon}
                    {selectedNodeData.name}
                    <Badge className={cn('ml-2', frequencyColors[selectedNodeData.callFrequency])}>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      {selectedNodeData.callFrequency}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{selectedNodeData.description}</p>
                  
                  {selectedNodeData.estimatedSize && (
                    <div className="flex items-center gap-2 text-sm">
                      <HardDrive className="w-4 h-4 text-muted-foreground" />
                      <span>Estimated size: <strong>{selectedNodeData.estimatedSize}</strong></span>
                    </div>
                  )}
                  
                  {selectedNodeData.connections.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-sm font-medium">Connects to:</span>
                      <div className="flex flex-wrap gap-2">
                        {selectedNodeData.connections.map(connId => {
                          const connNode = architectureData.find(n => n.id === connId);
                          return connNode ? (
                            <Badge 
                              key={connId} 
                              variant="secondary" 
                              className="cursor-pointer hover:bg-secondary/80"
                              onClick={() => setSelectedNode(connId)}
                            >
                              {connNode.icon}
                              <span className="ml-1">{connNode.name}</span>
                            </Badge>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Show what connects TO this node */}
                  {(() => {
                    const incomingConnections = architectureData.filter(n => n.connections.includes(selectedNodeData.id));
                    if (incomingConnections.length === 0) return null;
                    return (
                      <div className="space-y-1">
                        <span className="text-sm font-medium">Used by:</span>
                        <div className="flex flex-wrap gap-2">
                          {incomingConnections.map(node => (
                            <Badge 
                              key={node.id} 
                              variant="outline" 
                              className="cursor-pointer hover:bg-secondary/50"
                              onClick={() => setSelectedNode(node.id)}
                            >
                              {node.icon}
                              <span className="ml-1">{node.name}</span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/20">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">50+</div>
              <div className="text-xs text-muted-foreground">Pages</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">30+</div>
              <div className="text-xs text-muted-foreground">DB Tables</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/20">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">40+</div>
              <div className="text-xs text-muted-foreground">Edge Functions</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">5</div>
              <div className="text-xs text-muted-foreground">External APIs</div>
            </CardContent>
          </Card>
        </div>

        {/* Data Flow Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Data Flow Patterns
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex items-center gap-2">
              <Badge className={frequencyColors.high}>High</Badge>
              <span className="text-muted-foreground">profiles, locations, shifts, messages - every page load</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={frequencyColors.medium}>Medium</Badge>
              <span className="text-muted-foreground">sales_cache, labor_cache - dashboard widgets, synced daily</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={frequencyColors.low}>Low</Badge>
              <span className="text-muted-foreground">inventory, PFG orders - weekly counts, on-demand sync</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={frequencyColors['on-demand']}>On-demand</Badge>
              <span className="text-muted-foreground">AI processing, email sends, external API calls</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ArchitectureMap;
