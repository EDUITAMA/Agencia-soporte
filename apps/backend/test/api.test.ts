import assert from "node:assert/strict";
import test from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";

const app = createApp({
  productName: "Test Product",
  version: "0.1.0-test",
  corsOrigin: "http://localhost:4200",
});

test("GET /api/health returns service health", async () => {
  const response = await request(app).get("/api/health");

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.service, "Test Product");
  assert.ok(response.body.timestamp);
});

test("unknown routes return the standard 404 response", async () => {
  const response = await request(app).get("/api/missing");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    status: "error",
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
});
