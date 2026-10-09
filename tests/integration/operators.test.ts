import { describe, it, expect, beforeAll } from 'vitest';
import { __routeTestHooks } from '../../server/index.js';
import { getTestApp } from './helpers/testApp.js';

describe('Operators API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/operators', () => {
    it('returns operator names from prefetched data', async () => {
      const res = await request.get('/api/operators');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('advanced-cluster-management');
      expect(res.body).toContain('openshift-pipelines-operator-rh');
    });

    it('returns operators for a specific catalog', async () => {
      const res = await request.get('/api/operators').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('advanced-cluster-management');
      expect(res.body).toContain('odf-operator');
    });

    it('returns detailed operators with channels', async () => {
      const res = await request.get('/api/operators').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
        detailed: 'true',
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const acm = res.body.find((op: { name: string }) => op.name === 'advanced-cluster-management');
      expect(acm).toBeDefined();
      expect(acm.defaultChannel).toBe('release-2.16');
      expect(acm.allChannels).toContain('release-2.15');
      expect(acm.allChannels).toContain('release-2.16');
    });

    it('returns 500 when the operators route handler fails (no catalog filter)', async () => {
      __routeTestHooks.failNextOperatorsGet = true;
      const res = await request.get('/api/operators');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(String(res.body.error)).toMatch(/Failed to get operators/i);
    });
  });

  describe('POST /api/operators/refresh-cache', () => {
    it('returns success', async () => {
      const res = await request.post('/api/operators/refresh-cache');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('refreshed');
    });
  });

  describe('GET /api/operators/:operator/versions', () => {
    it('returns versions for a known operator', async () => {
      const res = await request.get('/api/operators/advanced-cluster-management/versions').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('versions');
      expect(res.body.versions).toContain('2.16.0');
    });

    it('returns versions filtered by channel', async () => {
      const res = await request.get('/api/operators/advanced-cluster-management/versions').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
        channel: 'release-2.15',
      });
      expect(res.status).toBe(200);
      expect(res.body.versions).toContain('2.15.0');
      expect(res.body.versions).toContain('2.15.1');
    });

    it('returns 404 for nonexistent operator', async () => {
      const res = await request.get('/api/operators/nonexistent-operator-xyz/versions');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('GET /api/operator-channels/:operator', () => {
    it('returns channels for a known operator', async () => {
      const res = await request.get('/api/operator-channels/advanced-cluster-management');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('channels');
      expect(res.body.channels.length).toBeGreaterThanOrEqual(1);
      expect(res.body).toHaveProperty('name', 'advanced-cluster-management');
      expect(res.body).toHaveProperty('defaultChannel');
      res.body.channels.forEach((ch: { name: string }) => {
        expect(typeof ch.name).toBe('string');
        expect(ch.name.length).toBeGreaterThan(0);
      });
    });

    it('returns 404 for nonexistent operator', async () => {
      const res = await request.get('/api/operator-channels/nonexistent-operator-xyz');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/operators/channels', () => {
    it('returns 400 when catalogUrl and operatorName are missing', async () => {
      const res = await request.get('/api/operators/channels');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 when only catalogUrl is provided', async () => {
      const res = await request.get('/api/operators/channels').query({
        catalogUrl: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when only operatorName is provided', async () => {
      const res = await request.get('/api/operators/channels').query({
        operatorName: 'some-operator',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/operators/:operator/dependencies', () => {
    it('returns dependencies for odf-operator from fixture', async () => {
      const res = await request.get('/api/operators/odf-operator/dependencies').query({
        catalogUrl: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(200);
      expect(res.body.operator).toBe('odf-operator');
      expect(res.body.dependencies.length).toBeGreaterThanOrEqual(1);
      const depNames = res.body.dependencies.map((d: { packageName: string }) => d.packageName);
      expect(depNames).toContain('mcg-operator');
    });

    // The v4.21 Red Hat fixture also carries dependency-graph.json, generated by
    // scripts/catalog_metadata.py from tests/fixtures/fbc-dependency-graph.
    const catalogUrl = 'registry.redhat.io/redhat/redhat-operator-index:v4.21';
    type Dep = { packageName: string; reason: string; api?: string; requiredBy: string; defaultChannel?: string };
    type Unresolved = { api: string; candidates: string[]; requiredBy: string };

    it('follows dependencies of dependencies and resolves required APIs (default channel)', async () => {
      const res = await request.get('/api/operators/alpha/dependencies').query({ catalogUrl });
      expect(res.status).toBe(200);
      expect(res.body.resolution).toBe('graph');
      expect(res.body.channel).toBe('stable');
      const deps = res.body.dependencies as Dep[];
      expect(deps.map((d) => d.packageName).sort()).toEqual(['beta', 'gamma', 'zeta']);
      expect(deps.find((d) => d.packageName === 'beta')).toMatchObject({ reason: 'package', requiredBy: 'alpha', defaultChannel: 'stable-1' });
      expect(deps.find((d) => d.packageName === 'gamma')).toMatchObject({
        reason: 'api',
        api: 'gamma.example.com/v1/Gamma',
        requiredBy: 'alpha',
        defaultChannel: 'tech-preview',
      });
      // zeta is a dependency of gamma, not of alpha
      expect(deps.find((d) => d.packageName === 'zeta')).toMatchObject({ requiredBy: 'gamma' });
      // the older bundle's dependency is not the channel head's
      expect(deps.some((d) => d.packageName === 'old-only')).toBe(false);
    });

    it('reports required APIs it cannot resolve instead of guessing', async () => {
      const res = await request.get('/api/operators/alpha/dependencies').query({ catalogUrl });
      const unresolved = res.body.unresolvedApis as Unresolved[];
      expect(unresolved).toEqual(
        expect.arrayContaining([
          { api: 'monitoring.coreos.com/v1/ServiceMonitor', candidates: [], requiredBy: 'alpha' },
          { api: 'epsilon.example.com/v1/Eps', candidates: ['eps1', 'eps2'], requiredBy: 'beta' },
        ]),
      );
      expect(unresolved).toHaveLength(2);
      // an API the operator provides itself is not a requirement
      expect(unresolved.some((u) => u.api === 'alpha.example.com/v1/Alpha')).toBe(false);
    });

    it('uses the requested channel', async () => {
      const res = await request.get('/api/operators/alpha/dependencies').query({ catalogUrl, channel: 'fast' });
      expect(res.body.channel).toBe('fast');
      expect((res.body.dependencies as Dep[]).map((d) => d.packageName)).toEqual(['delta']);
      expect(res.body.unresolvedApis).toEqual([]);
    });

    it('falls back to the default channel for an unknown channel', async () => {
      const res = await request.get('/api/operators/alpha/dependencies').query({ catalogUrl, channel: 'nope' });
      expect(res.body.channel).toBe('stable');
      expect((res.body.dependencies as Dep[]).map((d) => d.packageName).sort()).toEqual(['beta', 'gamma', 'zeta']);
    });

    it('uses dependencies.json for operators missing from the graph', async () => {
      const res = await request.get('/api/operators/odf-operator/dependencies').query({ catalogUrl });
      expect(res.body.resolution).toBe('legacy');
      expect((res.body.dependencies as Dep[]).map((d) => d.packageName)).toContain('ocs-operator');
    });

    it('returns empty dependencies for unknown operator', async () => {
      const res = await request.get('/api/operators/nonexistent-operator-xyz/dependencies');
      expect(res.status).toBe(200);
      expect(res.body.dependencies).toEqual([]);
      expect(res.body.message).toContain('No dependencies');
    });
  });
});
