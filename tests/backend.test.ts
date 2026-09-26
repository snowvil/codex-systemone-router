import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OLLAYA_MODEL,
  DEFAULT_OLLAYA_TIMEOUT_MS,
  DEFAULT_OLLAYA_URL,
  OllayaBackend,
  parseOllayaResponse,
} from "../src/backend/ollaya.js";
import { normalizeProbabilities } from "../src/policy/score.js";
import { RouterError } from "../src/errors/errors.js";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

async function withMockServer<T>(
  handler: Handler,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/decide`;
  try {
    return await run(url);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  let content = "";
  for await (const chunk of request) {
    content += String(chunk);
  }
  const parsed: unknown = JSON.parse(content);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed as Record<string, unknown>;
}

function responseBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    answers: {
      reasoning_effort: {
        choice: "high",
        confidence: 0.8,
        probabilities: {
          low: 0.1,
          medium: 0.2,
          high: 0.5,
          xhigh: 0.2,
        },
      },
    },
    total_duration: 218_000_000,
    ...overrides,
  };
}

describe("Ollaya response normalization", () => {
  it("normalizes near-one probabilities and computes the ordinal score", () => {
    const probabilities = normalizeProbabilities({
      low: 0.100001,
      medium: 0.199999,
      high: 0.500001,
      xhigh: 0.200001,
    });
    assert.ok(
      Math.abs(
        probabilities.low +
          probabilities.medium +
          probabilities.high +
          probabilities.xhigh -
          1,
      ) < 1e-12,
    );
    const decision = parseOllayaResponse(responseBody(), 12, "kev:latest");
    assert.equal(decision.choice, "high");
    assert.equal(decision.latencyMs, 218);
    assert.equal(decision.score, 1.8);
    assert.equal(decision.backend, "ollaya");
    assert.equal(decision.decisionModel, "kev:latest");
  });

  it("rejects grossly invalid distributions", () => {
    assert.throws(
      () =>
        normalizeProbabilities({
          low: 0.2,
          medium: 0.2,
          high: 0.2,
          xhigh: 0.2,
        }),
      (error: unknown) =>
        error instanceof RouterError &&
        error.reason === "invalid_probabilities",
    );
  });

  it("rejects malformed answer and unknown choices", () => {
    assert.throws(
      () => parseOllayaResponse({}, 1, "kev:latest"),
      (error: unknown) =>
        error instanceof RouterError && error.reason === "malformed_response",
    );
    assert.throws(
      () =>
        parseOllayaResponse(
          responseBody({
            answers: { reasoning_effort: { choice: "impossible" } },
          }),
          1,
          "kev:latest",
        ),
      (error: unknown) =>
        error instanceof RouterError && error.reason === "malformed_response",
    );
  });
});

describe("OllayaBackend configuration", () => {
  it("uses v0.1 defaults", () => {
    const backend = new OllayaBackend();
    assert.equal(backend.url, DEFAULT_OLLAYA_URL);
    assert.equal(backend.model, DEFAULT_OLLAYA_MODEL);
    assert.equal(backend.timeoutMs, DEFAULT_OLLAYA_TIMEOUT_MS);
  });

  it("rejects invalid options", () => {
    assert.throws(
      () => new OllayaBackend({ timeoutMs: 0 }),
      (error: unknown) =>
        error instanceof RouterError &&
        error.reason === "invalid_configuration",
    );
    assert.throws(
      () => new OllayaBackend({ url: "file:///tmp/decide" }),
      (error: unknown) =>
        error instanceof RouterError &&
        error.reason === "invalid_configuration",
    );
  });
});

describe("OllayaBackend HTTP adapter", () => {
  it("sends the typed-choice request and parses a valid response", async () => {
    let requestBody: Record<string, unknown> | undefined;
    await withMockServer(
      async (request, response) => {
        requestBody = await readJson(request);
        sendJson(response, 200, responseBody());
      },
      async (url) => {
        const decision = await new OllayaBackend({
          url,
          model: "kev:test",
          timeoutMs: 500,
        }).decide({
          task: "Rename a local variable without changing behavior.",
        });
        assert.equal(decision.choice, "high");
        assert.equal(decision.latencyMs, 218);
        assert.equal(decision.score, 1.8);
      },
    );

    assert.equal(requestBody?.model, "kev:test");
    assert.equal(
      requestBody?.state,
      "Rename a local variable without changing behavior.",
    );
    const questions = requestBody?.questions;
    assert.ok(questions && typeof questions === "object");
    const question = (questions as Record<string, unknown>).reasoning_effort;
    assert.ok(question && typeof question === "object");
    assert.equal((question as Record<string, unknown>).type, "choice");
    assert.equal(
      (question as Record<string, unknown>).instructions,
      "How much reasoning effort should a Codex software engineering agent use to complete this task reliably?",
    );
  });

  it("maps a stalled backend to timeout", async () => {
    await withMockServer(
      (_request, _response) => {
        // Leave the response pending until the client aborts.
      },
      async (url) => {
        await assert.rejects(
          new OllayaBackend({ url, timeoutMs: 20 }).decide({ task: "wait" }),
          (error: unknown) =>
            error instanceof RouterError && error.reason === "timeout",
        );
      },
    );
  });

  it("times out when headers arrive but the response body stalls", async () => {
    await withMockServer(
      (_request, response) => {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.write('{"answers":');
      },
      async (url) => {
        await assert.rejects(
          new OllayaBackend({ url, timeoutMs: 30 }).decide({ task: "wait" }),
          (error: unknown) =>
            error instanceof RouterError && error.reason === "timeout",
        );
      },
    );
  });

  it("maps connection errors and non-2xx responses to backend_unavailable", async () => {
    await assert.rejects(
      new OllayaBackend({
        url: "http://127.0.0.1:1/api/decide",
        timeoutMs: 100,
      }).decide({ task: "wait" }),
      (error: unknown) =>
        error instanceof RouterError && error.reason === "backend_unavailable",
    );

    await withMockServer(
      (_request, response) => {
        sendJson(response, 500, { error: "failed" });
      },
      async (url) => {
        await assert.rejects(
          new OllayaBackend({ url, timeoutMs: 100 }).decide({ task: "wait" }),
          (error: unknown) =>
            error instanceof RouterError &&
            error.reason === "backend_unavailable",
        );
      },
    );
  });

  it("refuses redirects so task text is not sent to another endpoint", async () => {
    let redirected = false;
    await withMockServer(
      (request, response) => {
        if (request.url === "/redirected") {
          redirected = true;
          sendJson(response, 200, responseBody());
          return;
        }
        response.statusCode = 307;
        response.setHeader("location", "/redirected");
        response.end();
      },
      async (url) => {
        await assert.rejects(
          new OllayaBackend({ url, timeoutMs: 500 }).decide({
            task: "private task",
          }),
          (error: unknown) =>
            error instanceof RouterError &&
            error.reason === "backend_unavailable",
        );
      },
    );
    assert.equal(redirected, false);
  });

  it("rejects an oversized response before buffering it all", async () => {
    await withMockServer(
      (_request, response) => {
        response.statusCode = 200;
        response.write("x".repeat(1024 * 1024 + 1));
        response.end();
      },
      async (url) => {
        await assert.rejects(
          new OllayaBackend({ url, timeoutMs: 500 }).decide({
            task: "small task",
          }),
          (error: unknown) =>
            error instanceof RouterError &&
            error.reason === "malformed_response",
        );
      },
    );
  });

  it("rejects malformed JSON, missing answers, unknown choices, and bad distributions", async () => {
    await withMockServer(
      (_request, response) => {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end("not-json");
      },
      async (url) => {
        await assert.rejects(
          new OllayaBackend({ url, timeoutMs: 100 }).decide({ task: "wait" }),
          (error: unknown) =>
            error instanceof RouterError &&
            error.reason === "malformed_response",
        );
      },
    );

    const invalidResponses: Array<{ body: unknown; reason: string }> = [
      { body: responseBody({ answers: {} }), reason: "malformed_response" },
      {
        body: responseBody({
          answers: { reasoning_effort: { choice: "none", probabilities: {} } },
        }),
        reason: "malformed_response",
      },
      {
        body: responseBody({
          answers: {
            reasoning_effort: {
              choice: "high",
              probabilities: { low: 0.2, medium: 0.2, high: 0.2, xhigh: 0.2 },
            },
          },
        }),
        reason: "invalid_probabilities",
      },
    ];
    for (const { body, reason } of invalidResponses) {
      await withMockServer(
        (_request, response) => {
          sendJson(response, 200, body);
        },
        async (url) => {
          await assert.rejects(
            new OllayaBackend({ url, timeoutMs: 100 }).decide({ task: "wait" }),
            (error: unknown) =>
              error instanceof RouterError && error.reason === reason,
          );
        },
      );
    }
  });
});

describe("adapter option validation matches CLI safety limits", () => {
  for (const options of [
    { timeoutMs: 2 ** 31 },
    { timeoutMs: 0.5 },
    { url: "http://user:password@localhost/decide" },
    { model: "kev\nunsafe" },
  ]) {
    it(`rejects ${Object.keys(options)[0]}`, () => {
      assert.throws(
        () => new OllayaBackend(options),
        (error: unknown) =>
          error instanceof RouterError &&
          error.reason === "invalid_configuration",
      );
    });
  }
});

describe("response field validation", () => {
  for (const probabilities of [
    { low: 1, medium: 0, high: 0 },
    { low: "1", medium: 0, high: 0, xhigh: 0 },
    { low: null, medium: 0, high: 0, xhigh: 0 },
    { low: 1.1, medium: 0, high: 0, xhigh: 0 },
    { low: NaN, medium: 0, high: 0, xhigh: 0 },
  ]) {
    it(`rejects invalid distribution ${JSON.stringify(probabilities)}`, () => {
      assert.throws(
        () =>
          parseOllayaResponse(
            { answers: { reasoning_effort: { choice: "low", probabilities } } },
            1,
            "kev",
          ),
        (error: unknown) =>
          error instanceof RouterError &&
          error.reason === "invalid_probabilities",
      );
    });
  }
  it("accepts absent optional confidence and duration, rejects invalid metadata", () => {
    const body = {
      answers: {
        reasoning_effort: {
          choice: "low",
          probabilities: { low: 1, medium: 0, high: 0, xhigh: 0 },
        },
      },
    };
    const parsed = parseOllayaResponse(body, 42, "kev");
    assert.equal(parsed.confidence, undefined);
    assert.equal(parsed.latencyMs, 42);
    for (const confidence of [-1, 1.01, NaN, "0.8", null]) {
      assert.throws(() =>
        parseOllayaResponse(
          {
            answers: {
              reasoning_effort: {
                ...body.answers.reasoning_effort,
                confidence,
              },
            },
          },
          42,
          "kev",
        ),
      );
    }
    assert.throws(() =>
      parseOllayaResponse({ ...body, total_duration: -1 }, 42, "kev"),
    );
  });
});

describe("truncated input", () => {
  it("falls back instead of trusting an incomplete task", () => {
    assert.throws(
      () =>
        parseOllayaResponse(
          { ...responseBody(), state_truncated: true },
          1,
          "kev",
        ),
      (error: unknown) =>
        error instanceof RouterError && error.reason === "input_truncated",
    );
  });
  it("validates optional truncation metadata", () => {
    for (const state_truncated of ["false", 1, null]) {
      assert.throws(() =>
        parseOllayaResponse({ ...responseBody(), state_truncated }, 1, "kev"),
      );
    }
    assert.equal(
      parseOllayaResponse(
        { ...responseBody(), state_truncated: false },
        1,
        "kev",
      ).choice,
      "high",
    );
  });
});
