const vscode = require('vscode');
const net = require('net');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_LABELS = ['Firebase Emulators', 'Vite Dev Server', 'Genkit Admin UI'];

// The task whose (re)start should trigger the admin-member seed.
const EMULATOR_LABEL = 'Firebase Emulators';
// Firestore emulator port — must match firebase.json `emulators.firestore.port`.
const FIRESTORE_PORT = 8080;
const FIRESTORE_HOST = '127.0.0.1';
const SEED_PROJECT = 'demo-salt';
const SEED_SCRIPT = 'apps/cloud-functions/scripts/seed-admin-member.mjs';
// How long to wait for Firestore to accept connections before giving up.
const SEED_READY_TIMEOUT_MS = 90_000;

// Per-service presentation + the browser URL its "open" button points at.
// `color` is a ThemeColor id used to tint the row icon while the service is running.
const SERVICE_META = {
  'Firebase Emulators': {
    icon: 'database',
    color: 'charts.orange',
    url: 'http://localhost:4000',
    openTitle: 'Open Firebase Emulator UI',
  },
  'Vite Dev Server': {
    icon: 'zap',
    color: 'charts.yellow',
    url: 'http://localhost:5173',
    openTitle: 'Open App (Vite)',
  },
  'Genkit Admin UI': {
    icon: 'sparkle',
    color: 'charts.purple',
    url: 'http://localhost:4001',
    openTitle: 'Open Genkit UI',
  },
};

const FALLBACK_META = { icon: 'gear', color: 'charts.blue', url: null };

// Every port the Salt dev stack can hold open, for the nuclear stop. Firebase
// emulator suite + hub/logging/extensions, Genkit UI + telemetry, Vite.
const NUKE_PORTS = [9099, 5001, 8080, 9199, 5002, 4000, 4400, 4500, 9150, 4001, 4033, 5173];

function getTaskLabel(task) {
  return task?.name || task?.definition?.label || 'Unnamed Task';
}

function metaFor(label) {
  return SERVICE_META[label] || FALLBACK_META;
}

class TaskItem extends vscode.TreeItem {
  constructor(label, task, running, exists) {
    super(label, vscode.TreeItemCollapsibleState.None);
    const meta = metaFor(label);
    this.taskLabel = label;
    this.task = task;
    this.running = running;
    this.url = meta.url;

    if (!exists) {
      this.description = 'Missing from tasks.json';
      this.contextValue = 'taskMissing';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
      this.tooltip = `"${label}" is not defined in .vscode/tasks.json. Click to open the config.`;
      this.command = {
        command: 'taskPilot.openTaskConfig',
        title: 'Open tasks.json',
      };
      return;
    }

    this.description = running ? '● Running' : '○ Stopped';
    this.contextValue = running ? 'taskRunning' : 'taskStopped';
    this.iconPath = new vscode.ThemeIcon(
      meta.icon,
      new vscode.ThemeColor(running ? meta.color : 'disabledForeground'),
    );

    const tooltip = new vscode.MarkdownString(
      `**${label}** — ${running ? 'running' : 'stopped'}\n\n` +
        (meta.url ? `$(link-external) [${meta.url}](${meta.url})\n\n` : '') +
        `Click the row to ${running ? 'stop' : 'start'}.`,
    );
    tooltip.supportThemeIcons = true;
    tooltip.isTrusted = true;
    this.tooltip = tooltip;

    this.command = {
      command: 'taskPilot.toggle',
      title: 'Toggle Task',
      arguments: [this],
    };
  }
}

