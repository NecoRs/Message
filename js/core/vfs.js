// In-browser virtual filesystem. The tree lives in memory; the user's home
// directory is persisted to localStorage so notes and files survive reloads.
import { Emitter } from './events.js';
import { storageGet, storageSet, storageRemove, debounce } from './util.js';
import { WALLPAPERS } from './settings.js';

export const HOME = '/home/kali';
export const TRASH = `${HOME}/.local/share/Trash/files`;
const STORE_KEY = 'kali-desktop.home.v1';
const BOOT = Date.now();

const ERRORS = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  EACCES: 'Permission denied',
  ENOTEMPTY: 'Directory not empty',
  EINVAL: 'Invalid argument',
  EBUSY: 'Device or resource busy',
};

export class VFSError extends Error {
  constructor(code, path) {
    super(ERRORS[code] || code);
    this.code = code;
    this.path = path;
  }
}

/* ------------------------------------------------------------ builders */

const now = () => Date.now();
const D = (children = {}, o = {}) => ({ type: 'dir', children, mtime: o.mtime ?? BOOT - 86400000 * 3, mode: o.mode ?? 0o755, owner: o.owner ?? 'root' });
const F = (content = '', o = {}) => ({ type: 'file', content, mtime: o.mtime ?? BOOT - 86400000 * 3, mode: o.mode ?? 0o644, owner: o.owner ?? 'root', ...o.extra });
const BIN = (size) => F('', { mode: 0o755, extra: { binary: true, size } });
const L = (target) => ({ type: 'link', target, mtime: BOOT - 86400000 * 30, mode: 0o777, owner: 'root' });
const U = (node) => {
  // mark a subtree as owned by kali
  node.owner = 'kali';
  if (node.type === 'dir') Object.values(node.children).forEach(U);
  return node;
};

const OS_RELEASE = `PRETTY_NAME="Kali GNU/Linux Rolling"
NAME="Kali GNU/Linux"
VERSION_ID="2026.3"
VERSION="2026.3"
VERSION_CODENAME=kali-rolling
ID=kali
ID_LIKE=debian
HOME_URL="https://www.kali.org/"
SUPPORT_URL="https://forums.kali.org/"
BUG_REPORT_URL="https://bugs.kali.org/"
ANSI_COLOR="1;31"
`;

const ZSHRC = `# ~/.zshrc file for zsh interactive shells.
# see /usr/share/doc/zsh/examples/zshrc for examples

setopt autocd              # change directory just by typing its name
setopt interactivecomments # allow comments in interactive mode
setopt magicequalsubst     # enable filename expansion for arguments of the form ‘anything=expression’
setopt nonomatch           # hide error message if there is no match for the pattern
setopt notify              # report the status of background jobs immediately
setopt numericglobsort     # sort filenames numerically when it makes sense
setopt promptsubst         # enable command substitution in prompt

WORDCHARS='_-' # Don't consider certain characters part of the word

# History configurations
HISTFILE=~/.zsh_history
HISTSIZE=1000
SAVEHIST=2000

# enable color support of ls, less and man, and also add handy aliases
alias ls='ls --color=auto'
alias grep='grep --color=auto'
alias ll='ls -l'
alias la='ls -A'
alias l='ls -CF'

# Toggle between the two-line and one-line prompt with Ctrl+P
PROMPT_ALTERNATIVE=twoline
NEWLINE_BEFORE_PROMPT=yes
`;

const BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.

case $- in
    *i*) ;;
      *) return;;
esac

HISTCONTROL=ignoreboth
HISTSIZE=1000
HISTFILESIZE=2000

PS1='\\[\\033[01;34m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;36m\\]\\w\\[\\033[00m\\]\\$ '

alias ls='ls --color=auto'
alias ll='ls -l'
alias la='ls -A'
`;

const PROFILE = `# ~/.profile: executed by the command interpreter for login shells.

if [ -n "$BASH_VERSION" ]; then
    if [ -f "$HOME/.bashrc" ]; then
        . "$HOME/.bashrc"
    fi
fi

if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi
`;

const NOTES = `Notes
=====

