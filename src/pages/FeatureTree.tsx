import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Home, Calendar, CheckSquare, MessageSquare, Package, 
  Users, Settings, Clock, DollarSign, FileText, Gamepad2,
  ChevronRight, ChevronDown, Briefcase, Shield, Bell
} from "lucide-react";

interface FeatureNode {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  children?: FeatureNode[];
  dependencies?: string[];
}

const featureTree: FeatureNode[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    icon: Home,
    color: "#3b82f6",
    children: [
      { id: "data-cubes", name: "3D Data Cubes", icon: Package, color: "#8b5cf6", dependencies: ["sales-cache", "labor-cache"] },
      { id: "sales-overview", name: "Sales Overview", icon: DollarSign, color: "#10b981", dependencies: ["sales-cache", "qubeyond"] },
      { id: "alerts", name: "Alerts & Tasks", icon: Bell, color: "#f59e0b", dependencies: ["checklists", "temp-tasks"] },
    ]
  },
  {
    id: "schedule",
    name: "Schedule",
    icon: Calendar,
    color: "#ec4899",
    children: [
      { id: "shifts", name: "Shift Management", icon: Clock, color: "#f472b6", dependencies: ["profiles", "locations"] },
      { id: "punch-clock", name: "Punch Clock", icon: Clock, color: "#fb7185", dependencies: ["labor-cache", "profiles"] },
      { id: "availability", name: "Availability", icon: Users, color: "#e879f9", dependencies: ["profiles"] },
    ]
  },
  {
    id: "tasks",
    name: "Tasks",
    icon: CheckSquare,
    color: "#22c55e",
    children: [
      { id: "checklists", name: "Checklists", icon: FileText, color: "#4ade80", dependencies: ["profiles", "locations"] },
      { id: "temp-tasks", name: "Temporary Tasks", icon: CheckSquare, color: "#86efac", dependencies: ["profiles"] },
      { id: "logbook", name: "Logbook", icon: FileText, color: "#a3e635", dependencies: ["locations", "sales-cache"] },
    ]
  },
  {
    id: "messages",
    name: "Messages",
    icon: MessageSquare,
    color: "#06b6d4",
    children: [
      { id: "chats", name: "Team Chat", icon: MessageSquare, color: "#22d3ee", dependencies: ["profiles"] },
      { id: "announcements", name: "Announcements", icon: Bell, color: "#67e8f9", dependencies: ["profiles", "locations"] },
    ]
  },
  {
    id: "inventory",
    name: "Inventory",
    icon: Package,
    color: "#f97316",
    children: [
      { id: "counts", name: "Inventory Counts", icon: Package, color: "#fb923c", dependencies: ["inventory-items", "locations"] },
      { id: "inventory-items", name: "Item Management", icon: Package, color: "#fdba74", dependencies: ["locations", "pfg"] },
    ]
  },
  {
    id: "users",
    name: "User Management",
    icon: Users,
    color: "#a855f7",
    children: [
      { id: "profiles", name: "Profiles", icon: Users, color: "#c084fc", dependencies: ["auth"] },
      { id: "certifications", name: "Certifications", icon: Shield, color: "#d8b4fe", dependencies: ["profiles"] },
      { id: "hiring", name: "Hiring", icon: Briefcase, color: "#e9d5ff", dependencies: ["locations"] },
    ]
  },
  {
    id: "integrations",
    name: "Integrations",
    icon: Settings,
    color: "#64748b",
    children: [
      { id: "qubeyond", name: "QuBeyond POS", icon: DollarSign, color: "#94a3b8", dependencies: ["sales-cache", "labor-cache"] },
      { id: "pfg", name: "PFG Orders", icon: Package, color: "#cbd5e1", dependencies: ["inventory-items"] },
    ]
  },
  {
    id: "data-layer",
    name: "Data Layer",
    icon: Shield,
    color: "#ef4444",
    children: [
      { id: "sales-cache", name: "Sales Cache", icon: DollarSign, color: "#f87171", dependencies: ["locations"] },
      { id: "labor-cache", name: "Labor Cache", icon: Clock, color: "#fca5a5", dependencies: ["locations"] },
      { id: "auth", name: "Authentication", icon: Shield, color: "#fecaca", dependencies: [] },
      { id: "locations", name: "Locations", icon: Home, color: "#fee2e2", dependencies: ["auth"] },
    ]
  },
  {
    id: "games",
    name: "Arcade",
    icon: Gamepad2,
    color: "#eab308",
    children: [
      { id: "basketball", name: "Basketball", icon: Gamepad2, color: "#facc15" },
      { id: "snake", name: "Snake", icon: Gamepad2, color: "#fde047" },
      { id: "pizza-paddle", name: "Pizza Paddle", icon: Gamepad2, color: "#fef08a" },
    ]
  },
];

