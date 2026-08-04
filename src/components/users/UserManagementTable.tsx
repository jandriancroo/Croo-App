import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Shield, UserCog, User, Check, RefreshCw } from 'lucide-react';
import { getDisplayName, getInitials } from '@/utils/displayName';
import { triggerForceReload } from '@/hooks/useForceReload';
import { useToast } from '@/hooks/use-toast';
import { type AppRole } from '@/hooks/useUserRole';
import {
  type UserProfile,
  getUserStatusDisplay,
  getVersionDisplay,
  getRoleDisplayName,
} from '@/hooks/useUserManagementData';

interface UserManagementTableProps {
  users: UserProfile[];
  loading: boolean;
  activeTab: 'active' | 'inactive';
  setActiveTab: (tab: 'active' | 'inactive') => void;
  bulkMode: boolean;
  setBulkMode: (v: boolean) => void;
  selectedUsers: Set<string>;
  setSelectedUsers: (s: Set<string>) => void;
  toggleUserSelection: (id: string) => void;
  toggleSelectAll: () => void;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  currentVersion: string;
  onViewUser: (user: UserProfile) => void;
}

const getRoleIcon = (role: AppRole) => {
  switch (role) {
    case 'super_admin':
    case 'brand_admin':
    case 'org_admin':
    case 'admin':
      return <Shield className="h-4 w-4" />;
    case 'manager':
    case 'shift_manager':
    case 'shift_manager_in_training':
      return <UserCog className="h-4 w-4" />;
    default:
      return <User className="h-4 w-4" />;
  }
};

const getRoleBadgeVariant = (role: AppRole) => {
  switch (role) {
    case 'super_admin': return 'destructive';
    case 'brand_admin':
    case 'org_admin':
    case 'admin': return 'default';
    case 'manager':
    case 'shift_manager':
    case 'shift_manager_in_training': return 'secondary';
    default: return 'outline';
  }
};

export const UserManagementTable = ({
  users, loading, activeTab, setActiveTab, bulkMode, setBulkMode,
  selectedUsers, setSelectedUsers, toggleUserSelection, toggleSelectAll,
  isAdmin, isSuperAdmin, currentVersion, onViewUser,
}: UserManagementTableProps) => {
  const { toast } = useToast();

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <Tabs value={activeTab} onValueChange={(v) => {
          setActiveTab(v as 'active' | 'inactive');
          setSelectedUsers(new Set());
          setBulkMode(false);
        }}>
          <TabsList>
            <TabsTrigger value="active">Active ({users.filter(u => u.is_active).length})</TabsTrigger>
            <TabsTrigger value="inactive">Inactive ({users.filter(u => !u.is_active).length})</TabsTrigger>
          </TabsList>
        </Tabs>
        {isAdmin && !bulkMode && (
          <Button variant="ghost" size="sm" onClick={() => setBulkMode(true)}>Select</Button>
        )}
        {isAdmin && bulkMode && selectedUsers.size === 0 && (
          <Button variant="ghost" size="sm" onClick={() => setBulkMode(false)}>Cancel</Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Table className="w-full table-fixed md:table-auto">
          <TableHeader>
            <TableRow>
              {isAdmin && bulkMode && (
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedUsers.size === users.filter(u => u.is_active === (activeTab === 'active')).length && users.filter(u => u.is_active === (activeTab === 'active')).length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
              )}
              <TableHead>User</TableHead>
              <TableHead className="hidden md:table-cell w-[90px]">Status</TableHead>
              <TableHead className="hidden md:table-cell w-[120px]">Role</TableHead>
              {isSuperAdmin && <TableHead className="hidden md:table-cell w-[130px]">Version</TableHead>}
              <TableHead className="hidden md:table-cell w-[100px] whitespace-nowrap">Last Login</TableHead>
              <TableHead className="hidden md:table-cell w-[40px]">Cert</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.filter(u => u.is_active === (activeTab === 'active')).map((u) => (
              <TableRow key={u.id} className="hover:bg-muted/50">
                {isAdmin && bulkMode && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedUsers.has(u.id)} onCheckedChange={() => toggleUserSelection(u.id)} />
                  </TableCell>
                )}
                <TableCell className="cursor-pointer w-full" onClick={() => onViewUser(u)}>
                  <div className="flex items-center gap-3 w-full">
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarImage src={u.profile_photo_url || undefined} />
                      <AvatarFallback>{getInitials(getDisplayName(u.full_name, u.nickname))}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="hidden md:block">
                        <div className="font-medium truncate">{getDisplayName(u.full_name, u.nickname) || 'No name'}</div>
                        <div className="text-sm text-muted-foreground truncate">{u.email}</div>
                      </div>
                      <div className="md:hidden">
                        <div className="font-medium truncate">{getDisplayName(u.full_name, u.nickname) || 'No name'}</div>
                        <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <Badge variant={getUserStatusDisplay(u).variant} className="text-[10px] px-1.5 py-0">
                            {getUserStatusDisplay(u).label}
                          </Badge>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">{getRoleDisplayName(u.role!)}</span>
                          {isSuperAdmin && u.app_version && (
                            <>
                              <span className="text-muted-foreground">•</span>
                              <span className={`font-mono ${getVersionDisplay(u.app_version, currentVersion).className}`}>
                                {getVersionDisplay(u.app_version, currentVersion).text}
                              </span>
                              {!getVersionDisplay(u.app_version, currentVersion).isCurrent && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-4 w-4 p-0 ml-0.5"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await triggerForceReload(u.id);
                                    toast({ title: 'Update signal sent', description: `${u.full_name || 'User'} will reload on next active session.` });
                                  }}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell whitespace-nowrap">
                  <Badge variant={getUserStatusDisplay(u).variant} className="whitespace-nowrap">{getUserStatusDisplay(u).label}</Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell whitespace-nowrap">
                  <Badge variant={getRoleBadgeVariant(u.role!) as any} className="gap-1 whitespace-nowrap">
                    {getRoleIcon(u.role!)}
                    {getRoleDisplayName(u.role!)}
                  </Badge>
                </TableCell>
                {isSuperAdmin && (
                  <TableCell className="hidden md:table-cell">
                    {(() => {
                      const versionInfo = getVersionDisplay(u.app_version, currentVersion);
                      const isOutdated = !versionInfo.isCurrent && u.app_version;
                      return (
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono ${versionInfo.className}`}>{versionInfo.text}</span>
                          {isOutdated && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Force reload for this user"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await triggerForceReload(u.id);
                                toast({ title: 'Update signal sent', description: `${u.full_name || 'User'} will reload on next active session.` });
                              }}
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                )}
                <TableCell className="hidden md:table-cell whitespace-nowrap">
                  {u.last_login_at ? (
                    <span className="text-xs text-muted-foreground">
                      {new Date(u.last_login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex items-center justify-center">
                    {u.has_certification ? <Check className="h-5 w-5 text-green-500" /> : <span className="text-red-500 text-lg">×</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
};