// ── Dev observability toggles ─────────────────────────────────────────────────
// Three switches over what dev telemetry reaches PostHog. Each flips ONE line in
// a dev env file the minimal way the docs describe:
//   • the PostHog keys toggle by COMMENTING the line out — an absent/empty key
//     makes the adapter a complete no-op — so the real key value is preserved
//     across flips;
//   • SALT_AI_OTLP_LOCAL flips its VALUE 0<->1 (the server span exporters gate on
//     `=== '1'`, so 0 and "commented out" are equivalently off).
// Toggling only edits the file; the value is read at process start, so the
// affected dev service must be restarted to pick it up — hence the restart prompt.
const OBS_TOGGLES = [
  {
    id: 'browserPosthog',
    label: 'Browser PostHog',
    file: 'apps/web-pwa/.env.development',
    key: 'VITE_PUBLIC_POSTHOG_KEY',
    mode: 'comment',
    restart: 'Vite Dev Server',
    detail: 'posthog-js — autocapture, pageviews, events, exceptions, browser-rooted traces.',
  },
  {
    id: 'serverPosthog',
    label: 'Server PostHog',
    file: 'apps/cloud-functions/.secret.local',
    key: 'POSTHOG_API_KEY',
    mode: 'comment',
    restart: 'Firebase Emulators',
    detail:
      'posthog-node — canon.match events + server error reporting, and the bearer token for span export.',
  },
  {
    id: 'localAiSpans',
    label: 'Local AI / trace spans → PostHog',
    file: 'apps/cloud-functions/.secret.local',
    key: 'SALT_AI_OTLP_LOCAL',
    mode: 'value',
    onValue: '1',
    offValue: '0',
    restart: 'Firebase Emulators',
    detail:
      'SALT_AI_OTLP_LOCAL=1 — ship AI ($ai_generation/$ai_embedding) and distributed trace spans from the emulator (otherwise suppressed locally).',
  },
];

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Matches a `KEY=...` env line — commented or not, optional leading `export`.
// Groups: 1 indent, 2 comment marker, 3 export keyword, 4 value (rest of line).
function envLineMatcher(key) {
  return new RegExp(`^(\\s*)(#\\s*)?(export\\s+)?${key}\\s*=(.*)$`);
}

// The LAST line defining `key` (later wins, like dotenv), or null if absent.
function findEnvLine(lines, key) {
  const matcher = envLineMatcher(key);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = lines[i].match(matcher);
    if (m) {
      return {
        index: i,
        indent: m[1],
        commented: Boolean(m[2]),
        exportKw: m[3] || '',
        value: m[4],
      };
    }
  }
  return null;
}

function unquote(value) {
  const t = value.trim();
  const quoted = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return quoted ? t.slice(1, -1) : t;
}

// Is the toggle currently ON, given its matched line?
function isToggleEnabled(toggle, line) {
  if (!line || line.commented) {
    return false;
  }
  const value = unquote(line.value);
  return toggle.mode === 'value' ? value === toggle.onValue : value.length > 0;
}

// The replacement line for the desired state, preserving the existing value.
function composeEnvLine(toggle, line, enable) {
  const { indent, exportKw, value } = line;
  if (toggle.mode === 'value') {
    return `${indent}${exportKw}${toggle.key}=${enable ? toggle.onValue : toggle.offValue}`;
  }
  const bare = `${indent}${exportKw}${toggle.key}=${value}`;
  return enable ? bare : `${indent}# ${exportKw}${toggle.key}=${value}`;
}

class ObsGroupItem extends vscode.TreeItem {
  constructor() {
    super('Dev Observability', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'obsGroup';
    this.iconPath = new vscode.ThemeIcon('eye');
    this.tooltip = new vscode.MarkdownString(
      'What dev telemetry is sent to PostHog. Each toggle flips one line in a dev ' +
        'env file; the affected service must restart to pick it up.',
    );
  }
}

class ToggleItem extends vscode.TreeItem {
  constructor(toggle, enabled, present) {
    super(toggle.label, vscode.TreeItemCollapsibleState.None);
    this.toggle = toggle;
    this.contextValue = 'obsToggle';

    if (!present) {
      this.description = 'line not found';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
      this.tooltip = `"${toggle.key}" is not in ${toggle.file}. Add it first, then toggle.`;
    } else {
      this.description = enabled ? '● On' : '○ Off';
      this.iconPath = new vscode.ThemeIcon(
        enabled ? 'circle-filled' : 'circle-outline',
        new vscode.ThemeColor(enabled ? 'charts.green' : 'disabledForeground'),
      );
      const tooltip = new vscode.MarkdownString(
        `**${toggle.label}** — ${enabled ? 'on' : 'off'}\n\n` +
          `${toggle.detail}\n\n` +
          `\`${toggle.key}\` in \`${toggle.file}\`\n\n` +
          `Click to turn ${enabled ? 'OFF' : 'ON'}, then restart **${toggle.restart}**.`,
      );
      tooltip.isTrusted = true;
      this.tooltip = tooltip;
    }

    this.command = {
      command: 'taskPilot.toggleObs',
      title: 'Toggle Dev Observability',
      arguments: [this],
    };
  }
}

class TaskPilotProvider {
  constructor(context) {
    this.context = context;
    this.executionsByLabel = new Map();
    this.terminalsByLabel = new Map();
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.registerListeners();
  }

