export type ConversationVersion = {
  branchId: string;
  requestMessageId: string;
  operation: "new" | "follow_up" | "edit" | "regenerate";
  forkedFromMessageId?: string | null;
};

/** An edit creates a prompt edition; regeneration stays within its exact edition.
 * Never group by text: editing back to the same wording is still a distinct edition. */
export function conversationVersions<T extends ConversationVersion>(versions: T[], selectedBranchId: string) {
  const requests = new Map(versions.map(version => [version.requestMessageId, version]));
  const edition = (version: T) => {
    const visited = new Set<string>();
    while (version.operation === "regenerate" && version.forkedFromMessageId) {
      if (visited.has(version.requestMessageId)) break;
      visited.add(version.requestMessageId);
      const parent = requests.get(version.forkedFromMessageId);
      if (!parent) break;
      version = parent;
    }
    return version.requestMessageId;
  };
  const groups = new Map<string, T[]>();
  for (const version of versions) {
    const id = edition(version);
    groups.set(id, [...(groups.get(id) ?? []), version]);
  }
  const selected = versions.find(version => version.branchId === selectedBranchId);
  const selectedEdition = selected ? edition(selected) : null;
  const prompts = [...groups.entries()].map(([id, answers]) => id === selectedEdition && selected ? selected : answers[answers.length - 1]);
  return { prompts, answers: selectedEdition ? groups.get(selectedEdition) ?? [] : [],
    promptIndex: prompts.findIndex(version => version.branchId === selectedBranchId) };
}
