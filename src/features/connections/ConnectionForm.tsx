import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { connectionsApi, parseConnectionUrl } from './api';
import { DEFAULT_COLORS } from './types';
import type { ConnectionInput, ConnectionProfile, DbDriver, SslMode } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Present when editing an existing connection */
  profile?: ConnectionProfile;
  initialUrl?: string;
  onSaved: () => void;
}

const SSL_OPTIONS: { value: SslMode; label: string }[] = [
  { value: 'disable', label: 'Disable' },
  { value: 'prefer', label: 'Prefer' },
  { value: 'require', label: 'Require' },
  { value: 'verifyFull', label: 'Verify Full' },
];

type ConnectionType = 'host' | 'socket';
type TestState = 'idle' | 'testing' | { ms: number } | { error: string };

const DEFAULT_PORT: Record<DbDriver, number> = { postgres: 5432, mysql: 3306 };

// Pool sizing is per connection profile; mirrors `pool_max_size` in
// src-tauri/src/commands/connections.rs.
const DEFAULT_POOL_MAX_CONNECTIONS = 4;
const MAX_POOL_MAX_CONNECTIONS = 10;
const DRIVER_LABELS: Record<DbDriver, string> = { postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB' };

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-secondary">{label}</span>
      {children}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border border-separator bg-control px-2.5 py-1.5',
        'text-sm text-label placeholder:text-secondary',
        'focus:outline-none focus:ring-2 focus:ring-accent/50',
        props.className,
      )}
    />
  );
}

