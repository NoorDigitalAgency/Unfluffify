import { assert } from "./test-kit.ts";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "./file-kit.ts";
import os from "node:os";
import { path } from "./file-kit.ts";
import { test } from "./test-kit.ts";

import {
  loadOrchestrationSecrets,
  normalizeStageBase,
  resolveSecretAccount,
  validateOrchestrationSecrets
} from "../orchestration/lib/secrets.mjs";
import { parseJsonc } from "../orchestration/lib/jsonc.mjs";
import {
  AUTH_SETUP_SELECTORS,
  clearStoredAuthToken,
  ensureEditableField,
  openConfigurationPopup,
  validateAuthProfileTarget,
  waitForToken
} from "../orchestration/setup-auth.mjs";

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

test("orchestration secrets loader reads commented default JSONC secrets", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "unfluffify-secrets-jsonc-test-"));
  const orchestrationDir = path.join(tmp, "orchestration");
  const secretsPath = path.join(orchestrationDir, ".secrets.jsonc");
  await mkdir(orchestrationDir, { recursive: true });
  await writeFile(secretsPath, `{
    // Shared staging endpoint values.
    "config": {
      // Configuration endpoint URL.
      "configurationEndpoint": "https://config.example.test",
      // AI endpoint URL.
      "aiEndpoint": "https://ai.example.test",
      // Stage host.
      "stageBase": "noorlynx.com",
    },
    // Accounts available to the runner.
    "accounts": {
      // Director account.
      "A": {
        // Login email.
        "email": "a@example.test",
        // Login password.
        "password": "secret-a",
      },
    },
  }`);

  try {
    const result = await loadOrchestrationSecrets({ cwd: tmp });
    assert.equal(result.secretsPath, secretsPath);
    assert.equal(result.secrets.config.stageBase, "noorlynx.com");
    assert.equal(resolveSecretAccount(result.secrets, "A").email, "a@example.test");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("user-fillable orchestration examples are commented JSONC", async () => {
  const examples = [
    {
      filePath: path.join(process.cwd(), "orchestration/config.example.jsonc"),
      fields: [
        "role",
        "side",
        "account",
        "busHost",
        "busPort",
        "displayMode",
        "mediaMode",
        "chromePath",
        "playwrightModulePath",
        "extensionPath",
        "profileDir",
        "stageBase",
        "testPropertyUrl",
        "captureSourceTitle",
        "insecureOrigins"
      ]
    },
    {
      filePath: path.join(process.cwd(), "orchestration/secrets.example.jsonc"),
      fields: [
        "config",
        "configurationEndpoint",
        "aiEndpoint",
        "stageBase",
        "accounts",
        "A",
        "email",
        "password",
        "B"
      ]
    }
  ];

  for (const example of examples) {
    const source = await readFile(example.filePath, "utf8");
    assert.match(source, /\/\//, `${example.filePath} should use JSONC comments`);
    assert.doesNotThrow(() => parseJsonc(source, example.filePath));
    for (const field of example.fields) {
      assert.match(
        source,
        new RegExp(`//[^\\n]*(?:\\n\\s*//[^\\n]*)*\\n\\s*"${field}"`),
        `${example.filePath} should comment ${field}`
      );
    }
  }
});

test("stage base normalization accepts hosts and URLs", () => {
  assert.equal(normalizeStageBase("noorlynx.com"), "noorlynx.com");
  assert.equal(normalizeStageBase("https://accounts.NoorLynx.com/login"), "accounts.noorlynx.com");
  assert.equal(normalizeStageBase(""), "");
});

test("auth setup script targets the current popup configuration controls", async () => {
  const popupUiSource = await readFile(path.join(process.cwd(), "src/popup/ui.ts"), "utf8");
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

test("auth setup accepts a popup that already opened in configuration view", async () => {
  const calls = [];
  const popup = {
    async goto(url, options) {
      calls.push(["goto", url, options.waitUntil]);
    },
    async waitForSelector(selector, options) {
      calls.push(["wait", selector, options && options.state]);
      assert.equal(selector, AUTH_SETUP_SELECTORS.configurationEndpointInput);
      return {};
    },
    async click(selector) {
      calls.push(["click", selector]);
    }
  };
  const context = {
    browserContext: {
      async newPage() {
        return popup;
      }
    },
    extensionId: "extension-id"
  };

  const result = await openConfigurationPopup(context);

  assert.equal(result, popup);
  assert.deepEqual(calls, [
    ["goto", "chrome-extension://extension-id/popup.html", "domcontentloaded"],
    ["wait", AUTH_SETUP_SELECTORS.configurationEndpointInput, "visible"]
  ]);
});

test("auth setup reports popup login failures while waiting for a token", async () => {
  const worker = {
    async evaluate() {
      return { globalToken: "" };
    }
  };
  const popup = {
    async evaluate() {
      return {
        tokenStatusText: "Login required",
        toastText: "Login failed (400)"
      };
    }
  };

  await assert.rejects(
    () => waitForToken(worker, { popup, timeoutMs: 1000, pollIntervalMs: 1 }),
    /Authentication failed before token was saved \(token status: Login required; toast: Login failed \(400\)\)/
  );
});

test("auth setup refuses obvious director/follower profile mismatches", () => {
  assert.equal(validateAuthProfileTarget({
    role: "director",
    side: "A",
    profileDir: path.join(process.cwd(), "orchestration/profiles/director")
  }), true);
  assert.equal(validateAuthProfileTarget({
    role: "follower",
    side: "B",
    profileDir: path.join(process.cwd(), "orchestration/profiles/follower")
  }), true);
  assert.throws(
    () => validateAuthProfileTarget({
      role: "follower",
      side: "B",
      profileDir: path.join(process.cwd(), "orchestration/profiles/director")
    }),
    /Refusing to seed follower auth into director profile/
  );
});

test("auth setup clears stale tokens before submitting credentials", async () => {
  let evaluatedSource = "";
  const worker = {
    async evaluate(pageFunction) {
      evaluatedSource = String(pageFunction);
    }
  };

  await clearStoredAuthToken(worker);

  assert.match(evaluatedSource, /chrome\.storage\.sync\.set/);
  assert.match(evaluatedSource, /globalToken:\s*""/);
});

test("auth setup clears stale tokens before opening the popup", async () => {
  const setupAuthSource = await readFile(path.join(process.cwd(), "orchestration/setup-auth.mjs"), "utf8");
  assert.match(
    setupAuthSource,
    /await launchBrowser\(context\);\s+await clearStoredAuthToken\(context\.worker\);\s+popup = await openConfigurationPopup\(context\);/
  );
});

test("auth setup waits for edit controls before filling read-only fields", async () => {
  const calls = [];
  let readOnly = true;
  const page = {
    async waitForSelector(selector, options) {
      calls.push(["waitInput", selector, options.state]);
    },
    locator(selector) {
      if (selector === AUTH_SETUP_SELECTORS.configurationEndpointInput) {
        return {
          async evaluate() {
            return readOnly;
          }
        };
      }
      assert.equal(selector, AUTH_SETUP_SELECTORS.configurationEndpointEdit);
      return {
        first() {
          return {
            async waitFor(options) {
              calls.push(["waitEdit", options.state]);
            },
            async click() {
              calls.push(["clickEdit"]);
              readOnly = false;
            }
          };
        }
      };
    },
    async waitForFunction(_pageFunction, selector, options) {
      calls.push(["waitEditable", selector, options.timeout]);
      assert.equal(readOnly, false);
    }
  };

  await ensureEditableField(page, {
    input: AUTH_SETUP_SELECTORS.configurationEndpointInput,
    edit: AUTH_SETUP_SELECTORS.configurationEndpointEdit
  });

  assert.deepEqual(calls, [
    ["waitInput", AUTH_SETUP_SELECTORS.configurationEndpointInput, "visible"],
    ["waitEdit", "visible"],
    ["clickEdit"],
    ["waitEditable", AUTH_SETUP_SELECTORS.configurationEndpointInput, 10000]
  ]);
});
