// Stub: job priority simplified for self-hosted mode
export async function getJobPriority(params: {
  team_id: string;
  basePriority: number;
}): Promise<number> {
  return params.basePriority;
}

export async function addJobPriority(teamId: string, jobId: string) {
  // No-op
}

export async function deleteJobPriority(teamId: string, jobId: string) {
  // No-op
}
