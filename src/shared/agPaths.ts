/**
 * AG Platform Paths — SSOT for Antigravity filesystem locations.
 * ═══════════════════════════════════════════════════════════════
 * ZERO vscode dependency — safe for both extension host AND
 * detached worker processes (ELECTRON_RUN_AS_NODE=1).
 *
 * All other modules should import paths from here, not re-define them.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Platform Flags ──────────────────────────────────────────────────
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';
export const isWindows = process.platform === 'win32';

// ─── Constants for Candidate App Folder & Title Names ─────────────────
const APP_FOLDER_NAMES = ['antigravity-ide', 'antigravity'];
const APP_TITLE_NAMES = ['Antigravity IDE', 'Antigravity'];
const AG_APP_BUNDLE_NAMES = ['Antigravity IDE.app', 'Antigravity.app'];

// ─── Path Resolution Helpers ─────────────────────────────────────────

function isDir(p: string): boolean {
    try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function resolveAllExistingDirs(paths: string[]): string[] {
    const existing = paths.filter(isDir);
    return existing.length > 0 ? existing : [paths[0]];
}

function resolveFirstExistingDir(paths: string[]): string {
    return resolveAllExistingDirs(paths)[0];
}

function resolveFirstExistingPath(paths: string[]): string {
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return paths[0];
}

function buildDotGeminiSubdirs(subDir?: string): string[] {
    return APP_FOLDER_NAMES.map(name =>
        subDir ? path.join(os.homedir(), '.gemini', name, subDir) : path.join(os.homedir(), '.gemini', name)
    );
}

// ─── Antigravity Application Paths ───────────────────────────────────

/** Base Antigravity .gemini data directory */
export const GEMINI_AG_DIR = resolveFirstExistingDir(buildDotGeminiSubdirs());

/** All candidate brain directories (IDE and CLI) */
export const BRAIN_DIRS = resolveAllExistingDirs(buildDotGeminiSubdirs('brain'));

/** All candidate conversation directories (IDE and CLI) */
export const CONVERSATIONS_DIRS = resolveAllExistingDirs(buildDotGeminiSubdirs('conversations'));

/** Directory containing conversation SQLite databases */
export const CONVERSATIONS_DIR = CONVERSATIONS_DIRS[0];

/** Install roots that can all be pointed at one conversation directory. */
const INSTALL_ROOTS = ['antigravity', 'antigravity-ide', 'antigravity-cli'];

/**
 * True when the conversation directory is the same physical directory that
 * another install root also uses. Compared by realpath, so a symlink, a bind
 * mount and a duplicate literal path all give the same answer.
 *
 * Callers use this to decide whether the sidebar index can be compared against
 * the disk at all: when the command-line client and the IDE share a directory,
 * the index legitimately lists only a subset and any diff is meaningless.
 */
export function isSharedConversationStore(conversationsDir: string = CONVERSATIONS_DIR): boolean {
    let target: string;
    try { target = fs.realpathSync(conversationsDir); } catch { return false; }

    let matches = 0;
    for (const name of INSTALL_ROOTS) {
        const candidate = path.join(os.homedir(), '.gemini', name, 'conversations');
        try { if (fs.realpathSync(candidate) === target) matches++; } catch { /* absent root */ }
    }
    return matches > 1;
}

/** Directory containing conversation brain data (transcripts, artifacts) */
export const BRAIN_DIR = BRAIN_DIRS[0];

/** Path to Antigravity's local state SQLite DB (conversation index, active account, etc.) */
export const STATE_DB_PATH = resolveFirstExistingPath(
    isMac
        ? APP_TITLE_NAMES.map(name => path.join(os.homedir(), 'Library', 'Application Support', name, 'User', 'globalStorage', 'state.vscdb'))
        : isLinux
            ? APP_TITLE_NAMES.map(name => path.join(os.homedir(), '.config', name, 'User', 'globalStorage', 'state.vscdb'))
            : isWindows
                ? APP_TITLE_NAMES.map(name => path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), name, 'User', 'globalStorage', 'state.vscdb'))
                : ['']
);

/** Ordered list of candidate cert paths for the local language server */
export const LS_CERT_PATHS: string[] = isMac
    ? AG_APP_BUNDLE_NAMES.map(appName => `/Applications/${appName}/Contents/Resources/app/extensions/antigravity/dist/languageServer/cert.pem`)
    : isLinux
        ? [
            '/opt/antigravity/resources/app/extensions/antigravity/dist/languageServer/cert.pem',
            path.join(os.homedir(), '.local', 'share', 'antigravity', 'resources', 'app', 'extensions', 'antigravity', 'dist', 'languageServer', 'cert.pem'),
        ]
        : isWindows
            ? [
                path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Antigravity', 'resources', 'app', 'extensions', 'antigravity', 'dist', 'languageServer', 'cert.pem'),
            ]
            : [];

/** grep pattern to find the LS binary in `ps` output */
export const LS_PROCESS_GREP = isMac
    ? 'language_server_macos'
    : isLinux
        ? 'language_server_linux'
        : isWindows
            ? 'language_server_win'
            : 'language_server';

// ─── @vscode/sqlite3 Native Module Resolution ───────────────────────

/** 
 * Candidate app root paths for locating @vscode/sqlite3.
 * Tried in order: vscode.env.appRoot (injected at runtime), then platform defaults.
 */
const AG_APP_ROOT_CANDIDATES: string[] = isMac
    ? [
        // The IDE build ships under its own name; the plain one may not exist, or
        // may exist without the native module. Both are listed because either can
        // be the installed product, and getSqlite3Module tries them in order.
        '/Applications/Antigravity IDE.app/Contents/Resources/app',
        '/Applications/Antigravity.app/Contents/Resources/app',
      ]
    : isLinux
        ? [
            '/opt/antigravity/resources/app',
            path.join(os.homedir(), '.local', 'share', 'antigravity', 'resources', 'app'),
        ]
        : isWindows
            ? [path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Antigravity', 'resources', 'app')]
            : [];

let _sqlite3Cache: any = undefined; // undefined = not tried, null = failed, object = module

/**
 * Resolve and cache the @vscode/sqlite3 native module bundled with AG IDE.
 * Tries vscode.env.appRoot first (when called from extension host), then platform defaults.
 * Returns null if the module cannot be found.
 */
export function getSqlite3Module(appRoot?: string): any {
    if (_sqlite3Cache !== undefined) return _sqlite3Cache;

    const candidates = appRoot
        ? [appRoot, ...AG_APP_ROOT_CANDIDATES]
        : AG_APP_ROOT_CANDIDATES;

    for (const root of candidates) {
        try {
            _sqlite3Cache = require(path.join(root, 'node_modules', '@vscode', 'sqlite3'));
            return _sqlite3Cache;
        } catch { /* try next */ }
    }
    _sqlite3Cache = null;
    return null;
}
