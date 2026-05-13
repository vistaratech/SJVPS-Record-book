import { useCallback, memo, useState, startTransition, useDeferredValue, useMemo } from 'react';
import { Menu, Search, Plus, FileText, X, Folder, FileSpreadsheet, ClipboardPaste, Pencil, Trash2, PlusCircle, FolderPlus, Bell, User, Activity, LayoutTemplate, LogOut, CloudUpload, Clock, CheckCircle2, XCircle, Shield } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import type { RegisterSummary, Business } from '../../lib/api';
import { getRegister, listFolders, createFolder, renameFolder, deleteFolder, moveRegisterToFolder, duplicateRegister, searchAllRegisters } from '../../lib/api';
interface SidebarProps {
  businesses?: Business[];
  filtered?: RegisterSummary[];
  search: string;
  setSearch: (v: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  menuId: number | null;
  setMenuId: (id: number | null) => void;
  onInputFolder?: () => void;
  onInputExcel?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  importSession?: import('../../pages/HomePage').ImportSession | null;
  onClearImport?: () => void;
  clipboard: { id: number, type: 'copy' | 'move' } | null;
  setClipboard: (v: { id: number, type: 'copy' | 'move' } | null) => void;
  sidebarWidth?: number;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  unreadCount: number;
  onToggleNotifications: () => void;
}

export const Sidebar = memo(function Sidebar({
  businesses,
  filtered,
  search,
  setSearch,
  sidebarOpen,
  setSidebarOpen,
  menuId,
  setMenuId,
  onInputFolder,
  onInputExcel,
  importSession,
  onClearImport,
  clipboard,
  setClipboard,
  sidebarWidth,
  isCollapsed,
  toggleCollapse,
  unreadCount,
  onToggleNotifications
}: SidebarProps) {
  const navigate = useNavigate();
  const { id: currentRegId } = useParams();
  const queryClient = useQueryClient();
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderMenuId, setFolderMenuId] = useState<number | null>(null);

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isFooterMenuOpen, setIsFooterMenuOpen] = useState(false);

  const businessId = businesses?.[0]?.id;
  const deferredSearch = useDeferredValue(search);
  const { logout, user: authUser } = useAuth();
  const isSystemAdmin = (authUser as any)?.role === 'admin' || (authUser as any)?.role === 'superadmin';

  const { data: folders = [] } = useQuery({
    queryKey: ['folders', businessId],
    queryFn: () => listFolders(businessId!),
    enabled: !!businessId,
  });

  const { data: register } = useQuery({
    queryKey: ['register', Number(currentRegId)],
    queryFn: () => getRegister(Number(currentRegId)),
    enabled: !!currentRegId,
  });

  const [showNotifications, setShowNotifications] = useState(false);

  const notifications = useMemo(() => {
    if (!register?.entries || register.entries.length < 2) return [];
    
    const notifs: any[] = [];
    const entries = register.entries;
    const seen = new Map<string, number>(); 
    
    for (const entry of entries) {
      if (!entry.cells || Object.keys(entry.cells).length === 0) continue; 
      
      const validCells: Record<string, any> = {};
      Object.entries(entry.cells).forEach(([k, v]) => {
         if (v && String(v).trim() !== '') validCells[k] = v;
      });
      
      if (Object.keys(validCells).length === 0) continue;
      
      const signature = JSON.stringify(validCells, Object.keys(validCells).sort());
      
      if (seen.has(signature)) {
        notifs.push({
          id: `dup-${entry.id}`,
          type: 'warning',
          title: 'Double Entry Warning',
          message: `Identical data detected in row.`,
          entryId: entry.id,
          timestamp: new Date()
        });
      } else {
        seen.set(signature, entry.id);
      }
    }
    
    return notifs.reverse();
  }, [register?.entries]);

