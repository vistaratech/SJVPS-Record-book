import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { firebaseGetUsers, firebaseUpdatePermissions, firebaseAdminChangePassword, firebaseUpdateUser } from '../../lib/firebaseAuth';
import { listBusinesses, listRegisters, getRegisterColumnsOnly, listFolders, type RegisterDetail, type Folder } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ArrowLeft, FileText, Shield, Eye, Edit3, Download, EyeOff, Lock, ChevronDown, ChevronRight, X, Play, Check, Search, FolderOpen, Users } from 'lucide-react';
import { useNotifications } from '../../lib/NotificationContext';

export default function AdminUserSettingsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const { token } = useAuth();
  
  const [user, setUser] = useState<any>(null);
  const [registers, setRegisters] = useState<RegisterDetail[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setSaving] = useState(false);

  const [newPw, setNewPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [viewRestrictions, setViewRestrictions] = useState<Record<string, number[]>>({});
  const [downloadRestrictions, setDownloadRestrictions] = useState<Record<string, number[]>>({});
  const [editRestrictions, setEditRestrictions] = useState<Record<string, number[]>>({});
  const [createRestrictions, setCreateRestrictions] = useState<Record<string, boolean>>({});
  const [rowViewRestrictions, setRowViewRestrictions] = useState<Record<string, { start?: number, end?: number }>>({});
  const [rowEditRestrictions, setRowEditRestrictions] = useState<Record<string, { start?: number, end?: number }>>({});
  const [rowDownloadRestrictions, setRowDownloadRestrictions] = useState<Record<string, { start?: number, end?: number }>>({});
  const [globalPerms, setGlobalPerms] = useState({
    canView: true,
    canEdit: false,
    canDownload: false,
    isAdmin: false,
    fullSheetAccess: false
  });

  const [expandedRegId, setExpandedRegId] = useState<number | null>(null);
  const [sheetAccessGranted, setSheetAccessGranted] = useState<Record<string, boolean>>({});
  const [rangeInputs, setRangeInputs] = useState<Record<string, any>>({});
  const [previewReg, setPreviewReg] = useState<RegisterDetail | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<number | string, boolean>>({});
  const [userRole, setUserRole] = useState<string>('user');



  const applyCommonRangeRow = async (regId: string | number) => {
    const regIdStr = regId.toString();
    const reg = registers.find(r => r.id.toString() === regIdStr);
    const defaultEnd = reg?.entryCount || reg?.entries?.length || '';

    const startStr = rangeInputs[regIdStr]?.commonStart !== undefined 
      ? rangeInputs[regIdStr].commonStart 
      : (rowViewRestrictions[regIdStr]?.start?.toString() || '1');
    const endStr = rangeInputs[regIdStr]?.commonEnd !== undefined 
      ? rangeInputs[regIdStr].commonEnd 
      : (rowViewRestrictions[regIdStr]?.end?.toString() || defaultEnd.toString());
    
    const s = parseInt(startStr, 10);
    const e = parseInt(endStr, 10);
    
    const rangeObj = (isNaN(s) && isNaN(e)) ? null : { start: isNaN(s) ? undefined : s, end: isNaN(e) ? undefined : e };

    // Update state locally first
    if (!rangeObj) {
      setRowViewRestrictions(prev => { const nm = {...prev}; delete nm[regIdStr]; return nm; });
      setRowEditRestrictions(prev => { const nm = {...prev}; delete nm[regIdStr]; return nm; });
      setRowDownloadRestrictions(prev => { const nm = {...prev}; delete nm[regIdStr]; return nm; });
    } else {
      setRowViewRestrictions(prev => ({ ...prev, [regIdStr]: rangeObj }));
      setRowEditRestrictions(prev => ({ ...prev, [regIdStr]: rangeObj }));
      setRowDownloadRestrictions(prev => ({ ...prev, [regIdStr]: rangeObj }));
    }

    // Force an immediate save and wait for it
    try {
      // Create a temporary object to simulate what the save will send
      const tempRowView = { ...rowViewRestrictions };
      if (!rangeObj) delete tempRowView[regIdStr]; else tempRowView[regIdStr] = rangeObj;
      
      await handleSave(true, { 
        overrideRowView: tempRowView,
        overrideRowEdit: tempRowView,
        overrideRowDownload: tempRowView
      });
      
      addNotification({ 
        title: 'Success', 
        message: rangeObj ? `Applied row range ${s || 1} to ${e || 'end'}` : 'Cleared row range', 
        type: 'success' 
      });
    } catch (err) {
      addNotification({ title: 'Error', message: 'Failed to save changes. Please try again.', type: 'error' });
    }
  };

  const selectAllCommonRows = async (regId: number) => {
    setRowViewRestrictions(prev => { const nm = {...prev}; delete nm[regId]; return nm; });
    setRowEditRestrictions(prev => { const nm = {...prev}; delete nm[regId]; return nm; });
    setRowDownloadRestrictions(prev => { const nm = {...prev}; delete nm[regId]; return nm; });
    setRangeInputs(prev => ({ ...prev, [regId]: { commonStart: '', commonEnd: '' } }));
    
    setTimeout(() => handleSave(true), 100);
    addNotification({ title: 'Success', message: `Restricted to all rows`, type: 'success' });
  };

  const selectAllCols = (type: 'view' | 'edit' | 'download', regId: number) => {
    if (type === 'view') {
      setViewRestrictions(prev => { const nextMap = { ...prev }; delete nextMap[regId]; return nextMap; });
    } else {
      const setState = type === 'edit' ? setEditRestrictions : setDownloadRestrictions;
      setState(prev => { const nextMap = { ...prev }; delete nextMap[regId]; return nextMap; });
      setViewRestrictions(prev => { const nextMap = { ...prev }; delete nextMap[regId]; return nextMap; });
    }
  };

  const clearAll = (type: 'view' | 'edit' | 'download', regId: number) => {
    if (type === 'view') {
      setViewRestrictions(prev => ({ ...prev, [regId]: [] }));
      setEditRestrictions(prev => ({ ...prev, [regId]: [] }));
      setDownloadRestrictions(prev => ({ ...prev, [regId]: [] }));
    } else {
      const setState = type === 'edit' ? setEditRestrictions : setDownloadRestrictions;
      setState(prev => ({ ...prev, [regId]: [] })); // empty array means NONE are selected
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const data = await firebaseGetUsers();
        const users = data.users || [];
        const foundUser = users.find((u: any) => u.id === id);
        if (!foundUser) {
          addNotification({ title: 'Error', message: 'User not found', type: 'error' });
          navigate('/admin/dashboard');
          return;
        }
        // Protect superadmin — cannot edit superadmin settings
        if (foundUser.role === 'superadmin') {
          addNotification({ title: 'Protected', message: 'The Super Admin account cannot be modified. It has permanent full access.', type: 'error' });
          navigate('/admin/dashboard');
          return;
        }
        setUser(foundUser);
        setUserRole(foundUser.role || 'user');
        if ((foundUser as any).password) {
          setNewPw((foundUser as any).password);
        }
        
        const p = foundUser.permissions || {};
        setGlobalPerms({
          canView: p.canView ?? true,
          canEdit: p.canEdit ?? false,
          canDownload: p.canDownload ?? false,
          isAdmin: p.isAdmin ?? false,
          fullSheetAccess: p.fullSheetAccess ?? false
        });

        if (p.viewRestrictions && typeof p.viewRestrictions === 'object') {
          setViewRestrictions(p.viewRestrictions);
          // Build initial sheetAccessGranted from saved viewRestrictions
          const accessMap: Record<string, boolean> = {};
          for (const key of Object.keys(p.viewRestrictions)) {
            accessMap[key] = true;
          }
          setSheetAccessGranted(accessMap);
        }
        if (p.downloadRestrictions && typeof p.downloadRestrictions === 'object') {
          setDownloadRestrictions(p.downloadRestrictions);
        }
        if (p.editRestrictions && typeof p.editRestrictions === 'object') {
          setEditRestrictions(p.editRestrictions);
        }
        if (p.createRestrictions && typeof p.createRestrictions === 'object') {
          setCreateRestrictions(p.createRestrictions);
        }
        if (p.rowViewRestrictions && typeof p.rowViewRestrictions === 'object') {
          setRowViewRestrictions(p.rowViewRestrictions);
        }
        if (p.rowEditRestrictions && typeof p.rowEditRestrictions === 'object') {
          setRowEditRestrictions(p.rowEditRestrictions);
        }
        if (p.rowDownloadRestrictions && typeof p.rowDownloadRestrictions === 'object') {
          setRowDownloadRestrictions(p.rowDownloadRestrictions);
        }

        // Initialize range inputs from saved restrictions so they appear on reload
        const initialRangeInputs: Record<string, any> = {};
        const processRowPerms = (perms: any, startKey: string, endKey: string) => {
          if (perms && typeof perms === 'object') {
            for (const key of Object.keys(perms)) {
              if (!initialRangeInputs[key]) initialRangeInputs[key] = {};
              if (perms[key].start !== undefined) initialRangeInputs[key][startKey] = perms[key].start.toString();
              if (perms[key].end !== undefined) initialRangeInputs[key][endKey] = perms[key].end.toString();
            }
          }
        };
        processRowPerms(p.rowViewRestrictions, 'commonStart', 'commonEnd');
        // We still process the others just in case they differ, but we rely on common for UI now
        processRowPerms(p.rowViewRestrictions, 'viewStart', 'viewEnd');
        processRowPerms(p.rowEditRestrictions, 'editStart', 'editEnd');
        processRowPerms(p.rowDownloadRestrictions, 'dlStart', 'dlEnd');
        if (Object.keys(initialRangeInputs).length > 0) {
          setRangeInputs(initialRangeInputs);
        }

        const busList = await listBusinesses();
        const busId = busList[0]?.id || 1;
        const summs = await listRegisters(busId);
        const fullRegs = await Promise.all(summs.map(s => getRegisterColumnsOnly(s.id)));
        setRegisters(fullRegs.filter(Boolean) as RegisterDetail[]);
        
        const flds = await listFolders(busId);
        setFolders(flds);

      } catch (err) {
        addNotification({ title: 'Error', message: 'Failed to load user settings', type: 'error' });
      } finally {
        setLoading(false);
      }
    }
    if (id && token) loadData();
  }, [id, token, navigate, addNotification]);

  const handleSave = async (silent = false, overrides?: any) => {
    if (!user || !token) return;
    if (!silent) setSaving(true);
    try {
      const finalViewRestrictions: Record<string, number[]> = {};
      const finalEditRestrictions: Record<string, number[]> = {};
      const finalDownloadRestrictions: Record<string, number[]> = {};
      const finalCreateRestrictions: Record<string, boolean> = {};
      const finalRowViewRestrictions: Record<string, any> = overrides?.overrideRowView || { ...rowViewRestrictions };
      const finalRowEditRestrictions: Record<string, any> = overrides?.overrideRowEdit || { ...rowEditRestrictions };
      const finalRowDownloadRestrictions: Record<string, any> = overrides?.overrideRowDownload || { ...rowDownloadRestrictions };

      const allSheetIds = new Set([
        ...Object.keys(sheetAccessGranted),
        ...Object.keys(viewRestrictions),
        ...Object.keys(rowViewRestrictions),
        ...Object.keys(editRestrictions),
        ...Object.keys(createRestrictions)
      ]);

      for (const regId of allSheetIds) {
        // Only include permissions for sheets where access is granted
        const hasAccess = sheetAccessGranted[regId] === true;
        if (!hasAccess) continue; // Skip sheets where access was revoked
        
        if (viewRestrictions[regId] !== undefined) finalViewRestrictions[regId] = viewRestrictions[regId];
        if (editRestrictions[regId] !== undefined) finalEditRestrictions[regId] = editRestrictions[regId];
        if (downloadRestrictions[regId] !== undefined) finalDownloadRestrictions[regId] = downloadRestrictions[regId];
        if (createRestrictions[regId] !== undefined) finalCreateRestrictions[regId] = createRestrictions[regId];
      }

      const newPerms = {
        ...globalPerms,
        viewRestrictions: finalViewRestrictions,
        downloadRestrictions: finalDownloadRestrictions,
        editRestrictions: finalEditRestrictions,
        createRestrictions: finalCreateRestrictions,
        rowViewRestrictions: finalRowViewRestrictions,
        rowEditRestrictions: finalRowEditRestrictions,
        rowDownloadRestrictions: finalRowDownloadRestrictions
      };
      
      console.log('[SAVE] Updating permissions for:', user.name, newPerms);
      await firebaseUpdatePermissions(user.id, newPerms);
      if (!silent) addNotification({ title: 'Success', message: 'User settings saved successfully!', type: 'success' });
      setUser({ ...user, permissions: newPerms });
    } catch (err: any) {
      if (!silent) addNotification({ title: 'Error', message: err.message || 'Failed to save settings', type: 'error' });
      console.error('Save failed:', err);
      throw err;
    } finally {
      if (!silent) setSaving(false);
    }
  };

  const initialMount = useRef(true);
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (loading) return;

    const timer = setTimeout(() => {
      handleSave(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [
    globalPerms, viewRestrictions, downloadRestrictions, editRestrictions, 
    createRestrictions, rowViewRestrictions, rowEditRestrictions, 
    rowDownloadRestrictions, sheetAccessGranted
  ]);

  const handleChangePassword = async () => {
    if (!token) return;
    if (!newPw || newPw.length < 6) { 
      addNotification({ title: 'Validation', message: 'Password must be at least 6 characters', type: 'error' });
      return; 
    }
    try {
      await firebaseAdminChangePassword(user.id, newPw);
      setNewPw('');
      addNotification({ title: 'Success', message: 'Password changed successfully', type: 'success' });
    } catch (err: any) {
      addNotification({ title: 'Error', message: err.message || 'Failed to change password', type: 'error' });
    }
  };

  const toggleColumn = (type: 'view' | 'edit' | 'download', regId: number, colIndex: number, allColCount: number) => {
    if (type === 'view') {
      setViewRestrictions(prev => {
        const current = prev[regId] || Array.from({length: allColCount}, (_, i) => i);
        const isSelected = current.includes(colIndex);
        
        if (isSelected) {
          setEditRestrictions(prevEdit => {
            const currentEdit = prevEdit[regId] || Array.from({length: allColCount}, (_, i) => i);
            return { ...prevEdit, [regId]: currentEdit.filter(i => i !== colIndex) };
          });
          setDownloadRestrictions(prevDl => {
            const currentDl = prevDl[regId] || Array.from({length: allColCount}, (_, i) => i);
            return { ...prevDl, [regId]: currentDl.filter(i => i !== colIndex) };
          });
          return { ...prev, [regId]: current.filter(i => i !== colIndex) };
        } else {
          return { ...prev, [regId]: [...current, colIndex].sort((a, b) => a - b) };
        }
      });
    } else {
      const setState = type === 'edit' ? setEditRestrictions : setDownloadRestrictions;
      setState(prev => {
        const current = prev[regId] || Array.from({length: allColCount}, (_, i) => i);
        const isSelected = current.includes(colIndex);
        
        if (!isSelected) {
          setViewRestrictions(prevView => {
            const currentView = prevView[regId] || Array.from({length: allColCount}, (_, i) => i);
            if (!currentView.includes(colIndex)) {
              return { ...prevView, [regId]: [...currentView, colIndex].sort((a, b) => a - b) };
            }
            return prevView;
          });
          return { ...prev, [regId]: [...current, colIndex].sort((a, b) => a - b) };
        } else {
          return { ...prev, [regId]: current.filter(i => i !== colIndex) };
        }
      });
    }
  };



  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading user data...</div>;
  if (!user) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 100, padding: '20px 40px', background: 'white', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/admin/dashboard')} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}>
            <ArrowLeft size={16} /> Back
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', color: 'var(--navy)' }}>User Settings: {user.name || user.email}</h1>
            <div style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '4px' }}>Configure roles, global access, and granular sheet permissions.</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '40px', flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Global Permissions */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={18} /> Global Permissions
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  { k: 'canView', l: 'View Only', icon: <Eye size={16}/>, desc: 'Can view tables' },
                  { k: 'canEdit', l: 'Can Edit', icon: <Edit3 size={16}/>, desc: 'Can edit data' },
                  { k: 'canDownload', l: 'Download Access', icon: <Download size={16}/>, desc: 'Can export data' },
                  { k: 'canCreateSheets', l: 'Can Create Folders & Sheets', icon: <FileText size={16}/>, desc: 'Can add new folders and sheets' },
                  { k: 'isAdmin', l: 'Admin Access', icon: <Shield size={16}/>, desc: 'Full admin access' }
                ].map(({ k, l, icon, desc }) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={(globalPerms as any)[k]} onChange={() => setGlobalPerms(p => ({ ...p, [k]: !(p as any)[k] }))} style={{ width: '18px', height: '18px', accentColor: 'var(--brand-green)' }} />
                    <span style={{ color: 'var(--foreground)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>{icon} {l}</span>
                    <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: 'auto' }}>{desc}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Password & Security */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={18} /> Password & Security
              </h3>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input type={showNewPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Password" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', paddingRight: '36px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px' }} />
                  <button type="button" onClick={() => setShowNewPw(!showNewPw)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex' }}>
                    {showNewPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                  </button>
                </div>
                <button onClick={handleChangePassword} style={{ padding: '0 16px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, var(--navy), var(--navy-light))', color: 'white', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>Update</button>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--muted)' }}>You can view or update the user's password here.</p>
            </div>
          </div>

          {/* Role Selector */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} /> User Role
            </h3>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {[
                { value: 'user', label: 'User', desc: 'Standard user with granular permissions. Use toggles below to control access.', color: 'var(--muted)', bg: 'var(--border-light)' },
                { value: 'admin', label: 'System Admin', desc: 'Full dashboard + workspace + download access. Can manage all users and settings.', color: 'var(--accent)', bg: 'rgba(230,48,18,0.1)' },
              ].map(r => (
                <button key={r.value} onClick={async () => {
                  if (userRole === r.value) return;
                  try {
                    const newPerms = r.value === 'admin'
                      ? { ...globalPerms, canView: true, canEdit: true, canDownload: true, isAdmin: true, fullSheetAccess: true, canCreateSheets: true }
                      : { ...globalPerms, fullSheetAccess: false, isAdmin: false };
                    await firebaseUpdateUser(user.id, { role: r.value });
                    await firebaseUpdatePermissions(user.id, { ...user.permissions, ...newPerms });
                    setUserRole(r.value);
                    setGlobalPerms(newPerms);
                    setUser({ ...user, role: r.value, permissions: { ...user.permissions, ...newPerms } });
                    addNotification({ title: 'Role Updated', message: `${user.name} is now a ${r.label}`, type: 'success' });
                  } catch (err: any) {
                    addNotification({ title: 'Error', message: err.message || 'Failed to update role', type: 'error' });
                  }
                }} style={{
                  flex: '1 1 200px', padding: '16px', borderRadius: '10px', cursor: 'pointer',
                  border: userRole === r.value ? `2px solid ${r.color}` : '2px solid var(--border)',
                  background: userRole === r.value ? r.bg : 'var(--surface)',
                  textAlign: 'left', transition: 'all 0.2s',
                }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: userRole === r.value ? r.color : 'var(--foreground)', marginBottom: '4px' }}>
                    {userRole === r.value && <Check size={14} style={{ marginRight: '6px' }} />}
                    {r.label}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Full Sheet & Folder Access Toggle */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: `1px solid ${(globalPerms as any).fullSheetAccess ? '#6366f1' : 'var(--border)'}`, boxShadow: 'var(--shadow-sm)', transition: 'border-color 0.2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Shield size={18} /> Full Sheet & Folder Access
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', maxWidth: '500px' }}>
                  When enabled, this user can access <strong>all sheets and folders</strong> — view, edit, create sheets, create folders — without needing granular permissions below. When disabled, only the specific sheet permissions assigned below will apply.
                </p>
              </div>
              <button
                onClick={async () => {
                  const newVal = !(globalPerms as any).fullSheetAccess;
                  const newPerms = { ...globalPerms, fullSheetAccess: newVal };
                  try {
                    await firebaseUpdatePermissions(user.id, { ...user.permissions, ...newPerms });
                    setGlobalPerms(newPerms);
                    setUser({ ...user, permissions: { ...user.permissions, ...newPerms } });
                    addNotification({ title: newVal ? 'Full Access Enabled' : 'Full Access Disabled', message: newVal ? `${user.name} now has access to all sheets & folders` : `${user.name} now uses granular permissions only`, type: 'success' });
                  } catch (err: any) {
                    addNotification({ title: 'Error', message: err.message || 'Failed to toggle', type: 'error' });
                  }
                }}
                style={{
                  padding: '10px 24px', borderRadius: '10px', fontWeight: 700, fontSize: '14px',
                  cursor: 'pointer', border: 'none', transition: 'all 0.25s',
                  background: (globalPerms as any).fullSheetAccess
                    ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                    : 'var(--surface)',
                  color: (globalPerms as any).fullSheetAccess ? '#fff' : 'var(--muted)',
                  boxShadow: (globalPerms as any).fullSheetAccess ? '0 4px 15px rgba(99,102,241,0.3)' : 'inset 0 0 0 1px var(--border)',
                  minWidth: '160px',
                }}
              >
                {(globalPerms as any).fullSheetAccess ? (
                  <><Check size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> All Access ON</>
                ) : (
                  <><X size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Granular Only</>
                )}
              </button>
            </div>
            {(globalPerms as any).fullSheetAccess && (
              <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(99,102,241,0.06)', borderRadius: '8px', fontSize: '12px', color: '#6366f1', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Check size={14} /> This user has full access to all sheets and folders. The granular permissions below are bypassed.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--navy)' }}>Granular Sheet Permissions</h3>
            <div style={{ position: 'relative', width: '300px' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input
                type="text"
                placeholder="Search sheets..."
                value={searchQuery}

                onChange={e => setSearchQuery(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 36px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', outline: 'none' }}
              />
            </div>
          </div>
          
          {(() => {
            const filtered = registers.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
            const folderMap: Record<number, typeof filtered> = {};
            const unassigned: typeof filtered = [];
            for (const reg of filtered) {
              if ((reg as any).folderId) {
                if (!folderMap[(reg as any).folderId]) folderMap[(reg as any).folderId] = [];
                folderMap[(reg as any).folderId].push(reg);
              } else {
                unassigned.push(reg);
              }
            }

            const renderSheet = (reg: RegisterDetail) => {
              const cols = [...reg.columns].sort((a, b) => a.position - b.position);
              const allColIndices = cols.map((_, i) => i);
              const viewCols = viewRestrictions[reg.id] || allColIndices;
              const editCols = editRestrictions[reg.id] || allColIndices;
              const dlCols = downloadRestrictions[reg.id] || allColIndices;
              const isExpanded = expandedRegId === reg.id;
              const hasAccess = globalPerms.isAdmin || sheetAccessGranted[reg.id] === true;

              return (
                <div key={reg.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid var(--border)', overflow: 'hidden', opacity: hasAccess ? 1 : 0.6 }}>
                  <div onClick={() => setExpandedRegId(isExpanded ? null : reg.id)} style={{ padding: '16px 20px', borderBottom: isExpanded ? '1px solid var(--border)' : 'none', cursor: 'pointer', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {isExpanded ? <ChevronDown size={20} color="var(--muted)" /> : <ChevronRight size={20} color="var(--muted)" />}
                    <FileText size={20} color="var(--accent)" />
                    <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--navy)', flex: 1 }}>{reg.name} {!hasAccess && <span style={{fontSize: '12px', color: 'var(--destructive)', marginLeft: '8px'}}>(No Access)</span>}</h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button disabled={globalPerms.isAdmin} onClick={(e) => { e.stopPropagation(); if (globalPerms.isAdmin) return; if (hasAccess) { setSheetAccessGranted(prev => ({ ...prev, [reg.id]: false })); } else { setSheetAccessGranted(prev => ({ ...prev, [reg.id]: true })); const defaultCols = cols.length > 0 ? [0] : []; if (!viewRestrictions[reg.id] || viewRestrictions[reg.id].length === 0) setViewRestrictions(prev => ({ ...prev, [reg.id]: defaultCols })); if (!editRestrictions[reg.id] || editRestrictions[reg.id].length === 0) setEditRestrictions(prev => ({ ...prev, [reg.id]: defaultCols })); if (!downloadRestrictions[reg.id] || downloadRestrictions[reg.id].length === 0) setDownloadRestrictions(prev => ({ ...prev, [reg.id]: defaultCols })); } }} style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid', fontSize: '12px', fontWeight: 600, cursor: globalPerms.isAdmin ? 'not-allowed' : 'pointer', background: hasAccess ? '#dcfce7' : 'var(--surface)', color: hasAccess ? '#16a34a' : 'var(--muted)', borderColor: hasAccess ? '#86efac' : 'var(--border)' }}>
                        {hasAccess ? <><Check size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Access Granted</> : 'Grant Access'}
                      </button>
                      <span style={{ fontSize: '12px', color: 'var(--muted)', background: 'var(--surface)', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--border)' }}>{cols.length} Columns</span>
                      <button onClick={(e) => { e.stopPropagation(); setPreviewReg(reg); }} style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--navy)' }}><Play size={12} /> Preview</button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <input type="checkbox" checked={createRestrictions[reg.id] === true} onChange={() => setCreateRestrictions(prev => ({ ...prev, [reg.id]: !prev[reg.id] }))} style={{ width: '18px', height: '18px', accentColor: 'var(--destructive)' }} />
                        <span style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '14px' }}>Can Create Records in this Sheet</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px', background: 'var(--surface)', borderRadius: '10px', padding: '16px', border: '1px solid var(--border)' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)', marginBottom: '8px' }}>Row Access Range (View, Edit, Download)</div>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input type="number" placeholder="From" min={1} value={rangeInputs[reg.id]?.commonStart !== undefined ? rangeInputs[reg.id].commonStart : (rowViewRestrictions[reg.id]?.start || 1)} onChange={e => setRangeInputs(prev => ({ ...prev, [reg.id]: { ...prev[reg.id], commonStart: e.target.value } }))} style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', maxWidth: '150px' }} />
                            <span style={{ color: 'var(--muted)', fontSize: '13px', fontWeight: 500 }}>to</span>
                            <input type="number" placeholder="To row" min={1} value={rangeInputs[reg.id]?.commonEnd !== undefined ? rangeInputs[reg.id].commonEnd : (rowViewRestrictions[reg.id]?.end || reg.entryCount || reg.entries?.length || '')} onChange={e => setRangeInputs(prev => ({ ...prev, [reg.id]: { ...prev[reg.id], commonEnd: e.target.value } }))} style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', maxWidth: '150px' }} />
                            <button onClick={() => applyCommonRangeRow(reg.id)} style={{ padding: '0 16px', height: '35px', background: 'var(--brand-green)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Apply</button>
                            <button onClick={() => selectAllCommonRows(reg.id)} style={{ padding: '0 12px', height: '35px', background: 'var(--surface)', color: 'var(--navy)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>All</button>
                          </div>
                          {rowViewRestrictions[reg.id] && (rowViewRestrictions[reg.id].start || rowViewRestrictions[reg.id].end) && (
                            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '11px', background: '#dcfce7', color: '#16a34a', padding: '3px 8px', borderRadius: '12px', fontWeight: 600, border: '1px solid #86efac' }}>
                                Active Range: Rows {rowViewRestrictions[reg.id].start || 1} – {rowViewRestrictions[reg.id].end || '∞'}
                              </span>
                              <button onClick={() => selectAllCommonRows(reg.id)} style={{ fontSize: '11px', color: 'var(--destructive)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--navy)', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Shield size={16} /> Column-Level Access Control
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead><tr>
                          <th style={{ paddingBottom: '12px', color: 'var(--muted)', fontSize: '13px', fontWeight: 600, width: '60px' }}>S.NO</th>
                          <th style={{ paddingBottom: '12px', color: 'var(--muted)', fontSize: '13px', fontWeight: 600 }}>Column Name</th>
                          <th style={{ paddingBottom: '12px', color: 'var(--muted)', fontSize: '13px', fontWeight: 600, width: '130px', textAlign: 'center', opacity: globalPerms.canView ? 1 : 0.4 }}>
                            <div style={{ marginBottom: '4px' }}>Can View {!globalPerms.canView && <span style={{ fontSize: '10px', color: 'var(--destructive)' }}>OFF</span>}</div>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}><button disabled={!globalPerms.canView} onClick={() => selectAllCols('view', reg.id)} style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: globalPerms.canView ? 'pointer' : 'not-allowed' }}>All</button><button disabled={!globalPerms.canView} onClick={() => clearAll('view', reg.id)} style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: globalPerms.canView ? 'pointer' : 'not-allowed' }}>None</button></div>
                          </th>
                          <th style={{ paddingBottom: '12px', color: 'var(--muted)', fontSize: '13px', fontWeight: 600, width: '130px', textAlign: 'center', opacity: globalPerms.canEdit ? 1 : 0.4 }}>
                            <div style={{ marginBottom: '4px' }}>Can Edit {!globalPerms.canEdit && <span style={{ fontSize: '10px', color: 'var(--destructive)' }}>OFF</span>}</div>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}><button disabled={!globalPerms.canEdit} onClick={() => selectAllCols('edit', reg.id)} style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: globalPerms.canEdit ? 'pointer' : 'not-allowed' }}>All</button><button disabled={!globalPerms.canEdit} onClick={() => clearAll('edit', reg.id)} style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: globalPerms.canEdit ? 'pointer' : 'not-allowed' }}>None</button></div>
                          </th>
                          <th style={{ paddingBottom: '12px', color: 'var(--muted)', fontSize: '13px', fontWeight: 600, width: '130px', textAlign: 'center', opacity: globalPerms.canDownload ? 1 : 0.4 }}>
                            <div style={{ marginBottom: '4px' }}>Can Download {!globalPerms.canDownload && <span style={{ fontSize: '10px', color: 'var(--destructive)' }}>OFF</span>}</div>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}><button disabled={!globalPerms.canDownload} onClick={() => selectAllCols('download', reg.id)} style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: globalPerms.canDownload ? 'pointer' : 'not-allowed' }}>All</button><button disabled={!globalPerms.canDownload} onClick={() => clearAll('download', reg.id)} style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: globalPerms.canDownload ? 'pointer' : 'not-allowed' }}>None</button></div>
                          </th>
                        </tr></thead>
                        <tbody>
                          {cols.map((col, index) => (
                            <tr key={col.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                              <td style={{ padding: '12px 0', fontSize: '13px', color: 'var(--muted)' }}>{index + 1}</td>
                              <td style={{ padding: '12px 0', fontWeight: 500, color: 'var(--foreground)' }}>{col.name} <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '8px' }}>({col.type})</span></td>
                              <td style={{ padding: '12px 0', textAlign: 'center', opacity: globalPerms.canView ? 1 : 0.35 }}><input type="checkbox" checked={viewCols.includes(index)} disabled={!globalPerms.canView} onChange={() => toggleColumn('view', reg.id, index, cols.length)} style={{ width: '18px', height: '18px', cursor: globalPerms.canView ? 'pointer' : 'not-allowed', accentColor: 'var(--brand-green)' }} /></td>
                              <td style={{ padding: '12px 0', textAlign: 'center', opacity: globalPerms.canEdit ? 1 : 0.35 }}><input type="checkbox" checked={editCols.includes(index)} disabled={!globalPerms.canEdit} onChange={() => toggleColumn('edit', reg.id, index, cols.length)} style={{ width: '18px', height: '18px', cursor: globalPerms.canEdit ? 'pointer' : 'not-allowed', accentColor: '#8B5CF6' }} /></td>
                              <td style={{ padding: '12px 0', textAlign: 'center', opacity: globalPerms.canDownload ? 1 : 0.35 }}><input type="checkbox" checked={dlCols.includes(index)} disabled={!globalPerms.canDownload} onChange={() => toggleColumn('download', reg.id, index, cols.length)} style={{ width: '18px', height: '18px', cursor: globalPerms.canDownload ? 'pointer' : 'not-allowed', accentColor: '#F59E0B' }} /></td>
                            </tr>
                          ))}
                          {cols.length === 0 && <tr><td colSpan={5} style={{ padding: '12px 0', color: 'var(--muted)', textAlign: 'center' }}>No columns in this sheet</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            };

            const folderIds = Object.keys(folderMap).map(Number);
            const usedFolders = folders.filter(f => folderIds.includes(f.id));
            const isSearching = searchQuery.trim().length > 0;

            return (
              <>
                {/* Unassigned sheets at the top */}
                {unassigned.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                      Unassigned Sheets
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {unassigned.map(reg => renderSheet(reg))}
                    </div>
                  </div>
                )}

                {/* Folders below */}
                {usedFolders.map(folder => {
                  const sheetsInFolder = folderMap[folder.id] || [];
                  // Closed by default; auto-open when searching and folder has matching sheets
                  const isFolderOpen = isSearching ? true : (expandedFolders[folder.id] === true);
                  return (
                    <div key={`folder-${folder.id}`} style={{ marginBottom: '8px' }}>
                      <div
                        onClick={() => setExpandedFolders(prev => ({ ...prev, [folder.id]: !isFolderOpen }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', cursor: 'pointer', background: '#fef3c7', borderRadius: '10px', border: '1px solid #fcd34d', marginBottom: isFolderOpen ? '8px' : 0 }}
                      >
                        {isFolderOpen ? <ChevronDown size={18} color="#92400e" /> : <ChevronRight size={18} color="#92400e" />}
                        <FolderOpen size={20} color="#f59e0b" />
                        <span style={{ fontWeight: 700, fontSize: '15px', color: '#92400e', flex: 1 }}>{folder.name}</span>
                        <span style={{ fontSize: '12px', color: '#92400e', background: '#fde68a', padding: '3px 10px', borderRadius: '12px' }}>{sheetsInFolder.length} sheet{sheetsInFolder.length !== 1 ? 's' : ''}</span>
                      </div>
                      {isFolderOpen && (
                        <div style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {sheetsInFolder.map(reg => renderSheet(reg))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}

          {registers.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>No sheets found in the system.</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', marginTop: '10px' }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: 'var(--navy)' }}>Login History & Activity</h3>
              <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                {(user.loginHistory || []).slice(0, 50).map((h: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-light)', fontSize: '13px' }}>
                    <span style={{ color: h.type === 'login' ? 'var(--brand-green)' : 'var(--destructive)', fontWeight: 500 }}>
                      {h.type === 'login' ? 'Login' : 'Logout'}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>{new Date(h.timestamp).toLocaleString()}</span>
                  </div>
                ))}
                {(!user.loginHistory || user.loginHistory.length === 0) && <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>No login history yet</p>}
              </div>
            </div>
          </div>

        </div>

        {previewReg && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setPreviewReg(null)}>
            <div style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '1000px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--navy)' }}>Preview: {previewReg.name}</h2>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                    {(() => {
                        const rr = rowViewRestrictions[previewReg.id];
                        if (rr && (rr.start || rr.end)) {
                            return `Showing permitted rows from ${rr.start || 'start'} to ${rr.end || 'end'} based on user's current permissions.`;
                        }
                        return `Showing the first 5 rows based on user's current permissions.`;
                    })()}
                  </p>
                </div>
                <button onClick={() => setPreviewReg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><X size={24} /></button>
              </div>
              <div style={{ padding: '0', overflow: 'auto', flex: 1, position: 'relative' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '10px 16px', textAlign: 'left', background: 'var(--surface)', borderBottom: '1px solid var(--border)', color: 'var(--navy)', fontWeight: 600, position: 'sticky', top: 0, zIndex: 10, minWidth: '60px' }}>
                        Row #
                      </th>
                      {(() => {
                        const cols = [...previewReg.columns].sort((a, b) => a.position - b.position);
                        const allowedView = viewRestrictions[previewReg.id] || cols.map((_, i) => i);
                        return cols.filter((_, i) => allowedView.includes(i)).map(col => (
                          <th key={col.id} style={{ padding: '10px 16px', textAlign: 'left', background: 'var(--surface)', borderBottom: '1px solid var(--border)', color: 'var(--navy)', fontWeight: 600, position: 'sticky', top: 0, zIndex: 10, minWidth: '120px' }}>
                            {col.name}
                          </th>
                        ));
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                        const cols = [...previewReg.columns].sort((a, b) => a.position - b.position);
                        const allowedView = viewRestrictions[previewReg.id] || cols.map((_, i) => i);
                        const allowedEdit = editRestrictions[previewReg.id] || cols.map((_, i) => i);
                        
                        const rr = rowViewRestrictions[previewReg.id];
                        const err = rowEditRestrictions[previewReg.id];
                        
                        let start = 0;
                        let end = 5;
                        if (rr && (rr.start || rr.end)) {
                            start = (rr.start || 1) - 1;
                            end = rr.end || previewReg.entries.length;
                        }
                        const entries = (previewReg.entries || []).slice(start, end);
                        
                        if (entries.length === 0) {
                          return <tr><td colSpan={allowedView.length + 1} style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>No data available for preview.</td></tr>;
                        }

                        return entries.map((row, i) => {
                          const actualRowIndex = start + i;
                          const isRowEditable = !err || ((!err.start || actualRowIndex >= err.start - 1) && (!err.end || actualRowIndex < err.end));
                          
                          return (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'white' : 'var(--background)' }}>
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-light)', color: 'var(--muted)', fontWeight: 500 }}>
                                {actualRowIndex + 1}
                              </td>
                              {cols.filter((_, j) => allowedView.includes(j)).map((col) => {
                                const origIndex = cols.findIndex(c => c.id === col.id);
                                const isColEditable = allowedEdit.includes(origIndex);
                                const isEditable = isRowEditable && isColEditable;
                                return (
                                  <td key={col.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-light)', color: isEditable ? 'var(--navy)' : 'var(--muted)' }}>
                                    {isEditable ? (
                                      <input 
                                        type="text" 
                                        value={(row as any)[col.name] || ''} 
                                        readOnly 
                                        style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--accent)', background: 'white', fontSize: '13px', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)' }}
                                        title="Editable by this user"
                                      />
                                    ) : (
                                      <span style={{ display: 'inline-block', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(row as any)[col.name] || '-'}</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