  registerListeners() {
    const startTaskDisposable = vscode.tasks.onDidStartTask((event) => {
      const label = getTaskLabel(event.execution.task);
      this.executionsByLabel.set(label, event.execution);
      // Every (re)start path — single start, restart, startAll, restartAll, or a
      // manual Run Task — ultimately fires onDidStartTask, so seeding here covers
      // them all uniformly. The emulator isn't ready yet at this point, so the
      // seed waits for Firestore to accept connections first.
      if (label === EMULATOR_LABEL) {
        this.seedAdminMember();
      }
      this.refresh();
    });

    const endTaskDisposable = vscode.tasks.onDidEndTask((event) => {
      const label = getTaskLabel(event.execution.task);
      this.executionsByLabel.delete(label);
      this.refresh();
    });

    const startTaskProcessDisposable = vscode.tasks.onDidStartTaskProcess(async (event) => {
      const label = getTaskLabel(event.execution.task);
      const terminal = await this.findTerminalByProcessId(event.processId);
      if (terminal) {
        this.terminalsByLabel.set(label, terminal);
      }
      this.refresh();
    });

    const endTaskProcessDisposable = vscode.tasks.onDidEndTaskProcess((event) => {
      const label = getTaskLabel(event.execution.task);
      if (
        !vscode.tasks.taskExecutions.some((execution) => getTaskLabel(execution.task) === label)
      ) {
        this.executionsByLabel.delete(label);
      }
      this.refresh();
    });

    const terminalCloseDisposable = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [label, savedTerminal] of this.terminalsByLabel.entries()) {
        if (savedTerminal === terminal) {
          this.terminalsByLabel.delete(label);
        }
      }
      this.refresh();
    });

    const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('taskPilot.labels')) {
        this.refresh();
      }
    });

    this.context.subscriptions.push(
      startTaskDisposable,
      endTaskDisposable,
      startTaskProcessDisposable,
      endTaskProcessDisposable,
      terminalCloseDisposable,
      configDisposable,
    );
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getConfiguredLabels() {
    const configured = vscode.workspace.getConfiguration().get('taskPilot.labels', DEFAULT_LABELS);
    if (!Array.isArray(configured) || configured.length === 0) {
      return DEFAULT_LABELS;
    }
    return configured;
  }

  async getChildren(element) {
    // Children of the "Dev Observability" group: the three telemetry toggles.
    if (element?.contextValue === 'obsGroup') {
      return OBS_TOGGLES.map((toggle) => {
        const { present, enabled } = this.readToggleState(toggle);
        return new ToggleItem(toggle, enabled, present);
      });
    }
    if (element) {
      return [];
    }

    // Root: the configured service rows, then the observability toggle group.
    const labels = this.getConfiguredLabels();
    const allTasks = await vscode.tasks.fetchTasks();

    const services = labels.map((label) => {
      const matchingTask = allTasks.find((task) => getTaskLabel(task) === label);
      const running = vscode.tasks.taskExecutions.some(
        (execution) => getTaskLabel(execution.task) === label,
      );
      return new TaskItem(label, matchingTask, running, Boolean(matchingTask));
    });

    return [...services, new ObsGroupItem()];
  }

  getTreeItem(element) {
    return element;
  }

  labelOf(itemOrLabel) {
    return typeof itemOrLabel === 'string' ? itemOrLabel : itemOrLabel?.taskLabel;
  }

  runningExecution(label) {
    return vscode.tasks.taskExecutions.find((execution) => getTaskLabel(execution.task) === label);
  }

  async findTask(label) {
    const allTasks = await vscode.tasks.fetchTasks();
    return allTasks.find((candidate) => getTaskLabel(candidate) === label);
  }

  async startTask(itemOrLabel) {
    const label = this.labelOf(itemOrLabel);
    if (!label || this.runningExecution(label)) {
      return;
    }
    const task = await this.findTask(label);
    if (!task) {
      vscode.window.showWarningMessage(`Task "${label}" was not found in tasks.json.`);
      return;
    }
    await vscode.tasks.executeTask(task);
  }

  async stopOne(itemOrLabel) {
    const label = this.labelOf(itemOrLabel);
    const running = label && this.runningExecution(label);
    if (running) {
      await this.stopTask(label, running);
    }
  }

  async toggleTask(itemOrLabel) {
    const label = this.labelOf(itemOrLabel);
    if (!label) {
      return;
    }

    const runningExecution = this.runningExecution(label);
    if (runningExecution) {
      await this.stopTask(label, runningExecution);
      return;
    }

    await this.startTask(label);
  }

  async stopTask(label, runningExecution) {
    let terminal = this.terminalsByLabel.get(label);
    if (!terminal) {
      terminal = this.findTerminalByLabel(label);
      if (terminal) {
        this.terminalsByLabel.set(label, terminal);
      }
    }

    if (terminal) {
      terminal.sendText('', false);
      return;
    }

    // Fallback when the task terminal cannot be located.
    runningExecution.terminate();
  }

  // Resolves once no execution for `label` remains running, or `timeoutMs` elapses.
  waitUntilStopped(label, timeoutMs = 15000) {
    if (!this.runningExecution(label)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        if (!this.runningExecution(label)) {
          resolve(true);
          return;
        }
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  async restartTask(itemOrLabel) {
    const label = this.labelOf(itemOrLabel);
    if (!label) {
      return;
    }
    const running = this.runningExecution(label);
    if (running) {
      await this.stopTask(label, running);
      const stopped = await this.waitUntilStopped(label);
      if (!stopped) {
        vscode.window.showWarningMessage(
          `"${label}" did not stop in time — not restarting. Try the nuclear stop.`,
        );
        return;
      }
    }
    await this.startTask(label);
  }

  // The configured labels that Start All / Restart All act on: the long-running
  // background dev services (Firebase Emulators, Vite Dev Server, Genkit Admin
  // UI). One-shot ops tasks like "Export Prod Firestore" / "Restore Staging from
  // Prod" are intentionally EXCLUDED — they're `isBackground: false`, run to
  // completion, and the staging restore is destructive, so they must never be
  // swept into a bulk start/restart. They stay individually runnable from the
  // sidebar rows. Filtering on `isBackground` keeps this self-maintaining: any
  // future one-shot task added to the sidebar is automatically excluded.
  async getSuiteTasks() {
    const labels = this.getConfiguredLabels();
    const allTasks = await vscode.tasks.fetchTasks();
    return labels
      .map((label) => ({
        label,
        task: allTasks.find((candidate) => getTaskLabel(candidate) === label),
      }))
      .filter(({ task }) => task && task.isBackground);
  }

  async startAll() {
    const suite = await this.getSuiteTasks();
    const running = new Set(
      vscode.tasks.taskExecutions.map((execution) => getTaskLabel(execution.task)),
    );

    let started = 0;
    for (const { label, task } of suite) {
      if (running.has(label)) {
        continue;
      }
      await vscode.tasks.executeTask(task);
      started += 1;
    }

    vscode.window.showInformationMessage(
      started
        ? `Task Pilot: started ${started} task(s).`
        : 'Task Pilot: everything is already running.',
    );
  }

  async restartAll() {
    const suite = await this.getSuiteTasks();
    await Promise.all(suite.map(({ label }) => this.restartTask(label)));
    vscode.window.showInformationMessage('Task Pilot: restarted the suite.');
  }

  // Waits for the Firestore emulator to come up, then seeds the admin member so
  // sign-in works against a freshly (re)started emulator. Guarded so overlapping
  // start events don't launch concurrent seeders.
  async seedAdminMember() {
    const config = vscode.workspace.getConfiguration();
    if (!config.get('taskPilot.seedAdminMember', true)) {
      return;
    }
    if (this._seeding) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }

    this._seeding = true;
    try {
      const ready = await this.waitForFirestore();
      if (!ready) {
        vscode.window.showWarningMessage(
          `Task Pilot: Firestore emulator never accepted connections on port ${FIRESTORE_PORT} — skipped admin seed.`,
        );
        return;
      }
      const email = config.get('taskPilot.seedAdminEmail', 'daniel@pendery.org');
      await this.runSeed(folder.uri.fsPath, email);
    } finally {
      this._seeding = false;
    }
  }

  // Resolves true once a TCP connection to the Firestore emulator succeeds, or
  // false if the timeout elapses first.
  waitForFirestore(timeoutMs = SEED_READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () =>
      new Promise((resolve) => {
        const socket = net.connect(FIRESTORE_PORT, FIRESTORE_HOST);
        const done = (ok) => {
          socket.destroy();
          resolve(ok);
        };
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
        socket.setTimeout(1000, () => done(false));
      });

    return new Promise((resolve) => {
      const tick = async () => {
        if (await tryConnect()) {
          resolve(true);
          return;
        }
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  // Runs the seed script via the user's shell so it resolves `node` off PATH the
  // same way the documented manual invocation does. Retries a couple of times to
  // ride out the brief window where the port is open but Firestore isn't yet
  // accepting writes.
  runSeed(cwd, email, attempt = 1) {
    const maxAttempts = 3;
    const command =
      `FIRESTORE_EMULATOR_HOST=${FIRESTORE_HOST}:${FIRESTORE_PORT} ` +
      `GOOGLE_CLOUD_PROJECT=${SEED_PROJECT} ` +
      `node ${SEED_SCRIPT} ${email}`;

    return new Promise((resolve) => {
      cp.exec(command, { cwd }, (error, stdout, stderr) => {
        if (!error) {
          vscode.window.setStatusBarMessage(`Task Pilot: seeded admin member ${email} ✓`, 4000);
          resolve(true);
          return;
        }
        if (attempt < maxAttempts) {
          setTimeout(() => resolve(this.runSeed(cwd, email, attempt + 1)), 1500);
          return;
        }
        const detail = (stderr || stdout || error.message).trim();
        vscode.window.showWarningMessage(
          `Task Pilot: admin seed failed after ${maxAttempts} attempts — ${detail}`,
        );
        resolve(false);
      });
    });
  }

  async nuke() {
    const choice = await vscode.window.showWarningMessage(
      'Nuclear stop: force-kill ALL Salt dev processes (Firebase, Vite, Genkit) by port. ' +
        'This is a hard kill — emulator data may not export. Use a normal stop to preserve it.',
      { modal: true },
      'Force-kill everything',
    );
    if (choice !== 'Force-kill everything') {
      return;
    }

    // Best effort: terminate the executions/terminals we know about first.
    const labels = new Set(this.getConfiguredLabels());
    for (const execution of vscode.tasks.taskExecutions) {
      if (labels.has(getTaskLabel(execution.task))) {
        try {
          execution.terminate();
        } catch {
          // already gone
        }
      }
    }
    for (const terminal of this.terminalsByLabel.values()) {
      try {
        terminal.dispose();
      } catch {
        // already disposed
      }
    }
    this.terminalsByLabel.clear();

    // Then force-free every port, catching orphaned children (JVM, esbuild, …).
    const ports = NUKE_PORTS.join(' ');
    const command =
      `for p in ${ports}; do ` +
      `for pid in $(lsof -ti tcp:$p 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done; ` +
      `done; ` +
      `echo "☢️  Task Pilot nuclear stop complete — freed ports: ${ports}"`;

    const terminal = vscode.window.createTerminal({ name: 'Task Pilot: Nuclear Stop' });
    terminal.show(true);
    terminal.sendText(command, true);
    this.refresh();
  }

  // ── Dev observability toggles ───────────────────────────────────────────────

  // Reads the toggle's env file and reports whether the line is present and on.
  readToggleState(toggle) {
    const root = workspaceRoot();
    if (!root) {
      return { present: false, enabled: false };
    }
    try {
      const content = fs.readFileSync(path.join(root, toggle.file), 'utf8');
      const line = findEnvLine(content.split(/\r?\n/), toggle.key);
      return { present: Boolean(line), enabled: isToggleEnabled(toggle, line) };
    } catch {
      return { present: false, enabled: false };
    }
  }

  async toggleObs(itemOrToggle) {
    const toggle = itemOrToggle?.toggle || itemOrToggle;
    if (!toggle?.file) {
      return;
    }
    const root = workspaceRoot();
    if (!root) {
      vscode.window.showWarningMessage(
        'Open the Salt workspace folder to use the observability toggles.',
      );
      return;
    }

    const fullPath = path.join(root, toggle.file);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      vscode.window.showWarningMessage(`Task Pilot: couldn't read ${toggle.file}.`);
      return;
    }

    const lines = content.split(/\r?\n/);
    const line = findEnvLine(lines, toggle.key);
    if (!line) {
      const openFile = 'Open file';
      const choice = await vscode.window.showWarningMessage(
        `Task Pilot: no "${toggle.key}" line in ${toggle.file} — add it before toggling.`,
        openFile,
      );
      if (choice === openFile) {
        this.openFile(toggle.file);
      }
      return;
    }

    const enable = !isToggleEnabled(toggle, line);
    lines[line.index] = composeEnvLine(toggle, line, enable);
    try {
      fs.writeFileSync(fullPath, lines.join('\n'));
    } catch {
      vscode.window.showWarningMessage(`Task Pilot: couldn't write ${toggle.file}.`);
      return;
    }

    this.refresh();
    await this.announceToggle(toggle, enable);
  }

  // Tells the user the affected service needs a restart — and offers to do it —
  // when that service is currently running. When it's stopped, the next start
  // picks the change up, so just confirm in the status bar.
  async announceToggle(toggle, enabled) {
    const state = enabled ? 'ON' : 'OFF';
    if (!this.runningExecution(toggle.restart)) {
      vscode.window.setStatusBarMessage(
        `Task Pilot: ${toggle.label} → ${state}. Applies on next ${toggle.restart} start.`,
        5000,
      );
      return;
    }
    const restart = `Restart ${toggle.restart}`;
    const choice = await vscode.window.showWarningMessage(
      `${toggle.label} → ${state}. ${toggle.restart} is running — restart it for the change to take effect.`,
      restart,
    );
    if (choice === restart) {
      await this.restartTask(toggle.restart);
    }
  }

  openFile(relativePath) {
    const root = workspaceRoot();
    if (!root) {
      return;
    }
    const uri = vscode.Uri.file(path.join(root, relativePath));
    vscode.workspace.openTextDocument(uri).then((doc) => vscode.window.showTextDocument(doc));
  }

  async openUrl(itemOrLabel) {
    const label = this.labelOf(itemOrLabel);
    const meta = metaFor(label);
    if (!meta.url) {
      vscode.window.showWarningMessage(`No browser URL is configured for "${label}".`);
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(meta.url));
  }

  findTerminalByLabel(label) {
    return vscode.window.terminals.find(
      (terminal) => terminal.name === label || terminal.name.includes(label),
    );
  }

  async findTerminalByProcessId(processId) {
    if (!processId) {
      return undefined;
    }

    for (const terminal of vscode.window.terminals) {
      try {
        const terminalPid = await terminal.processId;
        if (terminalPid === processId) {
          return terminal;
        }
      } catch {
        // Ignore terminals that fail process ID lookup.
      }
    }

    return undefined;
  }
}

function openTaskConfig() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder to configure tasks.');
    return;
  }

  const tasksUri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
  vscode.workspace.openTextDocument(tasksUri).then((doc) => vscode.window.showTextDocument(doc));
}

function activate(context) {
  const provider = new TaskPilotProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('taskPilotView', provider),
    vscode.commands.registerCommand('taskPilot.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('taskPilot.toggle', (item) => provider.toggleTask(item)),
    vscode.commands.registerCommand('taskPilot.toggleObs', (item) => provider.toggleObs(item)),
    vscode.commands.registerCommand('taskPilot.start', (item) => provider.startTask(item)),
    vscode.commands.registerCommand('taskPilot.stop', (item) => provider.stopOne(item)),
    vscode.commands.registerCommand('taskPilot.restart', (item) => provider.restartTask(item)),
    vscode.commands.registerCommand('taskPilot.open', (item) => provider.openUrl(item)),
    vscode.commands.registerCommand('taskPilot.startAll', () => provider.startAll()),
    vscode.commands.registerCommand('taskPilot.restartAll', () => provider.restartAll()),
    vscode.commands.registerCommand('taskPilot.nuke', () => provider.nuke()),
    vscode.commands.registerCommand('taskPilot.openTaskConfig', openTaskConfig),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
