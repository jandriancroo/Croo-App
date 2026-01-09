import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Database, Cloud, Code, Layers, 
  RefreshCw, HardDrive, Zap, Globe, Users,
  Calendar, MessageSquare, ClipboardList, Package,
  DollarSign, Bell, BarChart3, Truck, ArrowLeft
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface DataNode {
  id: string;
  name: string;
  type: 'layer' | 'table' | 'edge-function' | 'external-api' | 'hook' | 'context';
  icon: React.ReactNode;
  callFrequency: 'high' | 'medium' | 'low' | 'on-demand';
  estimatedSize?: string;
  description: string;
  connections: string[];
}

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

const frequencyColors = {
  high: 'border-red-500 bg-red-500/10 shadow-red-500/20',
  medium: 'border-amber-500 bg-amber-500/10 shadow-amber-500/20',
  low: 'border-green-500 bg-green-500/10 shadow-green-500/20',
  'on-demand': 'border-blue-500 bg-blue-500/10 shadow-blue-500/20'
};

const frequencyDotColors = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-green-500',
  'on-demand': 'bg-blue-500'
};

const lineColors = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
  'on-demand': '#3b82f6'
};

const architectureData: DataNode[] = [
  // UI Layer
  {
    id: 'ui-pages',
    name: 'Pages & Views',
    type: 'layer',
    icon: <Layers className="w-4 h-4" />,
    callFrequency: 'high',
    description: '50+ pages',
    connections: ['hooks-layer', 'contexts-layer']
  },
  
  // State Layer
  {
    id: 'hooks-layer',
    name: 'Custom Hooks',
    type: 'layer',
    icon: <Code className="w-4 h-4" />,
    callFrequency: 'high',
    description: 'useLocation, useUnreadMessages, etc.',
    connections: ['supabase-client']
  },
  {
    id: 'contexts-layer',
    name: 'React Contexts',
    type: 'layer',
    icon: <Users className="w-4 h-4" />,
    callFrequency: 'high',
    description: 'LocationProvider, AuthProvider',
    connections: ['supabase-client']
  },
  
  // Data Client
  {
    id: 'supabase-client',
    name: 'Supabase Client',
    type: 'layer',
    icon: <Database className="w-4 h-4" />,
    callFrequency: 'high',
    description: 'Central data layer',
    connections: ['profiles', 'locations', 'shifts', 'chats', 'checklists', 'inventory', 'sales_cache', 'labor_cache', 'edge-functions']
  },
  
  // Database Tables
  {
    id: 'profiles',
    name: 'profiles',
    type: 'table',
    icon: <Users className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~500 rows',
    description: 'Users & roles',
    connections: []
  },
  {
    id: 'locations',
    name: 'locations',
    type: 'table',
    icon: <Globe className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~10 rows',
    description: 'Store locations',
    connections: []
  },
  {
    id: 'shifts',
    name: 'shifts',
    type: 'table',
    icon: <Calendar className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~50K rows',
    description: 'Schedules & punches',
    connections: []
  },
  {
    id: 'chats',
    name: 'messages',
    type: 'table',
    icon: <MessageSquare className="w-4 h-4" />,
    callFrequency: 'high',
    estimatedSize: '~100K rows',
    description: 'Chat history (realtime)',
    connections: []
  },
  {
    id: 'checklists',
    name: 'checklists',
    type: 'table',
    icon: <ClipboardList className="w-4 h-4" />,
    callFrequency: 'medium',
    estimatedSize: '~20K rows',
    description: 'Tasks & responses',
    connections: []
  },
  {
    id: 'inventory',
    name: 'inventory',
    type: 'table',
    icon: <Package className="w-4 h-4" />,
    callFrequency: 'low',
    estimatedSize: '~5K rows',
    description: 'Items & counts',
    connections: []
  },
  {
    id: 'sales_cache',
    name: 'sales_cache',
    type: 'table',
    icon: <DollarSign className="w-4 h-4" />,
    callFrequency: 'medium',
    estimatedSize: '~10K rows',
    description: 'Daily sales',
    connections: []
  },
  {
    id: 'labor_cache',
    name: 'labor_cache',
    type: 'table',
    icon: <BarChart3 className="w-4 h-4" />,
    callFrequency: 'medium',
    estimatedSize: '~10K rows',
    description: 'Labor hours/costs',
    connections: []
  },
  
  // Edge Functions
  {
    id: 'edge-functions',
    name: 'Edge Functions',
    type: 'edge-function',
    icon: <Zap className="w-4 h-4" />,
    callFrequency: 'on-demand',
    description: '40+ serverless functions',
    connections: ['qubeyond-api', 'pfg-api', 'resend-api', 'ovation-api', 'ai-gateway']
  },
  
  // External APIs
  {
    id: 'qubeyond-api',
    name: 'QUBeyond',
    type: 'external-api',
    icon: <Cloud className="w-4 h-4" />,
    callFrequency: 'medium',
    description: 'POS sales & labor',
    connections: []
  },
  {
    id: 'pfg-api',
    name: 'PFG',
    type: 'external-api',
    icon: <Truck className="w-4 h-4" />,
    callFrequency: 'low',
    description: 'Food orders',
    connections: []
  },
  {
    id: 'resend-api',
    name: 'Resend',
    type: 'external-api',
    icon: <Bell className="w-4 h-4" />,
    callFrequency: 'on-demand',
    description: 'Email notifications',
    connections: []
  },
  {
    id: 'ovation-api',
    name: 'OvationUp',
    type: 'external-api',
    icon: <BarChart3 className="w-4 h-4" />,
    callFrequency: 'low',
    description: 'Survey scores',
    connections: []
  },
  {
    id: 'ai-gateway',
    name: 'Lovable AI',
    type: 'external-api',
    icon: <Zap className="w-4 h-4" />,
    callFrequency: 'on-demand',
    description: 'AI processing',
    connections: []
  },
];