- Back up ~/Documents every Friday
- Rotate the lab VM snapshots
- Try the new wallpaper in Settings › Desktop
- Read the Xfce keyboard shortcut list
`;

const TODO = `# To do

- Update the system (sudo apt update && sudo apt full-upgrade)
- Tidy up ~/Downloads
- Pick a new terminal font size
`;

const desktopEntry = (name, exec, iconName, comment) => `[Desktop Entry]
Version=1.0
Type=Application
Name=${name}
Comment=${comment}
Exec=${exec}
Icon=${iconName}
Terminal=false
`;

const BINARIES = [
  'apt', 'apt-get', 'bash', 'basename', 'cat', 'chmod', 'chown', 'clear', 'cp', 'date', 'df', 'dirname', 'dpkg', 'du',
  'echo', 'env', 'false', 'file', 'find', 'firefox-esr', 'free', 'grep', 'groups', 'head', 'history', 'hostname', 'id',
  'ip', 'kill', 'less', 'ln', 'ls', 'lsb_release', 'man', 'mkdir', 'more', 'mousepad', 'mv', 'nano', 'neofetch', 'ping',
  'ps', 'pwd', 'qterminal', 'readlink', 'realpath', 'rm', 'rmdir', 'sed', 'seq', 'sh', 'sleep', 'sort', 'stat', 'su',
  'sudo', 'tail', 'tee', 'thunar', 'top', 'touch', 'tree', 'true', 'uname', 'uniq', 'uptime', 'vi', 'vim', 'wc',
  'which', 'whoami', 'xdg-open', 'zsh', 'xfce4-settings-manager', 'phantom-console',
];

function buildTree() {
  const pictures = {};
  const imageName = (w) => w.id + w.file.slice(w.file.lastIndexOf('.'));
  for (const w of WALLPAPERS) {
    pictures[imageName(w)] = F('', { mtime: BOOT - 86400000 * 2, extra: { image: w.id, binary: true, size: w.size ?? 98304 } });
  }
  const backgrounds = {};
  for (const w of WALLPAPERS) backgrounds[imageName(w)] = F('', { extra: { image: w.id, binary: true, size: w.size ?? 98304 } });

  const usrbin = {};
  for (const b of BINARIES) usrbin[b] = BIN(40000 + ((b.length * 7919) % 900000));
  usrbin.python3 = L('python3.13');
  usrbin['python3.13'] = BIN(6852304);

  const home = U(D({
    '.bashrc': F(BASHRC),
    '.zshrc': F(ZSHRC),
    '.profile': F(PROFILE),
    '.zsh_history': F('', { mode: 0o600 }),
    '.config': D({
      qterminal: D({ 'qterminal.ini': F('[General]\nfontFamily=Fira Code\nfontSize=10\ncolorScheme=Kali-Dark\nshowMenubar=true\n') }),
      xfce4: D({ 'helpers.rc': F('WebBrowser=firefox\nFileManager=thunar\nTerminalEmulator=qterminal\n') }),
    }),
    '.local': D({ share: D({ Trash: D({ files: D(), info: D() }) }) }),
    Desktop: D({
      'qterminal.desktop': F(desktopEntry('Terminal', 'qterminal', 'utilities-terminal', 'Use the command line'), { mode: 0o755 }),
      'firefox-esr.desktop': F(desktopEntry('Firefox ESR', 'firefox-esr', 'firefox-esr', 'Browse the World Wide Web'), { mode: 0o755 }),
      'xfce-settings-manager.desktop': F(desktopEntry('Settings', 'xfce4-settings-manager', 'org.xfce.settings.manager', 'Graphical Settings Manager for Xfce'), { mode: 0o755 }),
      'phantom-console.desktop': F(desktopEntry('Phantom Console', 'phantom-console', 'phantom-console', 'Cinematic cyber operations simulator'), { mode: 0o755 }),
    }),
    Documents: D({
      'notes.txt': F(NOTES, { mtime: BOOT - 3600000 * 5 }),
      'todo.md': F(TODO, { mtime: BOOT - 86400000 }),
    }),
    Downloads: D({
      'kali-linux-2026.3-installer-amd64.iso': F('', { mtime: BOOT - 86400000 * 6, extra: { binary: true, size: 4402315264 } }),
    }),
    Music: D(),
    Pictures: D({ ...pictures, Screenshots: D() }),
    Public: D(),
    Templates: D(),
    Videos: D(),
  }, { mode: 0o755 }));

  return D({
    bin: L('usr/bin'),
    boot: D({
      'vmlinuz-6.16.8-amd64': BIN(11534336),
      'initrd.img-6.16.8-amd64': BIN(83886080),
      'config-6.16.8-amd64': F('# Linux/x86 6.16.8 Kernel Configuration\nCONFIG_64BIT=y\nCONFIG_X86_64=y\n'),
      grub: D({ 'grub.cfg': F('# DO NOT EDIT THIS FILE\nset default="0"\nset timeout=5\n', { mode: 0o444 }) }),
    }),
    dev: D({
      null: F('', { mode: 0o666, extra: { device: 'null' } }),
      zero: F('', { mode: 0o666, extra: { device: 'zero' } }),
      random: F('', { mode: 0o666, extra: { device: 'random' } }),
      tty: F('', { mode: 0o666, extra: { device: 'tty' } }),
    }),
    etc: D({
      hostname: F('kali\n'),
      hosts: F('127.0.0.1\tlocalhost\n127.0.1.1\tkali\n\n# The following lines are desirable for IPv6 capable hosts\n::1     localhost ip6-localhost ip6-loopback\nff02::1 ip6-allnodes\nff02::2 ip6-allrouters\n'),
      'os-release': F(OS_RELEASE),
      issue: F('Kali GNU/Linux Rolling \\n \\l\n\n'),
      'debian_version': F('kali-rolling\n'),
      motd: F('\nThe programs included with the Kali GNU/Linux system are free software;\nthe exact distribution terms for each program are described in the\nindividual files in /usr/share/doc/*/copyright.\n\nKali GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent\npermitted by applicable law.\n'),
      passwd: F('root:x:0:0:root:/root:/usr/bin/zsh\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nkali:x:1000:1000:Kali,,,:/home/kali:/usr/bin/zsh\n'),
      group: F('root:x:0:\nsudo:x:27:kali\nkali:x:1000:\n'),
      shadow: F('root:*:20300:0:99999:7:::\nkali:$y$j9T$redacted:20300:0:99999:7:::\n', { mode: 0o640 }),
      shells: F('# /etc/shells: valid login shells\n/bin/sh\n/usr/bin/sh\n/bin/bash\n/usr/bin/bash\n/bin/zsh\n/usr/bin/zsh\n'),
      timezone: F(`${Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC'}\n`),
      'resolv.conf': F('# Generated by NetworkManager\nnameserver 10.0.2.3\n'),
      apt: D({ 'sources.list': F('# See https://www.kali.org/docs/general-use/kali-linux-sources-list-repositories/\ndeb http://http.kali.org/kali kali-rolling main contrib non-free non-free-firmware\n') }),
      xdg: D({ xfce4: D({ xfconf: D() }) }),
    }),
    home: D({ kali: home }),
    lib: L('usr/lib'),
    lib64: L('usr/lib64'),
    media: D(),
    mnt: D(),
    opt: D(),
    proc: D({
      version: F('', { extra: { dynamic: 'version' } }),
      cpuinfo: F('', { extra: { dynamic: 'cpuinfo' } }),
      meminfo: F('', { extra: { dynamic: 'meminfo' } }),
      uptime: F('', { extra: { dynamic: 'uptime' } }),
    }, { mode: 0o555 }),
    root: D({ '.zshrc': F(ZSHRC), '.bashrc': F(BASHRC) }, { mode: 0o700 }),
    run: D(),
    sbin: L('usr/sbin'),
    srv: D(),
    sys: D({}, { mode: 0o555 }),
    tmp: D({}, { mode: 0o1777 }),
    usr: D({
      bin: D(usrbin),
      sbin: D({ ifconfig: BIN(84000), iptables: BIN(99000), reboot: BIN(1400), shutdown: BIN(1400) }),
      lib: D({ 'os-release': L('../../etc/os-release') }),
      lib64: D({ 'ld-linux-x86-64.so.2': BIN(228720) }),
      local: D({ bin: D(), share: D() }),
      share: D({
        backgrounds: D({ kali: D(backgrounds) }),
        doc: D(),
      }),
    }),
    var: D({
      log: D({ 'syslog': F('', { mode: 0o640, extra: { binary: false } }), 'dpkg.log': F('2026-10-29 09:12:44 startup archives unpack\n') }),
      www: D({ html: D({ 'index.html': F('<!DOCTYPE html>\n<html>\n  <head><title>Apache2 Debian Default Page</title></head>\n  <body><h1>It works!</h1></body>\n</html>\n') }) }),
      tmp: D({}, { mode: 0o1777 }),
    }),
  });
}