const TreeNode = ({ 
  node, 
  depth = 0, 
  selectedId, 
  onSelect 
}: { 
  node: FeatureNode; 
  depth?: number; 
  selectedId: string | null;
  onSelect: (id: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;
  const Icon = node.icon;
  const isSelected = selectedId === node.id;

  return (
    <div className="select-none">
      <motion.div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-white/20' : 'hover:bg-white/10'
        }`}
        style={{ marginLeft: depth * 20 }}
        onClick={() => {
          if (hasChildren) setIsOpen(!isOpen);
          onSelect(node.id);
        }}
        whileHover={{ x: 4 }}
        whileTap={{ scale: 0.98 }}
      >
        {hasChildren ? (
          <motion.div
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        ) : (
          <div className="w-4" />
        )}
        
        <div 
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: node.color + '30' }}
        >
          <Icon className="w-4 h-4" style={{ color: node.color }} />
        </div>
        
        <span className="font-medium text-sm">{node.name}</span>
        
        {node.dependencies && node.dependencies.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            → {node.dependencies.length} deps
          </span>
        )}
      </motion.div>

      <AnimatePresence>
        {isOpen && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {node.children!.map((child) => (
              <TreeNode 
                key={child.id} 
                node={child} 
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const findNode = (nodes: FeatureNode[], id: string): FeatureNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
};

const findDependents = (nodes: FeatureNode[], targetId: string): string[] => {
  const dependents: string[] = [];
  const search = (nodeList: FeatureNode[]) => {
    for (const node of nodeList) {
      if (node.dependencies?.includes(targetId)) {
        dependents.push(node.name);
      }
      if (node.children) search(node.children);
    }
  };
  search(nodes);
  return dependents;
};

export default function FeatureTree() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = selectedId ? findNode(featureTree, selectedId) : null;
  const dependents = selectedId ? findDependents(featureTree, selectedId) : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Feature Tree</h1>
          <p className="text-muted-foreground">
            Interactive map of CrooHQ features and their connections
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tree View */}
          <div className="lg:col-span-2 bg-card/50 backdrop-blur-sm rounded-2xl border p-4 max-h-[70vh] overflow-auto">
            {featureTree.map((node) => (
              <TreeNode 
                key={node.id} 
                node={node}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </div>

          {/* Details Panel */}
          <div className="bg-card/50 backdrop-blur-sm rounded-2xl border p-6">
            <AnimatePresence mode="wait">
              {selectedNode ? (
                <motion.div
                  key={selectedNode.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <div 
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                    style={{ backgroundColor: selectedNode.color + '30' }}
                  >
                    <selectedNode.icon 
                      className="w-8 h-8" 
                      style={{ color: selectedNode.color }} 
                    />
                  </div>
                  
                  <h2 className="text-xl font-bold mb-4">{selectedNode.name}</h2>

                  {selectedNode.dependencies && selectedNode.dependencies.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">
                        Depends On
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedNode.dependencies.map((dep) => (
                          <span 
                            key={dep}
                            className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded-md text-xs font-medium cursor-pointer hover:bg-blue-500/30 transition-colors"
                            onClick={() => setSelectedId(dep)}
                          >
                            {dep}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {dependents.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">
                        Used By
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {dependents.map((dep) => (
                          <span 
                            key={dep}
                            className="px-2 py-1 bg-green-500/20 text-green-400 rounded-md text-xs font-medium"
                          >
                            {dep}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedNode.children && (
                    <div className="mt-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">
                        Sub-features
                      </h3>
                      <div className="space-y-1">
                        {selectedNode.children.map((child) => (
                          <div 
                            key={child.id}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary transition-colors"
                            onClick={() => setSelectedId(child.id)}
                          >
                            <child.icon className="w-3 h-3" style={{ color: child.color }} />
                            {child.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center text-muted-foreground py-12"
                >
                  <p>Select a feature to see details</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
