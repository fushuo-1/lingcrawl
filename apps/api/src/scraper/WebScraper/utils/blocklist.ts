import { configDotenv } from "dotenv";
import { parse } from "tldts";
import { TeamFlags } from "../../../controllers/types-shared";

configDotenv();

type BlocklistBlob = {
  blocklist: string[];
  allowedKeywords: string[];
};

// Empty blocklist for self-hosted mode
const blob: BlocklistBlob = {
  blocklist: [],
  allowedKeywords: [],
};

export async function initializeBlocklist() {
  // No-op: blocklist is empty in self-hosted mode
}

export function isUrlBlocked(url: string, flags: TeamFlags): boolean {
  const lowerCaseUrl = url.trim().toLowerCase();

  let blockedlist = [...blob.blocklist];

  if (flags?.unblockedDomains) {
    blockedlist = blockedlist.filter(
      blocked => !flags.unblockedDomains!.includes(blocked),
    );
  }

  if (blockedlist.length === 0) {
    return false;
  }

  let parsedUrl: any;
  try {
    parsedUrl = parse(lowerCaseUrl);
  } catch {
    return false;
  }

  const domain = parsedUrl.domain;
  if (!domain) {
    return false;
  }

  if (
    blob.allowedKeywords.some(keyword =>
      lowerCaseUrl.includes(keyword.toLowerCase()),
    )
  ) {
    return false;
  }

  if (blockedlist.includes(domain)) {
    return true;
  }

  if (blockedlist.some(blocked => domain.endsWith(`.${blocked}`))) {
    return true;
  }

  return false;
}
