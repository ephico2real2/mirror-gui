# Catalog Data Pipeline

Mirror-GUI uses pre-fetched operator catalog metadata rather than querying registries at runtime. This enables offline browsing and avoids rate-limiting or authentication issues during catalog exploration.

## How it works

1. `sync-catalogs.sh` extracts File-Based Catalog (FBC) data from Red Hat operator index images for each supported OCP version (4.16–4.22) and catalog type (Red Hat, Certified, Community).

2. The script parses FBC YAML to produce structured JSON files per catalog: `operators.json` (operator names, channels, versions, default channels), `dependencies.json` (package dependencies of each default channel head, kept for older data), `dependency-graph.json` (see below), and `catalog-info.json` (catalog metadata with digest and sync timestamp).

3. A top-level `catalog-index.json` registers all processed catalogs with their URLs, types, versions, and digests.

4. The server loads this data lazily on first API request and caches it in memory for the lifetime of the process. A runtime sync (triggered from the UI) writes fresh data to a separate runtime directory that takes precedence over the built-in data.

## Catalog sync diffing

When a catalog sync completes, the server computes a diff between the previous and new catalog data. This diff identifies:
- New operators added to a catalog
- Operators removed from a catalog
- Operators with new versions available

The diff is exposed via the sync status API and displayed in the UI, so users can see what changed without comparing raw JSON.

## Dependency graph

`dependency-graph.json` records, for every package and **every channel**, the requirements of that
channel's head bundle (its newest version):

- `olm.package.required` entries become dependencies with `reason: "package"` and their `versionRange`.
- `olm.gvk.required` entries (a required API) are resolved against the `olm.gvk` APIs that bundles in
  the same catalog provide. An API provided by exactly one other package becomes a dependency with
  `reason: "api"` and the `api` it satisfies. An API the package provides itself is skipped.
- An API provided by several packages, or by none in the catalog (for example one the platform
  itself serves), is listed under `unresolvedApis` with its `candidates`, never guessed.

`GET /api/operators/:operator/dependencies?catalogUrl=...&channel=...` walks this graph from the
requested channel (the default channel when none or an unknown one is given), follows each
dependency through its own default channel, and returns every package with `requiredBy`, the real
`defaultChannel`, and the `unresolvedApis` with the package that needs them. The UI adds the
packages and shows the unresolved APIs as a warning. Catalog data synced before this file existed
falls back to `dependencies.json` (`resolution: "legacy"`).