// Define layout rows
const layoutRows = [
  ['ui-pages'],
  ['hooks-layer', 'contexts-layer'],
  ['supabase-client'],
  ['profiles', 'locations', 'shifts', 'chats', 'checklists', 'inventory', 'sales_cache', 'labor_cache'],
  ['edge-functions'],
  ['qubeyond-api', 'pfg-api', 'resend-api', 'ovation-api', 'ai-gateway'],
];

const ArchitectureMap = () => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>({});
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Calculate positions after render
  const updatePositions = useCallback(() => {
    if (!containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const newPositions: Record<string, NodePosition> = {};
    
    Object.entries(nodeRefs.current).forEach(([id, el]) => {
      if (el) {
        const rect = el.getBoundingClientRect();
        newPositions[id] = {
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top + rect.height / 2,
          width: rect.width,
          height: rect.height
        };
      }
    });
    
    setNodePositions(newPositions);
  }, []);

  useEffect(() => {
    updatePositions();
    window.addEventListener('resize', updatePositions);
    return () => window.removeEventListener('resize', updatePositions);
  }, [updatePositions]);

  // Generate connection lines
  const renderConnections = () => {
    const lines: React.ReactNode[] = [];
    
    architectureData.forEach(node => {
      const fromPos = nodePositions[node.id];
      if (!fromPos) return;
      
      node.connections.forEach(targetId => {
        const toPos = nodePositions[targetId];
        if (!toPos) return;
        
        const isHighlighted = selectedNode === node.id || selectedNode === targetId;
        const targetNode = architectureData.find(n => n.id === targetId);
        const color = lineColors[node.callFrequency];
        
        // Calculate control points for curved lines
        const midY = (fromPos.y + toPos.y) / 2;
        const path = `M ${fromPos.x} ${fromPos.y + fromPos.height / 2} 
                      Q ${fromPos.x} ${midY}, ${(fromPos.x + toPos.x) / 2} ${midY}
                      T ${toPos.x} ${toPos.y - toPos.height / 2}`;
        
        lines.push(
          <g key={`${node.id}-${targetId}`}>
            <path
              d={path}
              fill="none"
              stroke={isHighlighted ? color : `${color}40`}
              strokeWidth={isHighlighted ? 2 : 1}
              strokeDasharray={node.callFrequency === 'on-demand' ? '4 4' : undefined}
              className="transition-all duration-300"
            />
            {/* Arrow head */}
            <circle
              cx={toPos.x}
              cy={toPos.y - toPos.height / 2}
              r={isHighlighted ? 4 : 2}
              fill={isHighlighted ? color : `${color}60`}
              className="transition-all duration-300"
            />
          </g>
        );
      });
    });
    
    return lines;
  };

  const selectedNodeData = selectedNode ? architectureData.find(n => n.id === selectedNode) : null;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Architecture Map</h1>
            <p className="text-xs text-muted-foreground">Click nodes to highlight connections</p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs">
          {Object.entries(frequencyDotColors).map(([freq, color]) => (
            <div key={freq} className="flex items-center gap-1.5">
              <div className={cn('w-2.5 h-2.5 rounded-full', color)} />
              <span className="text-muted-foreground capitalize">{freq.replace('-', ' ')}</span>
            </div>
          ))}
        </div>

        {/* Main Diagram */}
        <div ref={containerRef} className="relative bg-card/50 rounded-xl border p-6 overflow-x-auto">
          {/* SVG Layer for connections */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none z-0"
            style={{ minWidth: '100%', minHeight: '100%' }}
          >
            {renderConnections()}
          </svg>

          {/* Nodes Layer */}
          <div className="relative z-10 space-y-8">
            {layoutRows.map((row, rowIndex) => (
              <div 
                key={rowIndex} 
                className="flex flex-wrap justify-center gap-3"
              >
                {row.map(nodeId => {
                  const node = architectureData.find(n => n.id === nodeId);
                  if (!node) return null;
                  
                  const isSelected = selectedNode === node.id;
                  const isConnected = selectedNode && (
                    architectureData.find(n => n.id === selectedNode)?.connections.includes(node.id) ||
                    node.connections.includes(selectedNode)
                  );
                  
                  return (
                    <motion.div
                      key={node.id}
                      ref={el => { nodeRefs.current[node.id] = el; }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setSelectedNode(selectedNode === node.id ? null : node.id);
                        setTimeout(updatePositions, 10);
                      }}
                      className={cn(
                        'cursor-pointer rounded-lg p-3 border-2 shadow-lg transition-all duration-200 min-w-[100px]',
                        frequencyColors[node.callFrequency],
                        isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-105',
                        isConnected && 'ring-1 ring-primary/50',
                        selectedNode && !isSelected && !isConnected && 'opacity-40'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          'p-1.5 rounded-md',
                          frequencyDotColors[node.callFrequency],
                          'bg-opacity-20'
                        )}>
                          {node.icon}
                        </div>
                        <div>
                          <div className="font-medium text-sm whitespace-nowrap">{node.name}</div>
                          {node.estimatedSize && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <HardDrive className="w-2.5 h-2.5" />
                              {node.estimatedSize}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Row Labels */}
          <div className="absolute left-2 top-6 space-y-8 text-[10px] text-muted-foreground font-medium hidden md:block">
            <div className="h-[52px] flex items-center">UI</div>
            <div className="h-[52px] flex items-center">State</div>
            <div className="h-[52px] flex items-center">Client</div>
            <div className="h-[52px] flex items-center">Database</div>
            <div className="h-[52px] flex items-center">Functions</div>
            <div className="h-[52px] flex items-center">External</div>
          </div>
        </div>

        {/* Selected Node Details */}
        {selectedNodeData && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="border-primary/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {selectedNodeData.icon}
                  {selectedNodeData.name}
                  <Badge variant="outline" className={cn('ml-2 text-xs', frequencyColors[selectedNodeData.callFrequency])}>
                    <RefreshCw className="w-3 h-3 mr-1" />
                    {selectedNodeData.callFrequency}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p className="text-muted-foreground">{selectedNodeData.description}</p>
                
                {selectedNodeData.connections.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-muted-foreground">Connects to:</span>
                    {selectedNodeData.connections.map(connId => {
                      const conn = architectureData.find(n => n.id === connId);
                      return conn ? (
                        <Badge 
                          key={connId} 
                          variant="secondary" 
                          className="text-xs cursor-pointer"
                          onClick={() => setSelectedNode(connId)}
                        >
                          {conn.name}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <div className="text-lg font-bold">50+</div>
            <div className="text-[10px] text-muted-foreground">Pages</div>
          </div>
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="text-lg font-bold">30+</div>
            <div className="text-[10px] text-muted-foreground">Tables</div>
          </div>
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-lg font-bold">40+</div>
            <div className="text-[10px] text-muted-foreground">Functions</div>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="text-lg font-bold">5</div>
            <div className="text-[10px] text-muted-foreground">APIs</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArchitectureMap;
