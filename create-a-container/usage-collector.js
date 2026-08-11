#!/usr/bin/env node
/**
 * usage-collector.js — per-container resource metrics via OpenTelemetry
 * (issue #440).
 *
 * On every export cycle (5 minutes by default) it issues ONE Proxmox
 * `/cluster/resources` call per cluster (nodes sharing a cluster are
 * deduplicated by the node names present in each response — never one call
 * per container), attributes each LXC to an owner via its Proxmox tag
 * (cross-checked against Container.username; divergence is logged as
 * attribution drift), and emits OTLP metrics with `owner`, `container.id`,
 * `container.name`, `proxmox.node`, and `site.id` attributes — so any OTel
 * backend can group per-owner (e.g. PromQL `sum by (owner)`).
 *
 * Metrics (OTel semantic conventions where they exist):
 *   container.cpu.usage / container.cpu.limit        gauge   {cpu}  cores
 *   container.memory.usage / container.memory.limit  gauge   By
 *   container.disk.usage / container.disk.limit      gauge   By
 *   container.disk.io     counter By  (attr disk.io.direction: read|write)
 *   container.network.io  counter By  (attr network.io.direction: receive|transmit)
 *   container.uptime      gauge   s
 *
 * The counters are cumulative since container boot as reported by Proxmox; a
 * decrease (container reboot) is a normal counter reset for the backend.
 *
 * Export target comes from the standard OTLP environment variables
 * (OTEL_EXPORTER_OTLP_ENDPOINT et al., http/protobuf). Without an endpoint
 * configured the collector logs that it is disabled and exits — the service
 * is a no-op until an OTel collector exists to receive the data.
 *
 * The same sampling cycle backs the live report endpoint
 * (/api/v1/sites/:siteId/usage) via the shared utils/usage-collection.js.
 */

const { collectUsage } = require('./utils/usage-collection');

const EXPORT_INTERVAL_MS = parseInt(process.env.USAGE_COLLECTOR_INTERVAL_MS || '300000', 10);

/**
 * Run one collection cycle, logging attribution findings and the summary.
 * @returns {Promise<Array<object>>} Normalized samples (see utils/usage-sample.js)
 */
async function collectSamples() {
  const { samples, findings, unknownNodeRows } = await collectUsage();

  for (const finding of findings) {
    if (finding.kind === 'drift') {
      console.warn(
        `UsageCollector: attribution drift on CT ${finding.vmid}: ` +
        `Proxmox tag '${finding.tagOwner}' != Container.username '${finding.dbOwner}'`
      );
    } else {
      console.warn(`UsageCollector: CT ${finding.vmid} has no owner (no tag, not in DB)`);
    }
  }

  const driftCount = findings.filter((f) => f.kind === 'drift').length;
  console.log(
    `UsageCollector: observed ${samples.length} containers ` +
    `(${driftCount} drift, ${findings.length - driftCount} unattributed` +
    `${unknownNodeRows ? `, ${unknownNodeRows} on unregistered nodes` : ''})`
  );

  return samples;
}

/**
 * OTel attribute set identifying one container series.
 * @param {object} sample - Normalized sample from utils/usage-sample.js
 * @returns {object}
 */
function sampleAttributes(sample) {
  const attributes = {
    'container.id': sample.vmid,
    'site.id': String(sample.siteId),
    'proxmox.node': sample.node,
  };
  if (sample.owner) attributes.owner = sample.owner;
  if (sample.name) attributes['container.name'] = sample.name;
  if (sample.status) attributes['container.status'] = sample.status;
  return attributes;
}

/**
 * Register the meter provider, instruments, and the batch observable callback
 * that drives collection once per export interval.
 * @returns {import('@opentelemetry/sdk-metrics').MeterProvider}
 */
