// One decision for the team page: a Toast badge and the "X of Y linked" header
// both use isLinked on the same roster. Y is the active people on that roster.
// X is how many of those active rows get a badge. A mapping for someone who is
// not on the roster does not count and does not badge. An inactive person can
// still be linked, but they are outside this active header.

export type ToastRosterUser = { id: string; is_active: boolean };

export type ToastLinkView = {
  isLinked: (userId: string) => boolean;
  linkedCount: number;
  activeCount: number;
  statusText: string;
};

export function toastLinkView(users: ToastRosterUser[], linkedUserIds: Iterable<string>): ToastLinkView {
  const rosterIds = new Set(users.map((user) => user.id));
  const linkedIds = new Set([...linkedUserIds].filter((id) => rosterIds.has(id)));
  const active = users.filter((user) => user.is_active);
  const linkedCount = active.filter((user) => linkedIds.has(user.id)).length;
  return {
    isLinked: (userId: string) => linkedIds.has(userId),
    linkedCount,
    activeCount: active.length,
    statusText: `${linkedCount} of ${active.length} linked to Toast`,
  };
}
