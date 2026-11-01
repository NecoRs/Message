// Application registry. Implemented apps provide `load()` (lazy module import
// exporting `mount(win, opts)`); everything else shows a clear
// "not available" dialog instead of pretending to start.

const NOT_ADDED = 'This application has not been added to the desktop yet. Nothing was started.';
const NOT_INCLUDED = 'This tool is not included in the browser desktop. Nothing was started.';

export const CATEGORIES = [
  { id: 'favorites', name: 'Favorites', icon: 'favorite' },
  { id: 'recent', name: 'Recently Used', icon: 'history' },
  { id: 'all', name: 'All Applications', icon: 'apps' },
  { id: 'accessories', name: 'Accessories', icon: 'accessories' },
  { id: 'internet', name: 'Internet', icon: 'globe' },
  { id: 'graphics', name: 'Graphics', icon: 'graphics' },
  { id: 'settings', name: 'Settings', icon: 'settings' },
  { id: 'system', name: 'System', icon: 'system' },
  { id: 'security', name: 'Security Tools', icon: 'shield' },
];

export const APPS = [
  {
    id: 'phantom',
    name: 'Phantom Console',
    comment: 'Cinematic cyber operations simulator',
    exec: 'phantom-console',
    icon: 'phantom',
    categories: ['security', 'system'],
    keywords: ['hollywood', 'hacker', 'simulator', 'matrix', 'console', 'cinematic'],
    single: true,
    window: { width: 1180, height: 720, minWidth: 420, minHeight: 300 },
    load: () => import('./phantom/phantom.js'),
  },
  { id: 'terminal', name: 'Terminal Emulator', comment: 'Use the command line', exec: 'qterminal', icon: 'terminal', categories: ['accessories', 'system'], keywords: ['shell', 'console', 'qterminal', 'zsh'], unavailableReason: NOT_ADDED },
  { id: 'files', name: 'Thunar File Manager', comment: 'Browse the file system', exec: 'thunar', icon: 'files', categories: ['accessories', 'system'], keywords: ['folder', 'explorer', 'thunar'], unavailableReason: NOT_ADDED },
  { id: 'editor', name: 'Mousepad', comment: 'Simple text editor', exec: 'mousepad', icon: 'editor', categories: ['accessories'], keywords: ['text', 'notes', 'editor'], unavailableReason: NOT_ADDED },
  { id: 'firefox', name: 'Firefox ESR', comment: 'Browse the World Wide Web', exec: 'firefox-esr', icon: 'browser', categories: ['internet'], keywords: ['web', 'browser', 'internet'], unavailableReason: NOT_ADDED },
  { id: 'imageviewer', name: 'Ristretto Image Viewer', comment: 'Look at your images', exec: 'ristretto', icon: 'imageviewer', categories: ['graphics'], keywords: ['image', 'picture', 'photo'], unavailableReason: NOT_ADDED },
  { id: 'settings', name: 'Settings Manager', comment: 'Graphical settings manager for Xfce', exec: 'xfce4-settings-manager', icon: 'settings', categories: ['settings', 'system'], keywords: ['preferences', 'wallpaper', 'appearance', 'control'], unavailableReason: NOT_ADDED },
  { id: 'sysinfo', name: 'System Information', comment: 'Details about this desktop and your browser', exec: 'xfce4-about', icon: 'sysinfo', categories: ['system'], keywords: ['about', 'hardware', 'info'], unavailableReason: NOT_ADDED },
  { id: 'screenshot', name: 'Screenshot', comment: 'Take screenshots', exec: 'xfce4-screenshooter', icon: 'screenshot', categories: ['accessories', 'graphics'], keywords: ['capture'], unavailableReason: NOT_INCLUDED },
  { id: 'archive', name: 'Archive Manager', comment: 'Create and modify archives', exec: 'file-roller', icon: 'archive', categories: ['accessories'], keywords: ['zip', 'tar'], unavailableReason: NOT_INCLUDED },
  { id: 'taskmanager', name: 'Task Manager', comment: 'Monitor running processes', exec: 'xfce4-taskmanager', icon: 'taskmanager', categories: ['system'], keywords: ['process', 'cpu'], unavailableReason: NOT_INCLUDED },
  { id: 'nmap', name: 'nmap', comment: 'Network exploration tool', exec: 'nmap', icon: 'tool-recon', categories: ['security'], unavailableReason: NOT_INCLUDED },
  { id: 'wireshark', name: 'Wireshark', comment: 'Network protocol analyzer', exec: 'wireshark', icon: 'tool-sniffing', categories: ['security'], unavailableReason: NOT_INCLUDED },
  { id: 'burpsuite', name: 'Burp Suite', comment: 'Web application testing platform', exec: 'burpsuite', icon: 'tool-web', categories: ['security'], unavailableReason: NOT_INCLUDED },
  { id: 'metasploit', name: 'Metasploit Framework', comment: 'Penetration testing framework', exec: 'msfconsole', icon: 'tool-exploit', categories: ['security'], unavailableReason: NOT_INCLUDED },
  { id: 'john', name: 'John the Ripper', comment: 'Password auditing tool', exec: 'john', icon: 'tool-password', categories: ['security'], unavailableReason: NOT_INCLUDED },
];

export const getApp = (id) => APPS.find((a) => a.id === id);
export const appByExec = (exec) => APPS.find((a) => a.exec === exec || a.id === exec);
export const isAvailable = (app) => !!app?.load;
