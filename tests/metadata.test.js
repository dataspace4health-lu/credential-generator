// Copyright 2025 NTT DATA Luxembourg
// SPDX-License-Identifier: Apache-2.0

import assert from "assert";
import { readFile } from "fs/promises";
import path from "path";
import { test } from "node:test";

const root = path.resolve(".");

const parseJsonFile = async (filePath) => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
};

test("package.json metadata is populated", async () => {
  const pkg = await parseJsonFile(path.join(root, "package.json"));
  assert.strictEqual(pkg.license, "Apache-2.0");
  assert.ok(pkg.description.length > 0, "description should be set");
  assert.ok(pkg.author, "author should be set");
  assert.ok(pkg.repository?.url, "repository url should be set");
  assert.ok(pkg.bugs?.url, "bugs url should be set");
  assert.ok(pkg.homepage, "homepage should be set");
});

test("community files exist", async () => {
  const files = [
    "LICENSE",
    "NOTICE",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "README.md",
  ];

  for (const file of files) {
    await assert.doesNotReject(() => readFile(path.join(root, file)));
  }
});