/* ----------------------------------------------------------------- VFS */

class VFS extends Emitter {
  constructor() {
    super();
    this.root = buildTree();
    this.#load();
    this.save = debounce(() => this.#persist(), 250);
  }

  /* ---------- paths */

  normalize(path, cwd = HOME) {
    if (path == null || path === '') return cwd;
    let p = String(path);
    if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
    if (!p.startsWith('/')) p = `${cwd.replace(/\/$/, '')}/${p}`;
    const out = [];
    for (const seg of p.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return '/' + out.join('/');
  }

  basename(path) {
    const p = path.replace(/\/+$/, '');
    return p.slice(p.lastIndexOf('/') + 1) || '/';
  }

  dirname(path) {
    const p = path.replace(/\/+$/, '');
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  }

  join(...parts) {
    return this.normalize(parts.join('/'), '/');
  }

  /** "~/Documents" style display path. */
  pretty(path) {
    if (path === HOME) return '~';
    if (path.startsWith(HOME + '/')) return '~' + path.slice(HOME.length);
    return path;
  }

  /* ---------- lookup */

  #walk(path, follow = true, depth = 0) {
    if (depth > 16) return null;
    const segs = path.split('/').filter(Boolean);
    let node = this.root;
    let cur = '';
    for (let i = 0; i < segs.length; i++) {
      if (!node || node.type !== 'dir') return null;
      const child = node.children[segs[i]];
      if (!child) return null;
      const last = i === segs.length - 1;
      if (child.type === 'link' && (follow || !last)) {
        const target = this.normalize(child.target, cur || '/');
        const resolved = this.#walk(target, true, depth + 1);
        if (!resolved) return null;
        node = resolved.node;
        cur = resolved.real;
      } else {
        node = child;
        cur = `${cur}/${segs[i]}`;
      }
    }
    return { node, real: cur || '/' };
  }

  node(path, follow = true) {
    return this.#walk(this.normalize(path, '/'), follow)?.node ?? null;
  }

  /** Canonical path with symlinks resolved. */
  realpath(path) {
    return this.#walk(this.normalize(path, '/'), true)?.real ?? null;
  }

  exists(path) {
    return !!this.node(path);
  }

  isDir(path) {
    return this.node(path)?.type === 'dir';
  }

  isFile(path) {
    return this.node(path)?.type === 'file';
  }

  size(node) {
    if (!node) return 0;
    if (node.type === 'dir') return 4096;
    if (node.type === 'link') return node.target.length;
    if (node.size != null) return node.size;
    if (node.dynamic) return 0;
    return new TextEncoder().encode(node.content || '').length;
  }

  stat(path) {
    const abs = this.normalize(path, '/');
    const lnode = this.node(abs, false);
    if (!lnode) return null;
    const node = lnode.type === 'link' ? this.node(abs) : lnode;
    return {
      path: abs,
      name: this.basename(abs),
      type: lnode.type,
      target: lnode.type === 'link' ? lnode.target : null,
      resolvedType: node?.type ?? null,
      size: this.size(lnode),
      mtime: lnode.mtime,
      mode: lnode.mode,
      owner: lnode.owner,
      node: lnode,
    };
  }

  /* ---------- permissions */

  canRead(path, user = 'kali') {
    if (user === 'root') return true;
    const abs = this.normalize(path, '/');
    if (abs === '/root' || abs.startsWith('/root/')) return false;
    const n = this.node(abs);
    if (n && n.type === 'file' && n.mode === 0o640 && n.owner === 'root') return false;
    if (n && n.mode === 0o600 && n.owner !== user) return false;
    return true;
  }

  canWrite(path, user = 'kali') {
    if (user === 'root') return !this.normalize(path, '/').startsWith('/proc');
    const abs = this.normalize(path, '/');
    return abs === HOME || abs.startsWith(HOME + '/') || abs === '/tmp' || abs.startsWith('/tmp/') ||
      abs.startsWith('/var/tmp/') || abs.startsWith('/dev/');
  }

  #assertRead(path, user) {
    if (!this.canRead(path, user)) throw new VFSError('EACCES', path);
  }

