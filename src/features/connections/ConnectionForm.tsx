import { useEffect, useState } from 'react';
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
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-secondary">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
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
  const [urlInput, setUrlInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testState, setTestState] = useState<TestState>('idle');
  const [saving, setSaving] = useState(false);

  function applyParsedUrl(rawUrl: string) {
    if (!rawUrl.trim()) return;
    const parsed = parseConnectionUrl(rawUrl.trim());
    if (parsed.driver) setDriver(parsed.driver);
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

  useEffect(() => {
    if (!open) return;

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
    setUrlInput(initialUrl ?? '');
    setErrors({});
    setTestState('idle');
    setSaving(false);

    if (!profile && initialUrl) {
      applyParsedUrl(initialUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.id, initialUrl]);

  function buildInput(): ConnectionInput {
    return {
      displayName: displayName.trim(),
      color: color || undefined,
      folder: folder.trim() || undefined,
      driver,
      host: connType === 'host' ? host.trim() || undefined : undefined,
      port: parseInt(port) || DEFAULT_PORT[driver],
      socketPath: driver === 'postgres' && connType === 'socket' ? socketPath.trim() || undefined : undefined,
      database: database.trim(),
      username: username.trim(),
      sslMode,
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
            'fixed right-0 top-0 bottom-0 z-50',
            'w-[440px] flex flex-col',
            'bg-content border-l border-separator shadow-2xl',
          )}
          aria-label={isEdit ? 'Edit connection' : 'New connection'}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-separator shrink-0">
            <Dialog.Title className="text-sm font-semibold text-label">
              {isEdit ? 'Edit Connection' : 'New Connection'}
            </Dialog.Title>
            <button
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
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-secondary">Database</label>
              <div className="flex rounded-md overflow-hidden border border-separator w-fit">
                {(['postgres', 'mysql'] as DbDriver[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setDriver(d);
                      setPort(String(DEFAULT_PORT[d]));
                      if (d === 'mysql') setConnType('host');
                    }}
                    className={cn(
                      'px-3 py-1 text-xs font-medium transition-colors',
                      driver === d
                        ? 'bg-accent text-white'
                        : 'text-secondary hover:text-label hover:bg-control',
                    )}
                  >
                    {DRIVER_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick-connect URL */}
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={driver === 'mysql' ? 'mysql://user:pass@host:3306/db' : 'postgres://user:pass@host:5432/db'}
                className="flex-1"
              />
              <button
                onClick={applyUrl}
                className={cn(
                  'shrink-0 px-3 rounded-md text-xs font-medium',
                  'bg-control text-label hover:bg-separator transition-colors',
                )}
              >
                Parse URL
              </button>
            </div>

            <div className="border-t border-separator" />

            <Field label="Display Name" error={errors.displayName}>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Database"
              />
            </Field>

            <div className="flex gap-4">
              {/* Color */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-secondary">Color</label>
                <div className="flex gap-1.5 mt-0.5">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      style={{ backgroundColor: c }}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 transition-transform',
                        color === c ? 'border-label scale-110' : 'border-transparent',
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Folder */}
              <Field label="Folder (optional)">
                <Input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="Production"
                />
              </Field>
            </div>

            {/* Connection type toggle — Postgres only */}
            {driver === 'postgres' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-secondary">Connection Type</label>
                <div className="flex rounded-md overflow-hidden border border-separator w-fit">
                  {(['host', 'socket'] as ConnectionType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setConnType(t)}
                      className={cn(
                        'px-3 py-1 text-xs font-medium transition-colors',
                        connType === t
                          ? 'bg-accent text-white'
                          : 'text-secondary hover:text-label hover:bg-control',
                      )}
                    >
                      {t === 'host' ? 'Host / Port' : 'Unix Socket'}
                    </button>
                  ))}
                </div>
              </div>
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
              <div className="flex gap-3">
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

            <Field label="Username" error={errors.username}>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="postgres"
              />
            </Field>

            <Field label={isEdit ? 'Password (leave blank to keep)' : 'Password'} error={errors.password}>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder={isEdit ? '••••••••' : 'Required'}
              />
            </Field>

            {driver === 'postgres' && (
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
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {errors._form && (
              <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
                {errors._form}
              </p>
            )}

            {/* Test connection result */}
            {testState !== 'idle' && testState !== 'testing' && (
              <div
                className={cn(
                  'text-xs rounded px-3 py-2',
                  'ms' in testState
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-destructive/10 text-destructive',
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
              onClick={handleTest}
              disabled={testState === 'testing'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                'bg-control text-label hover:bg-separator transition-colors',
                'disabled:opacity-50',
              )}
            >
              <Zap size={12} />
              {testState === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-secondary hover:text-label hover:bg-control transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium',
                  'bg-accent text-white hover:bg-accent/90 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Connection'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
