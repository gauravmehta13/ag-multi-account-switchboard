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

// ─── Path Resolution Helpers ─────────────────────────────────────────

function resolveFirstExistingPath(paths: string[]): string {
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return paths[0];
}

function resolveFirstExistingDir(paths: string[]): string {
    for (const p of paths) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
        } catch { /* ignore */ }
    }
    return paths[0];
}

// ─── Antigravity Application Paths ───────────────────────────────────

/** Base Antigravity .gemini data directory */
export const GEMINI_AG_DIR = resolveFirstExistingDir([
    path.join(os.homedir(), '.gemini', 'antigravity-ide'),
    path.join(os.homedir(), '.gemini', 'antigravity'),
]);

/** Directory containing conversation .pb protobuf files */
export const CONVERSATIONS_DIR = resolveFirstExistingDir([
    path.join(os.homedir(), '.gemini', 'antigravity-ide', 'conversations'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'conversations'),
]);

/** Directory containing conversation brain data (transcripts, artifacts) */
export const BRAIN_DIR = resolveFirstExistingDir([
    path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'brain'),
]);

/** Path to Antigravity's local state SQLite DB (conversation index, active account, etc.) */
export const STATE_DB_PATH = resolveFirstExistingPath(
    isMac
        ? [
            path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
            path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
        ]
        : isLinux
            ? [
                path.join(os.homedir(), '.config', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
                path.join(os.homedir(), '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
            ]
            : isWindows
                ? [
                    path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
                    path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
                ]
                : ['']
);

/** Ordered list of candidate cert paths for the local language server */
export const LS_CERT_PATHS: string[] = isMac
    ? [
        '/Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/dist/languageServer/cert.pem',
        '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/dist/languageServer/cert.pem',
    ]
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