  #assertWrite(path, user) {
    if (!this.canWrite(path, user)) throw new VFSError('EACCES', path);
  }

  /* ---------- reading */

  readdir(path, { user = 'kali' } = {}) {
    const abs = this.normalize(path, '/');
    const n = this.node(abs);
    if (!n) throw new VFSError('ENOENT', abs);
    if (n.type !== 'dir') throw new VFSError('ENOTDIR', abs);
    this.#assertRead(abs, user);
    const real = this.realpath(abs);
    return Object.keys(n.children)
      .map((name) => {
        const child = n.children[name];
        const p = real === '/' ? `/${name}` : `${real}/${name}`;
        const target = child.type === 'link' ? this.node(p) : child;
        return { name, path: p, node: child, target, isDir: target?.type === 'dir' };
      });
  }

  readFile(path, { user = 'kali' } = {}) {
    const abs = this.normalize(path, '/');
    const n = this.node(abs);
    if (!n) throw new VFSError('ENOENT', abs);
    if (n.type === 'dir') throw new VFSError('EISDIR', abs);
    this.#assertRead(abs, user);
    if (n.dynamic) return dynamicContent(n.dynamic);
    if (n.device === 'null') return '';
    if (n.device === 'zero') return '';
    if (n.device === 'random') return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => String.fromCharCode(33 + (b % 90))).join('') + '\n';
    return n.content ?? '';
  }

  /* ---------- writing */

  #parentDir(abs) {
    const dir = this.dirname(abs);
    const parent = this.node(dir);
    if (!parent) throw new VFSError('ENOENT', abs);
    if (parent.type !== 'dir') throw new VFSError('ENOTDIR', abs);
    return parent;
  }

  writeFile(path, content, { append = false, user = 'kali', mode } = {}) {
    const abs = this.normalize(path, '/');
    const existing = this.node(abs);
    if (existing?.type === 'dir') throw new VFSError('EISDIR', abs);
    if (existing?.device) return; // /dev/null and friends swallow writes
    this.#assertWrite(abs, user);
    if (existing) {
      if (existing.dynamic) throw new VFSError('EACCES', abs);
      existing.content = append ? (existing.content || '') + content : content;
      delete existing.binary;
      delete existing.size;
      delete existing.image;
      existing.mtime = now();
    } else {
      const parent = this.#parentDir(abs);
      parent.children[this.basename(abs)] = F(content, { mtime: now(), mode: mode ?? 0o644, owner: user });
      parent.mtime = now();
    }
    this.#changed(abs);
  }

  touch(path, { user = 'kali' } = {}) {
    const abs = this.normalize(path, '/');
    const n = this.node(abs);
    if (n) {
      this.#assertWrite(abs, user);
      n.mtime = now();
      this.#changed(abs);
      return;
    }
    this.writeFile(abs, '', { user });
  }

  mkdir(path, { parents = false, user = 'kali' } = {}) {
    const abs = this.normalize(path, '/');
    if (this.exists(abs)) {
      if (parents && this.isDir(abs)) return;
      throw new VFSError('EEXIST', abs);
    }
    this.#assertWrite(abs, user);
    if (parents) {
      const dir = this.dirname(abs);
      if (!this.exists(dir)) this.mkdir(dir, { parents: true, user });
    }
    const parent = this.#parentDir(abs);
    parent.children[this.basename(abs)] = D({}, { mtime: now(), owner: user });
    parent.mtime = now();
    this.#changed(abs);
  }

  rm(path, { recursive = false, user = 'kali' } = {}) {
    const abs = this.normalize(path, '/');
    const n = this.node(abs, false);
    if (!n) throw new VFSError('ENOENT', abs);
    if (abs === '/' || abs === HOME) throw new VFSError('EBUSY', abs);
    if (n.type === 'dir' && !recursive) throw new VFSError('EISDIR', abs);
    this.#assertWrite(abs, user);
    const parent = this.node(this.dirname(abs));
    delete parent.children[this.basename(abs)];
    parent.mtime = now();
    this.#changed(abs);
  }

  rmdir(path, { user = 'kali' } = {}) {
    const abs = this.normalize(path, '/');
    const n = this.node(abs, false);
    if (!n) throw new VFSError('ENOENT', abs);
    if (n.type !== 'dir') throw new VFSError('ENOTDIR', abs);
    if (Object.keys(n.children).length) throw new VFSError('ENOTEMPTY', abs);
    this.rm(abs, { recursive: true, user });
  }

  /** Moves or renames. If dst is an existing directory the source moves inside it. */
  move(src, dst, { user = 'kali', overwrite = true } = {}) {
    const from = this.normalize(src, '/');
    let to = this.normalize(dst, '/');
    const n = this.node(from, false);
    if (!n) throw new VFSError('ENOENT', from);
    if (this.isDir(to)) to = this.join(to, this.basename(from));
    if (from === to) return to;
    if (to.startsWith(from + '/')) throw new VFSError('EINVAL', to);
    this.#assertWrite(from, user);
    this.#assertWrite(to, user);
    const existing = this.node(to, false);
    if (existing && (!overwrite || existing.type === 'dir')) throw new VFSError('EEXIST', to);
    const target = this.#parentDir(to);
    const parent = this.node(this.dirname(from));
    delete parent.children[this.basename(from)];
    n.mtime = now();
    target.children[this.basename(to)] = n;
    parent.mtime = target.mtime = now();
    this.#changed(from);
    this.#changed(to);
    return to;
  }

  copy(src, dst, { user = 'kali', recursive = false } = {}) {
    const from = this.normalize(src, '/');
    let to = this.normalize(dst, '/');
    const n = this.node(from);
    if (!n) throw new VFSError('ENOENT', from);
    this.#assertRead(from, user);
    if (n.type === 'dir' && !recursive) throw new VFSError('EISDIR', from);
    if (this.isDir(to)) to = this.join(to, this.basename(from));
    if (to === from || to.startsWith(from + '/')) throw new VFSError('EINVAL', to);
    this.#assertWrite(to, user);
    const target = this.#parentDir(to);
    const clone = JSON.parse(JSON.stringify(n));
    const stamp = (x) => {
      x.mtime = now();
      x.owner = user;
      if (x.type === 'dir') Object.values(x.children).forEach(stamp);
    };
    stamp(clone);
    delete clone.trashOrigin;
    delete clone.trashDate;
    target.children[this.basename(to)] = clone;
    target.mtime = now();
    this.#changed(to);
    return to;
  }

  chmod(path, mode, { user = 'kali' } = {}) {
    const abs = this.normalize(path, '/');
    const n = this.node(abs);
    if (!n) throw new VFSError('ENOENT', abs);
    this.#assertWrite(abs, user);
    n.mode = mode;
    this.#changed(abs);
  }

  /** Returns a name in `dir` that does not exist yet: "Untitled Folder", "Untitled Folder 2", … */
  uniqueName(dir, base) {
    const n = this.node(dir);
    if (!n || n.type !== 'dir' || !n.children[base]) return base;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2; ; i++) {
      const candidate = `${stem} ${i}${ext}`;
      if (!n.children[candidate]) return candidate;
    }
  }

  /* ---------- trash */

  trash(path) {
    const abs = this.normalize(path, '/');
    if (abs.startsWith(TRASH + '/')) {
      this.rm(abs, { recursive: true });
      return null;
    }
    const n = this.node(abs, false);
    if (!n) throw new VFSError('ENOENT', abs);
    if (!abs.startsWith(HOME + '/')) throw new VFSError('EACCES', abs);
    if (!this.exists(TRASH)) this.mkdir(TRASH, { parents: true });
    const name = this.uniqueName(TRASH, this.basename(abs));
    const dest = this.move(abs, this.join(TRASH, name), { overwrite: false });
    const moved = this.node(dest, false);
    moved.trashOrigin = abs;
    moved.trashDate = now();
    this.save();
    return dest;
  }

  trashItems() {
    if (!this.exists(TRASH)) return [];
    return this.readdir(TRASH);
  }

  restore(trashPath) {
    const n = this.node(trashPath, false);
    if (!n) throw new VFSError('ENOENT', trashPath);
    let dest = n.trashOrigin || this.join(HOME, this.basename(trashPath));
    if (!this.isDir(this.dirname(dest))) this.mkdir(this.dirname(dest), { parents: true });
    if (this.exists(dest)) dest = this.join(this.dirname(dest), this.uniqueName(this.dirname(dest), this.basename(dest)));
    const out = this.move(trashPath, dest, { overwrite: false });
    const moved = this.node(out, false);
    delete moved.trashOrigin;
    delete moved.trashDate;
    this.save();
    return out;
  }

  emptyTrash() {
    const t = this.node(TRASH);
    if (!t) return;
    t.children = {};
    t.mtime = now();
    this.#changed(TRASH + '/');
  }

  get trashCount() {
    const t = this.node(TRASH);
    return t ? Object.keys(t.children).length : 0;
  }

  /* ---------- persistence */

  #changed(path) {
    this.emit('change', { path, dir: this.dirname(path) });
    if (path.startsWith(HOME)) this.save();
  }

  #persist() {
    const home = this.node(HOME);
    if (!home) return;
    const ok = storageSet(STORE_KEY, home);
    if (!ok) console.warn('Could not persist home directory (storage full or unavailable).');
  }

  #load() {
    const stored = storageGet(STORE_KEY, null);
    if (stored && stored.type === 'dir' && stored.children) {
      this.root.children.home.children.kali = stored;
    }
  }

  /** Restores the default home directory (used by Settings › Reset). */
  resetHome() {
    storageRemove(STORE_KEY);
    this.root = buildTree();
    this.emit('change', { path: HOME, dir: '/home', reset: true });
  }
}

