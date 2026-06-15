const vscode = require('vscode');
const net = require('net');
const cp = require('child_process');

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

  async getChildren() {
    const labels = this.getConfiguredLabels();
    const allTasks = await vscode.tasks.fetchTasks();

    return labels.map((label) => {
      const matchingTask = allTasks.find((task) => getTaskLabel(task) === label);
      const running = vscode.tasks.taskExecutions.some(
        (execution) => getTaskLabel(execution.task) === label,
      );
      return new TaskItem(label, matchingTask, running, Boolean(matchingTask));
    });
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

  async startAll() {
    const labels = this.getConfiguredLabels();
    const allTasks = await vscode.tasks.fetchTasks();
    const running = new Set(
      vscode.tasks.taskExecutions.map((execution) => getTaskLabel(execution.task)),
    );

    let started = 0;
    for (const label of labels) {
      if (running.has(label)) {
        continue;
      }
      const task = allTasks.find((candidate) => getTaskLabel(candidate) === label);
      if (task) {
        await vscode.tasks.executeTask(task);
        started += 1;
      }
    }

    vscode.window.showInformationMessage(
      started
        ? `Task Pilot: started ${started} task(s).`
        : 'Task Pilot: everything is already running.',
    );
  }

  async restartAll() {
    const labels = this.getConfiguredLabels();
    await Promise.all(labels.map((label) => this.restartTask(label)));
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
