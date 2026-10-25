import { Layout } from '@/components/Layout';
import { PageTitle } from '@/components/PageTitle';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, UserPlus, FlaskConical, RefreshCw, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useDuo } from '@/hooks/useDuo';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check } from 'lucide-react';
import { getDisplayName, getInitials } from '@/utils/displayName';
import { getUserStatusDisplay, getRoleDisplayName } from '@/hooks/useUserManagementData';
import { useUserManagementData } from '@/hooks/useUserManagementData';
import { UserManagementTable } from '@/components/users/UserManagementTable';
import { UserManagementDialogs } from '@/components/users/UserManagementDialogs';

export default function UserManagement() {
  const data = useUserManagementData();
  const navigate = useNavigate();
  const duo = useDuo();
  const activeUsers = (data.users || []).filter((u: any) => u.is_active === (data.activeTab === 'active'));
  const activeCount = (data.users || []).filter((u: any) => u.is_active).length;

  // Duo: orb actions, page status, default docked profile.
  useEffect(() => {
    if (!duo.isDuo) return;
    document.documentElement.dataset.duoStatus = activeCount ? `${activeCount} ACTIVE` : 'NO ACTIVE USERS';
    return () => { delete document.documentElement.dataset.duoStatus; };
  }, [duo.isDuo, activeCount]);
  useEffect(() => {
    if (!duo.isDuo) return;
    const on = (n: string, fn: () => void) => { window.addEventListener(n, fn); return () => window.removeEventListener(n, fn); };
    const offs = [
      on('open-invite-user', () => data.setInviteDialogOpen(true)),
      on('users-test-employee', () => data.handleCreateTestEmployee()),
      on('users-update-outdated', () => (data.isSuperAdmin ? data.handleUniversalUpdate() : data.handleUpdateAllOutdated())),
      on('users-bulk-select', () => data.setBulkMode(true)),
    ];
    return () => offs.forEach((f) => f());
  });
  useEffect(() => {
    if (duo.isDuo && duo.isOpen && !data.viewingUser && activeUsers.length) data.setViewingUser(activeUsers[0]);
  }, [duo.isDuo, duo.isOpen, data.viewingUser, activeUsers.length]);

  if (data.roleLoading || !data.canAccessPage) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (duo.isDuo) {
    return (
      <Layout>
        <div className={duo.isOpen ? 'duo-tasks-page duo-tasks-left' : 'duo-tasks-page'}>
          <PageTitle color="cyan" status={{ text: activeCount ? `${activeCount} ACTIVE` : 'NO ACTIVE USERS' }}>User Management</PageTitle>
          <div className="duo-tasks-ctl duo-ctl mb-2">
            <Tabs value={data.activeTab} onValueChange={(v) => { data.setActiveTab(v as 'active' | 'inactive'); data.setSelectedUsers(new Set()); data.setBulkMode(false); }}>
              <TabsList>
                <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
                <TabsTrigger value="inactive">Inactive ({(data.users || []).length - activeCount})</TabsTrigger>
              </TabsList>
            </Tabs>
            {data.isAdmin && !data.bulkMode && <Button variant="ghost" size="sm" onClick={() => data.setBulkMode(true)}>Select</Button>}
            {data.isAdmin && data.bulkMode && <Button variant="ghost" size="sm" onClick={() => { data.setBulkMode(false); data.setSelectedUsers(new Set()); }}>{data.selectedUsers.size ? 'Done' : 'Cancel'}</Button>}
          </div>
          {data.loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <div className="duo-log-rows">
              {data.isAdmin && data.bulkMode && (
                <label className="duo-user-all"><Checkbox checked={data.selectedUsers.size === activeUsers.length && activeUsers.length > 0} onCheckedChange={data.toggleSelectAll} /> Select all</label>
              )}
              {activeUsers.map((u: any) => {
                const st = getUserStatusDisplay(u);
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`duo-log-row${!data.bulkMode && duo.isOpen && data.viewingUser?.id === u.id ? ' duo-row-sel' : ''}`}
                    onClick={() => {
                      if (data.bulkMode) { data.toggleUserSelection(u.id); return; }
                      data.setViewingUser(u);
                      if (!duo.isOpen) data.setIsProfileDialogOpen(true);
                    }}
                  >
                    {data.isAdmin && data.bulkMode && <Checkbox checked={data.selectedUsers.has(u.id)} className="mt-2" />}
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarImage src={u.profile_photo_url || undefined} />
                      <AvatarFallback>{getInitials(getDisplayName(u.full_name, u.nickname))}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="duo-log-top"><b>{getDisplayName(u.full_name, u.nickname) || 'No name'}</b><small>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}</small></span>
                      <span className="duo-log-cat">{getRoleDisplayName(u.role!)}</span>
                      <span className="duo-log-tags" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Badge variant={st.variant} className="text-xs px-1.5 py-0">{st.label}</Badge>
                        {u.has_certification ? <Check className="h-4 w-4 text-green-500" /> : <span className="text-red-500 text-sm">no cert</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <UserManagementDialogs data={data} duoDock={duo.isOpen} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div>
        <PageTitle color="cyan" status={{ text: (() => { const n = (data.users || []).filter((u: any) => u.is_active).length; return n ? `${n} ACTIVE` : 'NO ACTIVE USERS'; })() }}>User Management</PageTitle>

        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <CardDescription>Manage user roles and permissions</CardDescription>
              {data.isAdmin && (
                <div className="flex items-center gap-2">
                  {data.currentLocation?.name?.toLowerCase() === 'hemet' && (
                    <Button variant="outline" className="gap-2" onClick={data.handleCreateTestEmployee} disabled={data.creatingTestUser}>
                      {data.creatingTestUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                      <span className="hidden sm:inline">Add Test Employee</span>
                    </Button>
                  )}
                  {data.isSuperAdmin && (
                    <Button variant="outline" className="gap-2" onClick={data.handleUniversalUpdate} disabled={data.updatingOutdated}>
                      {data.updatingOutdated ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                      <span className="hidden sm:inline">Universal Update</span>
                      <span className="sm:hidden">Update</span>
                    </Button>
                  )}
                  {data.outdatedUsers.length > 0 && !data.isSuperAdmin && (
                    <Button variant="outline" className="gap-2" onClick={data.handleUpdateAllOutdated} disabled={data.updatingOutdated}>
                      {data.updatingOutdated ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      <span className="hidden sm:inline">Update {data.outdatedUsers.length} Outdated</span>
                      <span className="sm:hidden">{data.outdatedUsers.length}</span>
                    </Button>
                  )}
                  <Dialog open={data.inviteDialogOpen} onOpenChange={data.setInviteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2 flex-1 md:flex-none">
                        <UserPlus className="h-4 w-4" />
                        <span className="hidden sm:inline">Invite User</span>
                        <span className="sm:hidden">Invite</span>
                      </Button>
                    </DialogTrigger>
                  </Dialog>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            <UserManagementTable
              users={data.users}
              loading={data.loading}
              activeTab={data.activeTab}
              setActiveTab={data.setActiveTab}
              bulkMode={data.bulkMode}
              setBulkMode={data.setBulkMode}
              selectedUsers={data.selectedUsers}
              setSelectedUsers={data.setSelectedUsers}
              toggleUserSelection={data.toggleUserSelection}
              toggleSelectAll={data.toggleSelectAll}
              isAdmin={data.isAdmin}
              isSuperAdmin={data.isSuperAdmin}
              currentVersion={data.currentVersion}
              onViewUser={(u) => { data.setViewingUser(u); data.setIsProfileDialogOpen(true); }}
            />
          </CardContent>
        </Card>

        {/* Certifications Section */}
        <div className="border-t pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Certifications</h2>
              <p className="text-sm text-muted-foreground">Track food handler cards and ServSafe certifications</p>
            </div>
            <Button onClick={() => navigate('/certifications')} variant="outline">Manage Certifications</Button>
          </div>
        </div>

        <UserManagementDialogs data={data} />
      </div>
    </Layout>
  );
}