function dynamicContent(kind) {
  const cores = navigator.hardwareConcurrency || 4;
  const memGb = navigator.deviceMemory || 8;
  switch (kind) {
    case 'version':
      return 'Linux version 6.16.8-amd64 (devel@kali.org) (x86_64-linux-gnu-gcc-14 (Debian 14.2.0-19) 14.2.0, GNU ld (GNU Binutils for Debian) 2.45) #1 SMP PREEMPT_DYNAMIC Kali 6.16.8-1kali1 (2025-09-24)\n';
    case 'cpuinfo':
      return Array.from({ length: cores }, (_, i) =>
        `processor\t: ${i}\nvendor_id\t: GenuineIntel\nmodel name\t: Virtual CPU @ 2.40GHz\ncpu cores\t: ${cores}\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov sse sse2 ssse3 sse4_1 sse4_2 avx avx2\n`).join('\n');
    case 'meminfo': {
      const total = memGb * 1024 * 1024;
      const free = Math.round(total * 0.58);
      return `MemTotal:       ${String(total).padStart(9)} kB\nMemFree:        ${String(free).padStart(9)} kB\nMemAvailable:   ${String(Math.round(total * 0.71)).padStart(9)} kB\nBuffers:        ${String(Math.round(total * 0.02)).padStart(9)} kB\nCached:         ${String(Math.round(total * 0.14)).padStart(9)} kB\nSwapTotal:      ${String(1048572).padStart(9)} kB\nSwapFree:       ${String(1048572).padStart(9)} kB\n`;
    }
    case 'uptime': {
      const s = (Date.now() - BOOT) / 1000;
      return `${s.toFixed(2)} ${(s * cores * 0.93).toFixed(2)}\n`;
    }
    default:
      return '';
  }
}

export const BOOT_TIME = BOOT;
export const vfs = new VFS();

/** Parses a .desktop launcher's Name/Exec/Icon fields. */
export function parseDesktopEntry(content) {
  const out = {};
  for (const line of String(content).split('\n')) {
    const m = line.match(/^(Name|Exec|Icon|Comment|Type)=(.*)$/);
    if (m && !(m[1] in out)) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}