  const handleNotificationClick = (entryId: number) => {
    setShowNotifications(false);
    if (sidebarOpen) setSidebarOpen(false);
    const rowEl = document.getElementById(`row-${entryId}`);
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      rowEl.style.transition = 'background-color 0.5s';
      const originalBg = rowEl.style.backgroundColor;
      rowEl.style.backgroundColor = '#fff3cd';
      setTimeout(() => {
        rowEl.style.backgroundColor = originalBg;
      }, 2000);
    } else {
      alert('Row not found on current page. Please change page.');
    }
  };

  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['globalSearch', businessId, deferredSearch],
    queryFn: () => searchAllRegisters(businessId!, deferredSearch),
    enabled: !!businessId && deferredSearch.trim().length >= 2,
    staleTime: 60 * 1000,
  });


  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder(businessId!, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['folders', businessId] }),
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameFolder(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['folders', businessId] }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: number) => deleteFolder(id),
    onSuccess: (_, deletedId) => {
      queryClient.setQueryData(['folders', businessId], (old: any[] | undefined) => {
        return (old || []).filter(f => f.id !== deletedId);
      });
      queryClient.setQueryData(['registers', businessId], (old: RegisterSummary[] | undefined) => {
        return (old || []).map(r => r.folderId === deletedId ? { ...r, folderId: undefined } : r);
      });
      queryClient.invalidateQueries({ queryKey: ['folders', businessId] });
      queryClient.invalidateQueries({ queryKey: ['registers', businessId] });
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ regId, fId }: { regId: number; fId: number | null }) => moveRegisterToFolder(regId, fId),
    onSuccess: (_, variables) => {
      queryClient.setQueryData(['registers', businessId], (old: RegisterSummary[] | undefined) => {
        return (old || []).map(r => r.id === variables.regId ? { ...r, folderId: variables.fId === null ? undefined : variables.fId } : r);
      });
      queryClient.invalidateQueries({ queryKey: ['registers', businessId] });
    },
  });

  const handlePaste = async (folderId: number | null) => {
    if (!clipboard) return;
    if (clipboard.type === 'move') {
      await moveMutation.mutateAsync({ regId: clipboard.id, fId: folderId });
    } else if (clipboard.type === 'copy') {
      const newReg = await duplicateRegister(clipboard.id);
      await moveMutation.mutateAsync({ regId: newReg.id, fId: folderId });
    }
    setClipboard(null);
    setFolderMenuId(null);
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolderMutation.mutate(newFolderName.trim(), {
        onSuccess: () => {
          setIsCreatingFolder(false);
          setNewFolderName('');
        }
      });
    }
  };

  const prefetchRegister = useCallback((regId: number) => {
    queryClient.prefetchQuery({
      queryKey: ['register', regId],
      queryFn: () => getRegister(regId),
      staleTime: 5 * 60 * 1000,
    });
  }, [queryClient]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);

  const renderRegister = (reg: RegisterSummary, indent: number = 0) => (
    <div
      key={reg.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', reg.id.toString());
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`register-item ${Number(currentRegId) === reg.id ? 'active' : ''}`}
      onClick={() => { startTransition(() => { navigate(`/register/${reg.id}`); closeSidebar(); }); }}
      onMouseEnter={() => prefetchRegister(reg.id)}
      style={!isCollapsed && indent ? { paddingLeft: `${16 + indent}px` } : undefined}
      data-tooltip={isCollapsed ? reg.name : undefined}
    >
      <div
        className="register-icon-bg"
        {...{ style: { '--dyn-bg': reg.iconColor ? `${reg.iconColor}20` : 'rgba(27,42,74,0.08)' } as React.CSSProperties }}
      >
        <FileText size={16} color={reg.iconColor || 'var(--navy)'} />
      </div>
      <div className="register-item-info">
        <div className="register-item-name">{reg.name}</div>
        <div className="register-item-meta">{reg.entryCount} entries {!isCollapsed && `• ${new Date(reg.updatedAt).toLocaleDateString()}`}</div>
        {!isCollapsed && reg.lastActivity && <div className="register-item-activity">{reg.lastActivity}</div>}
      </div>
      <button
        className="register-item-menu"
        title="Register options"
        aria-label="Register options"
        onClick={(e) => { e.stopPropagation(); setMenuId(menuId === reg.id ? null : reg.id); }}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--muted)' }}
      >
        <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-1px', lineHeight: 1 }}>⋮</span>
      </button>
    </div>
  );

  return (
    <>
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}
      
      {/* ── Folder Context Menu ── */}
      {folderMenuId !== null && (
        <div className="modal-overlay" onClick={() => setFolderMenuId(null)}>
          <div className="context-menu" onClick={(e) => e.stopPropagation()}>
            <div className="context-title">{folders.find(f => f.id === folderMenuId)?.name || 'Folder'}</div>
            <button className="context-item" onClick={() => {
              const name = prompt('Rename folder:', folders.find(f => f.id === folderMenuId)?.name || '');
              if (name && name.trim()) renameFolderMutation.mutate({ id: folderMenuId, name: name.trim() });
              setFolderMenuId(null);
            }}>
              <Pencil size={16} />Rename
            </button>
            <button 
              className="context-item" 
              onClick={() => handlePaste(folderMenuId)}
              disabled={!clipboard}
              style={{ opacity: !clipboard ? 0.5 : 1, cursor: !clipboard ? 'not-allowed' : 'pointer' }}
            >
              <ClipboardPaste size={16} />Paste {clipboard ? (clipboard.type === 'move' ? '(Move)' : '(Copy)') : ''}
            </button>
            <button className="context-item danger" onClick={() => {
              if (confirm('Delete this folder? Its registers will remain as unassigned.')) {
                deleteFolderMutation.mutate(folderMenuId);
              }
              setFolderMenuId(null);
            }}>
              <Trash2 size={16} />Delete
            </button>
          </div>
        </div>
      )}

      <div className="mobile-topbar">
        <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <div className="mobile-topbar-brand">
          <img src="/logo-transparent.png" alt="AG Trust" className="mobile-topbar-logo" />
          <span style={{ fontWeight: 700 }}>AG Trust</span>
        </div>
        <div style={{ width: 40 }} /> {/* Spacer for balance */}
      </div>

      {/* ── Sidebar ── */}
      <div
        className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''} ${isCollapsed ? 'sidebar--collapsed' : ''}`}
        style={sidebarWidth && !isCollapsed ? { width: sidebarWidth, minWidth: sidebarWidth } : undefined}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-group" onClick={() => navigate('/')}>
            <img src="/logo-transparent.png" alt="AG Trust" className="sidebar-brand-logo" />
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-name">AG <span>Trust</span></div>
              <div className="sidebar-brand-sub">Record Book</div>
            </div>
          </div>
          
          <div className="sidebar-brand-actions">
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
              <X size={18} />
            </button>
            
            <button 
              className="sidebar-collapse-btn" 
              onClick={() => onToggleNotifications()}
              title="Notifications"
              style={{ position: 'relative' }}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="notif-badge">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            <button 
              className="sidebar-collapse-btn" 
              onClick={toggleCollapse}
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><polyline points="13 8 17 12 13 16"></polyline></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="15" y1="3" x2="15" y2="21"></line><polyline points="11 8 7 12 11 16"></polyline></svg>
              )}
            </button>
          </div>
        </div>
        {/* Sidebar Add Button — only visible to users with canCreateSheets permission or admins */}
        {(isSystemAdmin || (authUser as any)?.role === 'sheet_admin' || (authUser as any)?.permissions?.canCreateSheets) && (
        <div className="sidebar-add-section" style={{ padding: '12px 12px 8px', position: 'relative' }}>
          <button 
            className="sidebar-add-btn"
            onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
            title="Add new item"
          >
            <Plus size={18} /> <span className="sidebar-add-text">Add</span>
          </button>

          {isAddMenuOpen && (
            <>
              {/* Backdrop to close menu */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                onClick={() => setIsAddMenuOpen(false)}
              />
              <div 
                className="sidebar-add-dropdown"
                style={{
                  position: 'absolute',
                  top: '0',
                  ...(isCollapsed
                    ? { left: 'calc(100% + 8px)' }   // pop to the RIGHT in collapsed mode
                    : { top: '56px', left: '12px', right: '12px' }  // drop down normally
                  ),
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: '180px',
                  whiteSpace: 'nowrap',
                }}
              >
                <button className="context-item" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }} onClick={() => { navigate('/templates'); setIsAddMenuOpen(false); }}>
                  <PlusCircle size={16} color="var(--navy)" /><span>New Register</span>
                </button>
                <button className="context-item" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }} onClick={() => { setIsCreatingFolder(true); setIsAddMenuOpen(false); }}>
                  <FolderPlus size={16} color="var(--navy)" /><span>New File</span>
                </button>
                <label className="context-item" style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <FileSpreadsheet size={16} color="#107c41" /><span>Input Excel</span>
                  <input type="file" accept=".xlsx, .xls, .csv" className="hidden-file-input" onChange={(e) => { onInputExcel?.(e); setIsAddMenuOpen(false); }} />
                </label>
                <button className="context-item" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }} onClick={() => { onInputFolder?.(); setIsAddMenuOpen(false); }}>
                  <Folder size={16} fill="#fbbf24" color="#f59e0b" /><span>Input File</span>
                </button>
              </div>
            </>
          )}
        </div>
        )}

        {/* Global Search Bar */}
        {!isCollapsed && (
          <div style={{ padding: '4px 16px 12px' }}>
            <div className="gs-input-wrap">
              <Search size={13} className="gs-input-icon" />
              <input
                placeholder="Search all registers…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="gs-input"
                autoComplete="off"
              />
              {search && (
                <button onClick={() => setSearch('')} className="gs-input-clear" title="Clear">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        )}


        {/* Folder creation input moved to a modal or handled via menu */}
        {isCreatingFolder && (
          <div className="sidebar-new-section" style={{ padding: '8px 20px' }}>
            <div className="sidebar-action-row" style={{ display: 'flex', gap: '4px' }}>
              <input 
                type="text" 
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                style={{ flex: 1, padding: '6px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid var(--border)' }}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
              />
              <button 
                onClick={handleCreateFolder}
                style={{ padding: '6px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
              <button 
                onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
                style={{ padding: '6px', background: 'transparent', color: 'var(--muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        
        {importSession && (
          <div className="sidebar-import-session" style={{ margin: '0 1rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Folder size={14} color="var(--primary)" />
                {importSession.folderName}
              </div>
              <button onClick={onClearImport} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px' }} aria-label="Clear import">
                <X size={14} />
              </button>
            </div>
            {importSession.files.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No excel files found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                {importSession.files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: f.status === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span>
                      {f.status === 'waiting' && <Clock size={12} style={{ opacity: 0.6 }} />}
                      {f.status === 'uploading' && <span className="spinner" style={{width: 10, height: 10, borderWidth: 2}}></span>}
                      {f.status === 'success' && <CheckCircle2 size={12} color="var(--secondary)" />}
                      {f.status === 'error' && <XCircle size={12} color="var(--primary)" />}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="sidebar-list sidebar-list--local">
          {search.trim().length > 0 ? (
            <>
              {/* Status line */}
              <div className="gs-status">
                {search.trim().length < 2
                  ? 'Type at least 2 characters…'
                  : isSearching
                    ? 'Searching…'
                    : `${searchResults?.length || 0} results`}
                {isSearching && <div className="gs-status-bar" />}
              </div>

              {/* Results */}
              {searchResults?.map((res, i) => (
                <div
                  key={i}
                  className="gs-card"
                  onClick={() => {
                    startTransition(() => {
                      if (res.entryId !== -1) {
                        navigate(`/register/${res.registerId}?row=${res.entryId}`);
                      } else {
                        navigate(`/register/${res.registerId}`);
                      }
                      closeSidebar();
                    });
                  }}
                >
                  <div className="gs-card-name">
                    {res.entryId === -1 ? <FileSpreadsheet size={13} /> : <FileText size={13} />}
                    <span>{res.registerName}</span>
                  </div>
                  {res.entryId !== -1 && (
                    <div className="gs-card-detail">
                      <span className="gs-badge">Row {res.rowNumber}</span>
                      <span className="gs-match">{res.matchedText.length > 60 ? res.matchedText.slice(0, 60) + '…' : res.matchedText}</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Empty */}
              {!isSearching && deferredSearch.trim().length >= 2 && (!searchResults || searchResults.length === 0) && (
                <div className="gs-empty">No results for "{search}"</div>
              )}
            </>
          ) : (
            <>
              {folders.map(folder => {
                const folderRegs = filtered?.filter(r => r.folderId === folder.id) || [];
                const isExpanded = expandedFolders[folder.id];

                return (
                  <div key={folder.id} className="sidebar-folder-group">
                    <div 
                      className="sidebar-folder-header"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.backgroundColor = 'rgba(30,45,120,0.05)';
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.backgroundColor = 'transparent';
                        const regIdStr = e.dataTransfer.getData('text/plain');
                        if (regIdStr) {
                          moveMutation.mutate({ regId: parseInt(regIdStr, 10), fId: folder.id });
                        }
                      }}
                      onClick={() => setExpandedFolders(prev => ({...prev, [folder.id]: !prev[folder.id] ? true : false}))}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        padding: '8px 12px', 
                        margin: '2px 8px',
                        borderRadius: '8px',
                        cursor: 'pointer', 
                        gap: '10px', 
                        color: 'var(--navy)', 
                        userSelect: 'none',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.03)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      data-tooltip={isCollapsed ? folder.name : undefined}
                    >
                      {!isCollapsed && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px' }}>
                          {isExpanded ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                          )}
                        </div>
                      )}
                      <Folder size={16} fill="#fbbf24" color="#f59e0b" />
                      <span style={{ fontSize: '13px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
                      <button
                        className="register-item-menu"
                        onClick={(e) => { e.stopPropagation(); setFolderMenuId(folderMenuId === folder.id ? null : folder.id); }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--muted)' }}
                      >
                        <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-1px', lineHeight: 1 }}>⋮</span>
                      </button>
                    </div>
                    
                    {isExpanded && (
                      <div className="sidebar-folder-children" style={{ paddingBottom: '4px' }}>
                        {folderRegs.length === 0 ? (
                          <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '4px 12px 4px 44px', fontStyle: 'italic' }}>Empty folder</div>
                        ) : (
                          folderRegs.map(reg => renderRegister(reg, 24))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              
              <div 
                className="sidebar-unassigned-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const regIdStr = e.dataTransfer.getData('text/plain');
                  if (regIdStr) {
                    moveMutation.mutate({ regId: parseInt(regIdStr, 10), fId: null });
                  }
                }}
                style={{ paddingBottom: '20px', minHeight: '100px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Unassigned</span>
                  {clipboard && (
                    <button 
                      onClick={() => handlePaste(null)} 
                      style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <ClipboardPaste size={12} /> Paste Here
                    </button>
                  )}
                </div>
                {filtered?.filter(r => !r.folderId).map(reg => renderRegister(reg, 0))}
              </div>
            </>
          )}
        </div>

        {/* The old bottom search bar has been removed and replaced by the top search bar. */}

        <div 
          className="sidebar-footer" 
          style={{ padding: '12px', display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative', background: isFooterMenuOpen ? '#f1f5f9' : 'transparent', borderTop: '1px solid #e2e8f0', margin: '0 8px', borderRadius: '8px 8px 0 0' }}
          onClick={() => setIsFooterMenuOpen(v => !v)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src="/logo-transparent.png" alt="AG Trust" className="sidebar-footer-logo" style={{ margin: 0, width: '28px', height: '28px', objectFit: 'contain' }} />
            <span className="sidebar-footer-text" style={{ fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap' }}>AG Trust · Record Book</span>
          </div>
        </div>

        {/* Footer Popup Menu — rendered OUTSIDE footer div to avoid click bubbling */}
        {isFooterMenuOpen && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
              onClick={() => setIsFooterMenuOpen(false)}
            />
            <div
              style={{
                position: 'absolute',
                bottom: '60px',
                left: '8px',
                width: '240px',
                background: 'white',
                borderRadius: '8px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                display: 'flex',
                flexDirection: 'column',
                padding: '8px',
                zIndex: 1001,
                border: '1px solid #e2e8f0',
              }}
            >
              <button className="footer-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '6px', color: 'inherit', background: 'transparent', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} onClick={() => { setIsFooterMenuOpen(false); navigate('/profile'); }}>
                <User size={16} /> <span style={{ fontSize: '14px', fontWeight: 500 }}>Profile</span>
              </button>
              <button className="footer-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '6px', color: 'inherit', background: 'transparent', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} onClick={() => { setIsFooterMenuOpen(false); navigate('/history'); }}>
                <Activity size={16} /> <span style={{ fontSize: '14px', fontWeight: 500 }}>Activity Report</span>
              </button>
              <button className="footer-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '6px', color: 'inherit', background: 'transparent', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} onClick={() => { setIsFooterMenuOpen(false); navigate('/recycle-bin'); }}>
                <Trash2 size={16} /> <span style={{ fontSize: '14px', fontWeight: 500 }}>Recycle Bin</span>
              </button>
              <button className="footer-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '6px', color: 'inherit', background: 'transparent', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} onClick={() => { setIsFooterMenuOpen(false); navigate('/templates'); }}>
                <LayoutTemplate size={16} /> <span style={{ fontSize: '14px', fontWeight: 500 }}>Templates</span>
              </button>
              <button className="footer-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '6px', color: '#128C7E', background: 'transparent', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} onClick={() => { setIsFooterMenuOpen(false); navigate('/backup'); }}>
                <CloudUpload size={16} /> <span style={{ fontSize: '14px', fontWeight: 500 }}>Backup & Restore</span>
              </button>
              {isSystemAdmin && (
                <button className="footer-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '6px', color: '#7c3aed', background: 'transparent', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} onClick={() => { setIsFooterMenuOpen(false); sessionStorage.removeItem('admin_workspace_mode'); navigate('/admin/dashboard'); }}>
                  <Shield size={16} /> <span style={{ fontSize: '14px', fontWeight: 500 }}>Admin Dashboard</span>
                </button>
              )}
              <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }} />
              <button className="footer-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '6px', color: '#ef4444', background: 'transparent', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} onClick={() => { setIsFooterMenuOpen(false); logout(); navigate('/login'); }}>
                <LogOut size={16} /> <span style={{ fontSize: '14px', fontWeight: 500 }}>Logout</span>
              </button>
            </div>
          </>
        )}
      </div>
      

      {/* Sliding Notification Panel Overlay */}
      {showNotifications && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
            zIndex: 9998,
            backdropFilter: 'blur(2px)',
            transition: 'opacity 0.3s'
          }}
          onClick={() => setShowNotifications(false)}
        />
      )}
      
      {/* Sliding Notification Panel */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          right: showNotifications ? 0 : '-380px',
          width: '380px',
          height: '100vh',
          backgroundColor: 'white',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          zIndex: 9999,
          transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={16} /> Alerts & Warnings
          </h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {notifications.length > 0 && (
              <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600, background: '#fee2e2', padding: '2px 8px', borderRadius: '12px' }}>
                {notifications.length} new
              </span>
            )}
            <button 
              onClick={() => setShowNotifications(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', color: '#64748b', borderRadius: '4px' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: '#94a3b8', fontSize: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div style={{ padding: '16px', background: '#f1f5f9', borderRadius: '50%' }}>
                <Bell size={32} style={{ opacity: 0.4 }} />
              </div>
              <div>No new alerts<br/><span style={{ fontSize: '13px', fontWeight: 'normal', color: '#cbd5e1' }}>You're all caught up!</span></div>
            </div>
          ) : (
            notifications.map(notif => (
              <div 
                key={notif.id}
                onClick={() => handleNotificationClick(notif.entryId)}
                style={{ 
                  padding: '16px 20px', 
                  borderBottom: '1px solid #f1f5f9', 
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start'
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f8fafc'; e.currentTarget.style.paddingLeft = '24px'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; e.currentTarget.style.paddingLeft = '20px'; }}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', marginTop: '6px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>{notif.title}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>{notif.message}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Click to view row
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
});
