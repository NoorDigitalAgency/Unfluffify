import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  loadOrchestrationSecrets,
  normalizeStageBase,
  resolveSecretAccount,
  validateOrchestrationSecrets
} from "../orchestration/lib/secrets.mjs";
import { AUTH_SETUP_SELECTORS } from "../orchestration/setup-auth.mjs";

test("orchestration secrets validation normalizes config and selected accounts", () => {
  const secrets = validateOrchestrationSecrets({
    config: {
      configurationEndpoint: "https://config.example.test",
      aiEndpoint: "https://ai.example.test",
      stageBase: "https://NoorLynx.com/path"
    },
    accounts: {
      A: { email: "a@example.test", password: "secret-a" },
      B: { email: "b@example.test", password: "secret-b" }
    }
  });

  assert.deepEqual(secrets.config, {
    configurationEndpoint: "https://config.example.test",
    aiEndpoint: "https://ai.example.test",
    stageBase: "noorlynx.com"
  });
  assert.equal(resolveSecretAccount(secrets, "B").email, "b@example.test");
});

test("orchestration secrets validation rejects missing or malformed secrets", () => {
  assert.throws(() => validateOrchestrationSecrets({}), /configurationEndpoint is required/);
  assert.throws(() => validateOrchestrationSecrets({
    config: {
      configurationEndpoint: "not-a-url",
      aiEndpoint: "https://ai.example.test",
      stageBase: "noorlynx.com"
    },
    accounts: {
      A: { email: "a@example.test", password: "secret-a" }
    }
  }), /configurationEndpoint must be a valid/);
  assert.throws(() => validateOrchestrationSecrets({
    config: {
      configurationEndpoint: "https://config.example.test",
      aiEndpoint: "https://ai.example.test",
      stageBase: "noorlynx.com"
    },
    accounts: {
      A: { email: "not-email", password: "secret-a" }
    }
  }), /accounts\.A\.email/);
  assert.throws(() => validateOrchestrationSecrets({
    config: {
      configurationEndpoint: "https://config.example.test",
      aiEndpoint: "https://ai.example.test",
      stageBase: "noorlynx.com"
    },
    accounts: {
      A: { email: "a@example.test", password: "" }
    }
  }), /accounts\.A\.password is required/);
});

test("orchestration secrets loader reads gitignored secret files explicitly", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "unfluffify-secrets-test-"));
  const secretsPath = path.join(tmp, ".secrets.json");
  await writeFile(secretsPath, JSON.stringify({
    config: {
      configurationEndpoint: "https://config.example.test",
      aiEndpoint: "https://ai.example.test",
      stageBase: "noorlynx.com"
    },
    accounts: {
      A: { email: "a@example.test", password: "secret-a" }
    }
  }));

  try {
    const result = await loadOrchestrationSecrets({ cwd: tmp, secretsPath });
    assert.equal(result.secretsPath, secretsPath);
    assert.equal(result.secrets.config.stageBase, "noorlynx.com");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("stage base normalization accepts hosts and URLs", () => {
  assert.equal(normalizeStageBase("noorlynx.com"), "noorlynx.com");
  assert.equal(normalizeStageBase("https://accounts.NoorLynx.com/login"), "accounts.noorlynx.com");
  assert.equal(normalizeStageBase(""), "");
});

test("auth setup script targets the current popup configuration controls", async () => {
  const popupUiSource = await readFile(path.join(process.cwd(), "popup/ui.js"), "utf8");
  for (const selector of Object.values(AUTH_SETUP_SELECTORS)) {
    const id = selector.replace(/^#/, "");
    if (id.endsWith("-set")) {
      assert.match(popupUiSource, /id: `\$\{inputId\}-set`/);
      continue;
    }
    if (id.endsWith("-edit")) {
      assert.match(popupUiSource, /id: `\$\{inputId\}-edit`/);
      continue;
    }
    assert.match(popupUiSource, new RegExp(`(?:id|inputId): "${id}"`));
  }

  assert.equal(AUTH_SETUP_SELECTORS.configurationEndpointInput, "#config-endpoint-url");
  assert.equal(AUTH_SETUP_SELECTORS.aiEndpointInput, "#endpoint-url");
  assert.equal(AUTH_SETUP_SELECTORS.stageBaseInput, "#stage-base");
  assert.equal(AUTH_SETUP_SELECTORS.emailInput, "#login-email");
  assert.equal(AUTH_SETUP_SELECTORS.passwordInput, "#login-password");
  assert.equal(AUTH_SETUP_SELECTORS.loginAction, "#login-action");
  assert.equal(AUTH_SETUP_SELECTORS.tokenStatus, "#token-status");
});
