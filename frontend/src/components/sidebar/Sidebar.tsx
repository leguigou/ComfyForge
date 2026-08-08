import { useState, useRef, useEffect } from 'react';
import './Sidebar.css';
import type { Session, Language, Theme, User, Message, AppView } from '../../types';
import { getAvatarThumbnailUrl, getFullImageUrl } from '../../services/api';
import { APP_CONFIG } from '../../config';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChatIcon,
  GlobeIcon,
  ImageIcon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  SmartphoneIcon,
  SunIcon,
} from '../ui/Icons';

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  backendError: boolean;
  t: Record<string, string>;
  createNewSession: () => Promise<string>;
  view: AppView;
  setView: (view: AppView) => void;
  openComparisonHome: () => void;
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
  openComparisonHome,
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
          {backendError && <div className="backend-warning" title={t.backendOffline}><AlertTriangleIcon size={20} /></div>}
        </div>
        <button className="new-chat-btn" onClick={() => { void createNewSession(); closeSidebarOnMobile(); }}>
          <span>+</span> {t.newChat}
        </button>
        <button className={`new-chat-btn gallery-btn ${view === 'gallery' ? 'active' : ''}`} onClick={() => { setView('gallery'); fetchGallery(true); closeSidebarOnMobile(); }}>
          <span><ImageIcon size={19} /></span> {t.myContent}
        </button>
        <button className="new-chat-btn" onClick={() => { setView(view === 'archives' ? 'chat' : 'archives'); }}>
          <span>{view === 'archives' ? <ChatIcon size={19} /> : <ArchiveIcon size={19} />}</span> {view === 'archives' ? t.viewActive : t.viewArchives}
        </button>
        
        <div className="sessions-list">
          {sessions.map(s => (
            <div 
              key={s.id} 
              className={`session-item status-${s.generationStatus || 'idle'} ${currentSessionId === s.id && (view === 'chat' || view === 'archives') ? 'active' : ''}`}
              data-generation-status={s.generationStatus || 'idle'}
              role="button"
              tabIndex={renamingId === s.id ? -1 : 0}
              aria-current={currentSessionId === s.id && (view === 'chat' || view === 'archives') ? 'page' : undefined}
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
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                event.currentTarget.click();
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
                      <button className="unarchive-session" onClick={(e) => { e.stopPropagation(); toggleArchive(s.id, false); }} title={t.unarchive} aria-label={t.unarchive}><ArchiveRestoreIcon size={18} /></button>
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
            <div id="profile-menu" className="profile-popover">
              <div className="popover-section">
                <button className="popover-item" onClick={() => { setLang(lang === 'fr' ? 'en' : 'fr'); setProfileMenuOpen(false); }}>
                  <span><GlobeIcon size={18} /></span> {lang === 'fr' ? 'English (EN)' : 'Français (FR)'}
                </button>
                <button className="popover-item" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setProfileMenuOpen(false); }}>
                  <span>{theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}</span> {theme === 'dark' ? (lang === 'fr' ? 'Mode Clair' : 'Light Mode') : (lang === 'fr' ? 'Mode Sombre' : 'Dark Mode')}
                </button>
                <button className="popover-item" onClick={() => { setKeepAwake(!keepAwake); setProfileMenuOpen(false); }}>
                  <span><SmartphoneIcon size={18} /></span> {keepAwake ? (lang === 'fr' ? 'Écran actif (Oui)' : 'Keep Awake (On)') : (lang === 'fr' ? 'Écran actif (Non)' : 'Keep Awake (Off)')}
                </button>
                <button className={`popover-item ${view === 'statistics' ? 'active' : ''}`} onClick={() => { setView('statistics'); setProfileMenuOpen(false); closeSidebarOnMobile(); }}>
                  <span aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M4 19V9M10 19V5M16 19v-7M22 19V2" /><path d="M2 19h21" />
                    </svg>
                  </span> {lang === 'fr' ? 'Statistiques' : 'Statistics'}
                </button>
                <button className={`popover-item ${view === 'comparison' ? 'active' : ''}`} onClick={() => { openComparisonHome(); setProfileMenuOpen(false); closeSidebarOnMobile(); }}>
                  <span aria-hidden="true">A/B</span> {lang === 'fr' ? 'Comparaison' : 'Comparison'}
                </button>
                <button className="popover-item" onClick={() => { setShowSettings(true); setProfileMenuOpen(false); closeSidebarOnMobile(); }}>
                  <span><SettingsIcon size={18} /></span> {t.settings}
                </button>
              </div>
              <div className="popover-divider" />
              <button className="popover-item logout" onClick={() => { handleLogout(); setProfileMenuOpen(false); }}>
                <span><LogOutIcon size={18} /></span> {t.logout}
              </button>
              <div className="sidebar-version" aria-label={`Version ${APP_CONFIG.VERSION}`}>
                v{APP_CONFIG.VERSION}
              </div>
            </div>
          )}
          
          <div 
            className={`profile-pill ${profileMenuOpen ? 'active' : ''}`} 
            onClick={() => setProfileMenuOpen(!profileMenuOpen)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              setProfileMenuOpen(open => !open);
            }}
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-controls="profile-menu"
            aria-expanded={profileMenuOpen}
          >
            <div className="profile-avatar">
              {currentUser?.avatarUrl ? (
                <img src={getFullImageUrl(getAvatarThumbnailUrl(currentUser.avatarUrl))} alt="Avatar" className="profile-avatar-img" />
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
        </div>
      </aside>
    </>
  );
};
