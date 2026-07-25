import { useState, useRef, useEffect } from 'react';
import './Sidebar.css';
import type { Session, Language, Theme, User, Message } from '../../types';
import { getFullImageUrl } from '../../services/api';
import { APP_CONFIG } from '../../config';

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  backendError: boolean;
  t: Record<string, string>;
  createNewSession: () => void;
  view: 'chat' | 'gallery' | 'archives';
  setView: (view: 'chat' | 'gallery' | 'archives') => void;
  fetchGallery: (initial?: boolean) => void;
  sessions: Session[];
  onSessionViewed: (id: string) => void;
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;
  setMessages: (msgs: Message[]) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (val: string) => void;
  renameSession: (id: string, title: string) => void;
  toggleArchive: (id: string, archived: boolean) => void;
  setShowSettings: (show: boolean) => void;
  handleLogout: () => void;
  currentUser: User | null;
  lang: Language;
  setLang: (lang: Language) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  keepAwake: boolean;
  setKeepAwake: (keepAwake: boolean) => void;
}

export const Sidebar = ({
  sidebarOpen,
  setSidebarOpen,
  backendError,
  t,
  createNewSession,
  view,
  setView,
  fetchGallery,
  sessions,
  onSessionViewed,
  currentSessionId,
  setCurrentSessionId,
  setMessages,
  renamingId,
  setRenamingId,
  renameValue,
  setRenameValue,
  renameSession,
  toggleArchive,
  setShowSettings,
  handleLogout,
  currentUser,
  lang,
  setLang,
  theme,
  setTheme,
  keepAwake,
  setKeepAwake
}: SidebarProps) => {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const userInitial = currentUser?.username?.charAt(0).toUpperCase() || '?';
  const closeSidebarOnMobile = () => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setSidebarOpen(false);
    }
  };

  return (
    <>
      <div className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          {sidebarOpen && <button className="close-sidebar-mobile" onClick={() => setSidebarOpen(false)}>×</button>}
          {backendError && <div className="backend-warning" title={t.backendOffline}>⚠️</div>}
        </div>
        <button className="new-chat-btn" onClick={() => { createNewSession(); closeSidebarOnMobile(); }}>
          <span>+</span> {t.newChat}
        </button>
        <button className={`new-chat-btn gallery-btn ${view === 'gallery' ? 'active' : ''}`} onClick={() => { setView('gallery'); fetchGallery(true); closeSidebarOnMobile(); }}>
          <span>🖼️</span> {t.myContent}
        </button>
        <button className="new-chat-btn" onClick={() => { setView(view === 'archives' ? 'chat' : 'archives'); }}>
          <span>{view === 'archives' ? '💬' : '📦'}</span> {view === 'archives' ? t.viewActive : t.viewArchives}
        </button>
        
        <div className="sessions-list">
          {sessions.map(s => (
            <div 
              key={s.id} 
              className={`session-item status-${s.generationStatus || 'idle'} ${currentSessionId === s.id && (view === 'chat' || view === 'archives') ? 'active' : ''}`}
              data-generation-status={s.generationStatus || 'idle'}
              onClick={() => { 
                onSessionViewed(s.id);
                if (currentSessionId === s.id && view === 'chat') {
                  closeSidebarOnMobile();
                  return;
                }
                setMessages([]);
                setCurrentSessionId(s.id); 
                setView('chat'); 
                closeSidebarOnMobile();
              }}
            >
              {renamingId === s.id ? (
                <input 
                  autoFocus 
                  className="rename-input" 
                  value={renameValue} 
                  onChange={(e) => setRenameValue(e.target.value)} 
                  onBlur={() => renameSession(s.id, renameValue)} 
                  onKeyDown={(e) => { 
                    if (e.key === 'Enter') renameSession(s.id, renameValue); 
                    if (e.key === 'Escape') setRenamingId(null); 
                  }} 
                  onClick={(e) => e.stopPropagation()} 
                />
              ) : (
                <>
                  <span className="session-title">{s.title}</span>
                  {s.generationStatus === 'processing' ? (
                    <span
                      className="session-processing-loader"
                      title={lang === 'fr' ? 'Génération en cours' : 'Generation in progress'}
                      aria-label={lang === 'fr' ? 'Génération en cours' : 'Generation in progress'}
                    />
                  ) : s.generationStatus === 'unseen' && (
                    <span
                      className="session-unread-dot"
                      title={lang === 'fr' ? 'Nouvelle image non visionnée' : 'New unseen image'}
                      aria-label={lang === 'fr' ? 'Nouvelle image non visionnée' : 'New unseen image'}
                    />
                  )}
                  {Boolean(s.isArchived) && (
                    <div className="session-actions">
                      <button className="unarchive-session" onClick={(e) => { e.stopPropagation(); toggleArchive(s.id, false); }} title={t.unarchive}>📤</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {view === 'archives' && sessions.length === 0 && <p className="empty-archives-msg">{t.noArchives}</p>}
        </div>

        <div className="sidebar-footer-profile" ref={profileRef}>
          {profileMenuOpen && (
            <div className="profile-popover">
              <div className="popover-section">
                <button className="popover-item" onClick={() => { setLang(lang === 'fr' ? 'en' : 'fr'); setProfileMenuOpen(false); }}>
                  <span>🌐</span> {lang === 'fr' ? 'English (EN)' : 'Français (FR)'}
                </button>
                <button className="popover-item" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setProfileMenuOpen(false); }}>
                  <span>{theme === 'dark' ? '☀️' : '🌙'}</span> {theme === 'dark' ? (lang === 'fr' ? 'Mode Clair' : 'Light Mode') : (lang === 'fr' ? 'Mode Sombre' : 'Dark Mode')}
                </button>
                <button className="popover-item" onClick={() => { setKeepAwake(!keepAwake); setProfileMenuOpen(false); }}>
                  <span>{keepAwake ? '📱' : '📱'}</span> {keepAwake ? (lang === 'fr' ? 'Écran actif (Oui)' : 'Keep Awake (On)') : (lang === 'fr' ? 'Écran actif (Non)' : 'Keep Awake (Off)')}
                </button>
                <button className="popover-item" onClick={() => { setShowSettings(true); setProfileMenuOpen(false); closeSidebarOnMobile(); }}>
                  <span>⚙️</span> {t.settings}
                </button>
              </div>
              <div className="popover-divider" />
              <button className="popover-item logout" onClick={() => { handleLogout(); setProfileMenuOpen(false); }}>
                <span>🚪</span> {t.logout}
              </button>
            </div>
          )}
          
          <div 
            className={`profile-pill ${profileMenuOpen ? 'active' : ''}`} 
            onClick={() => setProfileMenuOpen(!profileMenuOpen)}
          >
            <div className="profile-avatar">
              {currentUser?.avatarUrl ? (
                <img src={getFullImageUrl(currentUser.avatarUrl)} alt="Avatar" className="profile-avatar-img" />
              ) : (
                userInitial
              )}
            </div>
            <div className="profile-info">
              <span className="profile-name">{currentUser?.username}</span>
              {currentUser?.isAdmin && <span className="profile-role">Admin</span>}
            </div>
            <div className="profile-more">•••</div>
          </div>
          <div className="sidebar-version" aria-label={`Version ${APP_CONFIG.VERSION}`}>
            v{APP_CONFIG.VERSION}
          </div>
        </div>
      </aside>
    </>
  );
};
