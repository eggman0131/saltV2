const vscode = require('vscode');

const DEFAULT_LABELS = ['Firebase Emulators', 'Vite Dev Server', 'Genkit Admin UI'];

function getTaskLabel(task) {
  return task?.name || task?.definition?.label || 'Unnamed Task';
}

class TaskItem extends vscode.TreeItem {
  constructor(label, task, running, exists) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.taskLabel = label;
    this.task = task;
    this.running = running;
    this.exists = exists;

    if (!exists) {
      this.description = 'Missing from tasks.json';
      this.contextValue = 'taskMissing';
      this.iconPath = new vscode.ThemeIcon('warning');
      this.command = {
        command: 'taskPilot.openTaskConfig',
        title: 'Open tasks.json',
      };
      return;
    }

    this.description = running ? 'Running' : 'Stopped';
    this.contextValue = running ? 'taskRunning' : 'taskStopped';
    this.iconPath = new vscode.ThemeIcon(running ? 'debug-stop' : 'play');
    this.tooltip = running
      ? `${label} is running. Click to stop.`
      : `${label} is stopped. Click to start.`;
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

  async toggleTask(itemOrLabel) {
    const label = typeof itemOrLabel === 'string' ? itemOrLabel : itemOrLabel?.taskLabel;
    if (!label) {
      return;
    }

    const runningExecution = vscode.tasks.taskExecutions.find(
      (execution) => getTaskLabel(execution.task) === label,
    );

    if (runningExecution) {
      await this.stopTask(label, runningExecution);
      return;
    }

    const allTasks = await vscode.tasks.fetchTasks();
    const task = allTasks.find((candidate) => getTaskLabel(candidate) === label);
    if (!task) {
      vscode.window.showWarningMessage(`Task \"${label}\" was not found in tasks.json.`);
      return;
    }

    await vscode.tasks.executeTask(task);
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
      terminal.show(false);
      await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
        text: '\u0003',
      });
      vscode.window.showInformationMessage(`Sent Ctrl+C to \"${label}\" for graceful shutdown.`);
      return;
    }

    // Fallback when the task terminal cannot be located.
    runningExecution.terminate();
  }

  async showOutput(itemOrLabel) {
    const label = typeof itemOrLabel === 'string' ? itemOrLabel : itemOrLabel?.taskLabel;
    if (!label) {
      return;
    }

    let terminal = this.terminalsByLabel.get(label);
    if (!terminal) {
      terminal = this.findTerminalByLabel(label);
      if (terminal) {
        this.terminalsByLabel.set(label, terminal);
      }
    }

    if (terminal) {
      terminal.show(true);
      return;
    }

    await vscode.commands.executeCommand('workbench.action.terminal.focus');
    vscode.window.showInformationMessage(
      `No terminal is associated with \"${label}\" yet. Start it first to capture output.`,
    );
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
    vscode.commands.registerCommand('taskPilot.showOutput', (item) => provider.showOutput(item)),
    vscode.commands.registerCommand('taskPilot.openTaskConfig', openTaskConfig),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