function setupMetrics() {
  const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
  const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
  const { resourceFromAttributes } = require('@opentelemetry/resources');

  // Surface export failures (endpoint down, auth, ...) on the console. The
  // standard OTEL_LOG_LEVEL variable raises verbosity for debugging.
  const diagLevel = DiagLogLevel[(process.env.OTEL_LOG_LEVEL || 'WARN').toUpperCase()] ?? DiagLogLevel.WARN;
  diag.setLogger(new DiagConsoleLogger(), diagLevel);

  const meterProvider = new MeterProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || 'usage-collector',
    }),
    readers: [
      new PeriodicExportingMetricReader({
        // Endpoint/headers/protocol come from the standard OTEL_EXPORTER_OTLP_*
        // environment variables.
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: EXPORT_INTERVAL_MS,
      }),
    ],
  });

  const meter = meterProvider.getMeter('usage-collector');

  const cpuUsage = meter.createObservableGauge('container.cpu.usage', { unit: '{cpu}', description: 'CPU cores in use' });
  const cpuLimit = meter.createObservableGauge('container.cpu.limit', { unit: '{cpu}', description: 'CPU cores allocated' });
  const memUsage = meter.createObservableGauge('container.memory.usage', { unit: 'By', description: 'Memory in use' });
  const memLimit = meter.createObservableGauge('container.memory.limit', { unit: 'By', description: 'Memory allocated' });
  const diskUsage = meter.createObservableGauge('container.disk.usage', { unit: 'By', description: 'Root filesystem in use' });
  const diskLimit = meter.createObservableGauge('container.disk.limit', { unit: 'By', description: 'Root filesystem allocated' });
  const diskIo = meter.createObservableCounter('container.disk.io', { unit: 'By', description: 'Disk bytes transferred since container boot' });
  const networkIo = meter.createObservableCounter('container.network.io', { unit: 'By', description: 'Network bytes transferred since container boot' });
  const uptime = meter.createObservableGauge('container.uptime', { unit: 's', description: 'Seconds since container boot' });

  const instruments = [cpuUsage, cpuLimit, memUsage, memLimit, diskUsage, diskLimit, diskIo, networkIo, uptime];

  meter.addBatchObservableCallback(async (result) => {
    let samples;
    try {
      samples = await collectSamples();
    } catch (err) {
      console.error('UsageCollector cycle error:', err);
      return;
    }

    for (const sample of samples) {
      const attributes = sampleAttributes(sample);
      const gauges = [
        [cpuUsage, sample.cpuUsed],
        [cpuLimit, sample.cpuAlloc],
        [memUsage, sample.memUsed],
        [memLimit, sample.memAlloc],
        [diskUsage, sample.diskUsed],
        [diskLimit, sample.diskAlloc],
        [uptime, sample.uptime],
      ];
      for (const [instrument, value] of gauges) {
        if (value != null) result.observe(instrument, value, attributes);
      }
      if (sample.diskReadBytes != null) {
        result.observe(diskIo, sample.diskReadBytes, { ...attributes, 'disk.io.direction': 'read' });
      }
      if (sample.diskWriteBytes != null) {
        result.observe(diskIo, sample.diskWriteBytes, { ...attributes, 'disk.io.direction': 'write' });
      }
      if (sample.netInBytes != null) {
        result.observe(networkIo, sample.netInBytes, { ...attributes, 'network.io.direction': 'receive' });
      }
      if (sample.netOutBytes != null) {
        result.observe(networkIo, sample.netOutBytes, { ...attributes, 'network.io.direction': 'transmit' });
      }
    }
  }, instruments);

  return meterProvider;
}

function otlpConfigured() {
  return !!(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
}

async function start() {
  if (!otlpConfigured()) {
    console.log(
      'UsageCollector: no OTLP endpoint configured (set OTEL_EXPORTER_OTLP_ENDPOINT ' +
      'or OTEL_EXPORTER_OTLP_METRICS_ENDPOINT); exiting.'
    );
    process.exit(0);
  }

  console.log(`UsageCollector starting, export interval ${EXPORT_INTERVAL_MS}ms`);
  const meterProvider = setupMetrics();

  // The SDK's periodic reader unrefs its timer, so it alone does not keep the
  // process alive; hold the event loop open until a signal arrives.
  const keepAlive = setInterval(() => {}, 60 * 1000);

  const shutdown = async (signal) => {
    console.log(`UsageCollector shutting down (${signal})`);
    clearInterval(keepAlive);
    try {
      await meterProvider.shutdown(); // flushes the final export
    } catch (err) {
      console.error('UsageCollector shutdown error:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('UsageCollector failed to start:', err);
  process.exit(1);
});
