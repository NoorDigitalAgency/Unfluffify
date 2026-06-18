#!/usr/bin/env -S deno run -A
import { join } from "jsr:@std/path";
import { appendJsonLine, ensureRunDir } from "./lib/artifacts.mjs";
import { ScenarioBusClient } from "./lib/bus-client.mjs";
import { loadOrchestrationConfig, parseCliArgs } from "./lib/config.mjs";
import {
  createBrowserStepContext,
  createBrowserStepRegistry,
  teardown
} from "./steps/browser.mjs";

async function executeStep(registry, action, params) {
  const handler = registry[action];
  if (typeof handler !== "function") {
    return {
      ok: false,
      error: `Unknown runner action: ${action}`
    };
  }

  try {
    return await handler(params || {});
  } catch (error) {
    return {
      ok: false,
      error: String(error && error.message ? error.message : error)
    };
  }
}

export async function createRunner(options = {}) {
  const config = options.config || await loadOrchestrationConfig(options.configOptions || {});
  const runDir = options.runDir || await ensureRunDir(config.runRoot, config.role, config.side, options.runId);
  const logPath = join(runDir, "runner.log");
  const stepContext = options.stepContext || createBrowserStepContext(config, {
    playwright: options.playwright,
    artifacts: { runDir }
  });
  const registry = options.registry || createBrowserStepRegistry(stepContext);
  const bus = options.bus || new ScenarioBusClient({
    url: options.busUrl || config.busUrl,
    role: config.role,
    side: config.side,
    onMessage: (message) => {
      void handleMessage(message);
    }
  });

  let stopping = false;

  async function log(event) {
    await appendJsonLine(logPath, {
      at: new Date().toISOString(),
      ...event
    });
  }

  async function sendReport(stepId, state) {
    bus.send({
      channel: "control",
      type: "report",
      stepId,
      state
    });
    await log({ direction: "report", stepId, state });
  }

  async function handleMessage(message) {
    if (!message || message.channel !== "control") {
      return;
    }
    if (message.type === "step") {
      await log({ direction: "step", message });
      const state = await executeStep(registry, message.action, message.params);
      await sendReport(message.id, state);
      return;
    }
    if (message.type === "scenario_end") {
      stopping = true;
      await log({ direction: "scenario_end", message });
      await teardown(stepContext);
      bus.close();
    }
  }

  async function start() {
    await log({
      direction: "start",
      role: config.role,
      side: config.side,
      busUrl: options.busUrl || config.busUrl,
      runDir
    });
    await bus.connect();
    await log({ direction: "bus-hello", ack: bus.helloAck });
    return {
      ok: true,
      runDir,
      logPath
    };
  }

  async function stop() {
    if (!stopping) {
      await teardown(stepContext);
    }
    bus.close();
    await log({ direction: "stop" });
  }

  return {
    config,
    runDir,
    logPath,
    start,
    stop,
    handleMessage,
    registry,
    stepContext,
    get stopping() {
      return stopping;
    }
  };
}

async function main() {
  const argv = Deno.args;
  const cli = parseCliArgs(argv);
  const runner = await createRunner({
    configOptions: {
      argv,
      requireConfig: cli["require-config"] === true
    }
  });
  const started = await runner.start();
  console.log(`[runner] role=${runner.config.role} side=${runner.config.side}`);
  console.log(`[runner] runDir=${started.runDir}`);
  console.log(`[runner] bus=${runner.config.busUrl}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    Deno.exit(1);
  });
}