export function ConnectionForm({ open, onClose, profile, initialUrl, onSaved }: Props) {
  const isEdit = !!profile;

  const [driver, setDriver] = useState<DbDriver>(profile?.driver ?? 'postgres');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [color, setColor] = useState<string>(profile?.color ?? DEFAULT_COLORS[0]);
  const [folder, setFolder] = useState(profile?.folder ?? '');
  const [connType, setConnType] = useState<ConnectionType>(
    profile?.socketPath ? 'socket' : 'host',
  );
  const [host, setHost] = useState(profile?.host ?? 'localhost');
  const [port, setPort] = useState(String(profile?.port ?? 5432));
  const [socketPath, setSocketPath] = useState(profile?.socketPath ?? '');
  const [database, setDatabase] = useState(profile?.database ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [password, setPassword] = useState('');
  const [sslMode, setSslMode] = useState<SslMode>(profile?.sslMode ?? 'prefer');
  const [poolMaxConnections, setPoolMaxConnections] = useState(
    String(profile?.poolMaxConnections ?? DEFAULT_POOL_MAX_CONNECTIONS),
  );
  const [urlInput, setUrlInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testState, setTestState] = useState<TestState>('idle');
  const [saving, setSaving] = useState(false);

  // Tracks the form's current "context" so we only reset fields when it
  // actually changes (different profile, different seed URL, or after a save).
  // This lets a user close the dialog and reopen "New Connection" without
  // losing the draft they were typing.
  const contextKeyRef = useRef<string | null>(null);

  function applyParsedUrl(rawUrl: string) {
    if (!rawUrl.trim()) return;
    const parsed = parseConnectionUrl(rawUrl.trim());
    if (parsed.driver) setDriver(parsed.driver);
    if (parsed.sslMode) setSslMode(parsed.sslMode);
    if (parsed.host) { setHost(parsed.host); setConnType('host'); }
    if (parsed.port) setPort(String(parsed.port));
    if (parsed.database) setDatabase(parsed.database);
    if (parsed.username) setUsername(parsed.username);
    if (parsed.password) setPassword(parsed.password);
    if (parsed.database) {
      setDisplayName((current) => current.trim() ? current : parsed.database!);
    }
  }

  function applyUrl() {
    applyParsedUrl(urlInput);
  }

  // Clear transient UI state on open transition (during render, not effect).
  const prevOpenRef = useRef(open);
  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (open) {
      setErrors({});
      setTestState('idle');
      setSaving(false);
    }
  }

  // Reset form state when the "context" (profile + seed URL) changes.
  // Adjusting during render avoids the extra stale-intermediate commit
  // that an effect-based sync would produce.
  const nextCtx = open
    ? profile
      ? `edit:${profile.id}`
      : `new:${initialUrl ?? ''}`
    : null;
  if (open && nextCtx !== contextKeyRef.current) {
    contextKeyRef.current = nextCtx;

    const d = profile?.driver ?? 'postgres';
    setDriver(d);
    setDisplayName(profile?.displayName ?? '');
    setColor(profile?.color ?? DEFAULT_COLORS[0]);
    setFolder(profile?.folder ?? '');
    setConnType(profile?.socketPath ? 'socket' : 'host');
    setHost(profile?.host ?? 'localhost');
    setPort(String(profile?.port ?? DEFAULT_PORT[d]));
    setSocketPath(profile?.socketPath ?? '');
    setDatabase(profile?.database ?? '');
    setUsername(profile?.username ?? '');
    setPassword('');
    setSslMode(profile?.sslMode ?? 'prefer');
    setPoolMaxConnections(String(profile?.poolMaxConnections ?? DEFAULT_POOL_MAX_CONNECTIONS));
    setUrlInput(initialUrl ?? '');

    if (!profile && initialUrl) {
      applyParsedUrl(initialUrl);
    }
  }

  function buildInput(): ConnectionInput {
    const maxConn = parseInt(poolMaxConnections);
    return {
      displayName: displayName.trim(),
      color: color || null,
      folder: folder.trim() || null,
      driver,
      host: connType === 'host' ? host.trim() || null : null,
      port: parseInt(port) || DEFAULT_PORT[driver],
      socketPath: driver === 'postgres' && connType === 'socket' ? socketPath.trim() || null : null,
      database: database.trim(),
      username: username.trim(),
      sslMode,
      poolMaxConnections:
        maxConn > 0 ? Math.min(maxConn, MAX_POOL_MAX_CONNECTIONS) : DEFAULT_POOL_MAX_CONNECTIONS,
    };
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!displayName.trim()) errs.displayName = 'Required';
    if (connType === 'host' && !host.trim()) errs.host = 'Required';
    if (connType === 'socket' && !socketPath.trim()) errs.socketPath = 'Required';
    if (!database.trim()) errs.database = 'Required';
    if (!username.trim()) errs.username = 'Required';
    if (!isEdit && !password) errs.password = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleTest() {
    if (!validate()) return;
    if (!password && !isEdit) return;
    setTestState('testing');
    try {
      const ms = await connectionsApi.test(buildInput(), password);
      setTestState({ ms });
    } catch (e) {
      setTestState({ error: String(e) });
    }
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await connectionsApi.update(profile.id, buildInput(), password || undefined);
      } else {
        await connectionsApi.create(buildInput(), password);
      }
      // Reset draft on successful save so the next open starts fresh.
      contextKeyRef.current = null;
      onSaved();
      onClose();
    } catch (e) {
      setErrors({ _form: String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[520px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-64px)] flex flex-col rounded-[var(--radius-modal)] overflow-hidden',
            'bg-content border border-separator shadow-[var(--shadow-modal)]',
          )}
          aria-label={isEdit ? 'Edit connection' : 'New connection'}
          aria-describedby={undefined}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-separator shrink-0">
            <Dialog.Title className="text-sm font-semibold text-label">
              {isEdit ? 'Edit connection' : 'New connection'}
            </Dialog.Title>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-control text-secondary hover:text-label transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Driver selector */}
            <fieldset className="flex flex-col gap-1 border-none p-0">
              <legend className="text-xs font-medium text-secondary">Database type</legend>
              <div className="flex rounded-md overflow-hidden border border-separator w-fit">
                {(['postgres', 'mysql'] as DbDriver[]).map((d) => (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={driver === d}
                    onClick={() => {
                      setDriver(d);
                      setPort(String(DEFAULT_PORT[d]));
                      if (d === 'mysql') setConnType('host');
                    }}
                    className={cn(
                      'px-3 py-1 text-xs font-medium transition-colors',
                      driver === d
                        ? 'bg-accent text-inverse'
                        : 'text-secondary hover:text-label hover:bg-control',
                    )}
                  >
                    {DRIVER_LABELS[d]}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Quick-connect URL */}
            <div className="flex gap-2">
              <Input
                aria-label="Connection URL"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={driver === 'mysql' ? 'mysql://user:pass@host:3306/db' : 'postgres://user:pass@host:5432/db'}
                className="flex-1"
              />
              <button
                type="button"
                onClick={applyUrl}
                className={cn(
                  'shrink-0 px-3 rounded-md text-xs font-medium',
                  'bg-control text-label hover:bg-separator transition-colors',
                )}
              >
                Use URL
              </button>
            </div>

            <div className="border-t border-separator" />

            <Field label="Name" error={errors.displayName}>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Database"
              />
            </Field>

            {/* Connection type toggle — Postgres only */}
            {driver === 'postgres' && (
              <fieldset className="flex flex-col gap-1 border-none p-0">
                <legend className="text-xs font-medium text-secondary">Connection Type</legend>
                <div className="flex rounded-md overflow-hidden border border-separator w-fit">
                  {(['host', 'socket'] as ConnectionType[]).map((t) => (
                    <button
                      type="button"
                      key={t}
                      aria-pressed={connType === t}
                      onClick={() => setConnType(t)}
                      className={cn(
                        'px-3 py-1 text-xs font-medium transition-colors',
                        connType === t
                          ? 'bg-accent text-inverse'
                          : 'text-secondary hover:text-label hover:bg-control',
                      )}
                    >
                      {t === 'host' ? 'Host / Port' : 'Unix Socket'}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {driver === 'postgres' && connType === 'socket' ? (
              <Field label="Socket Path" error={errors.socketPath}>
                <Input
                  value={socketPath}
                  onChange={(e) => setSocketPath(e.target.value)}
                  placeholder="/var/run/postgresql"
                />
              </Field>
            ) : (
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <Field label="Host" error={errors.host}>
                  <Input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="localhost"
                    className="flex-1"
                  />
                </Field>
                <div className="w-24">
                  <Field label="Port">
                    <Input
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      type="number"
                      min={1}
                      max={65535}
                    />
                  </Field>
                </div>
              </div>
            )}

            <Field label="Database" error={errors.database}>
              <Input
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="postgres"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Username" error={errors.username}>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="postgres"
                />
              </Field>

              <Field label="Password" error={errors.password}>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder={isEdit ? 'Unchanged' : 'Required'}
                />
              </Field>
            </div>

            <details className="border-t border-separator pt-4">
              <summary className="cursor-default text-[13px] font-medium text-secondary hover:text-label">Advanced</summary>
              <div className="mt-4 space-y-4">
                <div className="flex gap-4">
                  {/* Color */}
                  <fieldset className="flex flex-col gap-1 border-none p-0">
                    <legend className="text-xs font-medium text-secondary">Color</legend>
                    <div className="flex gap-1.5 mt-0.5">
                      {DEFAULT_COLORS.map((c) => (
                        <button
                          type="button"
                          key={c}
                          aria-pressed={color === c}
                          aria-label={`Color: ${c}`}
                          onClick={() => setColor(c)}
                          style={{ backgroundColor: c }}
                          className={cn(
                            'w-5 h-5 rounded-full border-2 transition-transform',
                            color === c ? 'border-label scale-110' : 'border-transparent',
                          )}
                        />
                      ))}
                    </div>
                  </fieldset>

                  {/* Folder */}
                  <Field label="Folder">
                    <Input
                      value={folder}
                      onChange={(e) => setFolder(e.target.value)}
                      placeholder="Production"
                    />
                  </Field>
                </div>

                <Field label="SSL Mode">
                    <select
                      value={sslMode}
                      onChange={(e) => setSslMode(e.target.value as SslMode)}
                      className={cn(
                        'w-full rounded-md border border-separator bg-control px-2.5 py-1.5',
                        'text-sm text-label focus:outline-none focus:ring-2 focus:ring-accent/50',
                      )}
                    >
                      {SSL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {driver === 'mysql' && o.value === 'prefer' ? 'Prefer (requires TLS for MySQL)' : o.label}
                        </option>
                      ))}
                    </select>
                </Field>

                <Field label="Connection pool limit">
                  <Input
                    value={poolMaxConnections}
                    onChange={(e) => setPoolMaxConnections(e.target.value)}
                    type="number"
                    min={1}
                    max={MAX_POOL_MAX_CONNECTIONS}
                    className="w-24"
                  />
                </Field>
              </div>
            </details>

            {errors._form && (
              <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
                {errors._form}
              </p>
            )}

            {/* Test connection result */}
            {testState !== 'idle' && testState !== 'testing' && (
              <div
                className={cn(
                  'text-xs rounded px-3 py-2 border',
                  'ms' in testState
                    ? 'border-success/30 bg-success/10 text-label'
                    : 'border-destructive/30 bg-destructive/10 text-label',
                )}
              >
                {'ms' in testState
                  ? `Connected in ${testState.ms} ms`
                  : testState.error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-separator shrink-0">
            <button
              type="button"
              onClick={handleTest}
              disabled={testState === 'testing'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                'bg-control text-label hover:bg-separator transition-colors',
                'disabled:opacity-50',
              )}
            >
              <Zap size={12} />
              {testState === 'testing' ? 'Testing…' : 'Test connection'}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-secondary hover:text-label hover:bg-control transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium',
                  'bg-accent text-inverse hover:bg-accent-hover transition-colors',
                  'disabled:opacity-50',
                )}
              >
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add connection'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
