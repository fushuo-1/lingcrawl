// Stub: billing removed in self-hosted trim
export function resolveBillingMetadata(params: any): any {
  return {
    endpoint: params.billing?.endpoint ?? "unknown",
    jobId: params.billing?.jobId ?? params.crawlId ?? "unknown",
  };
}
