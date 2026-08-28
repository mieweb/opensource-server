function serializeUsageReport(report) {
  return {
    generatedAt: report.generatedAt.toISOString(),
    owners: report.owners,
    capacity: report.capacity,
    findings: report.findings,
    unknownNodeRows: report.unknownNodeRows,
  };
}

module.exports = { serializeUsageReport };
