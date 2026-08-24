import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  apiScan,
  gatewayHealth,
  latestRun,
  readReportBugFile,
  repoRelativePath,
  runRepoGates,
  safeUrl,
  writeRunArtifact
} from './lib.mjs';

function textResult(value, { structured = value, error = false } = {}) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    structuredContent: structured,
    ...(error ? { isError: true } : {})
  };
}

function schema(document) { return fromJsonSchema(document); }

function createServer() {
  const server = new McpServer({
    name: 'webqa-local',
    title: 'Web QA Assistant local development tools',
    version: '1.0.0'
  });

  server.registerTool('webqa_health', {
    title: 'Check WebQA health',
    description: 'Check the configured Web QA Assistant gateway health and version.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schema({ type: 'object', additionalProperties: false, properties: {} })
  }, async () => {
    try {
      const health = await gatewayHealth();
      return textResult(health);
    } catch (error) {
      return textResult({ ok: false, error: String(error?.message || error) }, { error: true });
    }
  });

  server.registerTool('webqa_scan_url', {
    title: 'Scan a public site with WebQA',
    description: 'Run the deployed Web QA Assistant deterministic/public scan for a public URL, return a cross-discipline summary, and save a local QA artifact. Use this before making claims about a real site.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: schema({
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Public HTTP or HTTPS URL to scan.' },
        maxFindings: { type: 'integer', minimum: 1, maximum: 30, default: 12 }
      },
      required: ['url']
    })
  }, async ({ url, maxFindings = 12 }) => {
    try {
      const result = await apiScan(url, { maxFindings });
      const artifact = await writeRunArtifact('api-scan', {
        kind: 'api-scan',
        createdAt: new Date().toISOString(),
        requestedUrl: safeUrl(url),
        ...result
      });
      return textResult({ ...result, artifact: repoRelativePath(artifact) });
    } catch (error) {
      return textResult({ ok: false, url: safeUrl(url), error: String(error?.message || error) }, { error: true });
    }
  });

  server.registerTool('webqa_repo_gates', {
    title: 'Run WebQA repository gates',
    description: 'Run npm test, static checks, extension build, and optionally release validation in the current Web QA Assistant repository.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: schema({
      type: 'object',
      additionalProperties: false,
      properties: {
        releaseTag: { type: 'string', description: 'Optional release tag such as v1.7.1.' },
        includeBuild: { type: 'boolean', default: true }
      }
    })
  }, async ({ releaseTag = '', includeBuild = true }) => {
    const result = await runRepoGates({ releaseTag, includeBuild });
    const artifact = await writeRunArtifact('repo-gates', { kind: 'repo-gates', createdAt: new Date().toISOString(), ...result });
    return textResult({ ...result, artifact: repoRelativePath(artifact) }, { error: !result.ok });
  });

  server.registerTool('webqa_latest_run', {
    title: 'Read latest WebQA QA artifact',
    description: 'Return the newest local JSON artifact from qa-runs. Useful for review handoffs and release-gate evidence.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: schema({ type: 'object', additionalProperties: false, properties: {} })
  }, async () => {
    try {
      const latest = await latestRun();
      return textResult(latest || { found: false, message: 'No local QA run artifacts exist yet.' });
    } catch (error) {
      return textResult({ found: false, error: String(error?.message || error) }, { error: true });
    }
  });

  server.registerTool('webqa_read_report_bug', {
    title: 'Read a local Report Bug artifact',
    description: 'Read a Web QA Assistant Report Bug JSON file from within this repository workspace for runtime diagnosis. Only use a file the user intentionally exported.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: schema({
      type: 'object',
      additionalProperties: false,
      properties: { file: { type: 'string', description: 'Path to a Report Bug JSON file under the repository workspace.' } },
      required: ['file']
    })
  }, async ({ file }) => {
    try {
      return textResult(await readReportBugFile(file));
    } catch (error) {
      return textResult({ ok: false, error: String(error?.message || error) }, { error: true });
    }
  });

  return server;
}

void serveStdio(createServer);
console.error('WebQA Cursor MCP server running on stdio');
