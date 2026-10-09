/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { execFile } from 'child_process';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), 'scripts', 'catalog_metadata.py');
const fbcDir = path.join(process.cwd(), 'tests', 'fixtures', 'fbc-dependency-graph');
const committedGraph = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'catalog-data',
  'redhat-operator-index',
  'v4.21',
  'dependency-graph.json',
);

async function generate() {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'catalog-metadata-graph-'));
  await execFileAsync('python3', [
    scriptPath,
    'generate',
    '--catalog-dir',
    fbcDir,
    '--catalog-type',
    'redhat-operator-index',
    '--ocp-version',
    'v4.21',
    '--operators-file',
    path.join(outDir, 'operators.json'),
    '--dependencies-file',
    path.join(outDir, 'dependencies.json'),
  ]);
  const read = async (name: string) => JSON.parse(await readFile(path.join(outDir, name), 'utf8'));
  return {
    operators: await read('operators.json'),
    dependencies: await read('dependencies.json'),
    graph: await read('dependency-graph.json'),
  };
}

describe('catalog_metadata.py dependency graph', () => {
  it('records per-channel dependencies of each channel head', async () => {
    const { graph } = await generate();
    expect(graph.alpha.defaultChannel).toBe('stable');
    expect(graph.alpha.channels.stable.headVersion).toBe('2.0.0');
    expect(graph.alpha.channels.fast.dependencies).toEqual([
      { packageName: 'delta', versionRange: '>=0.0.0', reason: 'package' },
    ]);
  });

  it('resolves a required API provided by exactly one package', async () => {
    const { graph } = await generate();
    expect(graph.alpha.channels.stable.dependencies).toContainEqual({
      packageName: 'gamma',
      versionRange: null,
      reason: 'api',
      api: 'gamma.example.com/v1/Gamma',
    });
  });

  it('lists ambiguous, unprovided and self-provided APIs correctly', async () => {
    const { graph } = await generate();
    expect(graph.beta.channels['stable-1'].unresolvedApis).toEqual([
      { api: 'epsilon.example.com/v1/Eps', candidates: ['eps1', 'eps2'] },
    ]);
    expect(graph.alpha.channels.stable.unresolvedApis).toEqual([
      { api: 'monitoring.coreos.com/v1/ServiceMonitor', candidates: [] },
    ]);
  });

  it('keeps operators.json and dependencies.json unchanged in shape', async () => {
    const { operators, dependencies } = await generate();
    expect(operators.every((op: Record<string, unknown>) => !('_graph' in op))).toBe(true);
    // dependencies.json still holds only olm.package.required of the default channel head
    expect(dependencies).toEqual({
      alpha: [{ packageName: 'beta', versionRange: '>=1.0.0' }],
      gamma: [{ packageName: 'zeta', versionRange: '>=0.0.0' }],
    });
  });

  it('matches the committed server test fixture', async () => {
    const { graph } = await generate();
    expect(graph).toEqual(JSON.parse(await readFile(committedGraph, 'utf8')));
  });
});
