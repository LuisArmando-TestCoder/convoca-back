// ── Firestore document/collection paths ──────────────────────────────────────
// One source of truth for the data layout. Org-scoped data lives in
// subcollections (so listing is a simple collection read); reverse lookups
// (collaborator→org, link→event) use small top-level index collections.

export const paths = {
  orgsCol: () => "organizations",
  org: (orgId: string) => `organizations/${orgId}`,

  collaboratorsCol: (orgId: string) => `organizations/${orgId}/collaborators`,
  collaborator: (orgId: string, collabKey: string) =>
    `organizations/${orgId}/collaborators/${collabKey}`,
  collaboratorIndexCol: () => "collaborator_index",
  collaboratorIndex: (collabKey: string) => `collaborator_index/${collabKey}`,

  otpCol: () => "otp",
  otp: (emailKey: string) => `otp/${emailKey}`,

  eventsCol: (orgId: string) => `organizations/${orgId}/events`,
  event: (orgId: string, eventId: string) => `organizations/${orgId}/events/${eventId}`,

  participantsCol: (orgId: string, eventId: string) =>
    `organizations/${orgId}/events/${eventId}/participants`,
  participant: (orgId: string, eventId: string, hash: string) =>
    `organizations/${orgId}/events/${eventId}/participants/${hash}`,

  linksCol: () => "links",
  link: (linkId: string) => `links/${linkId}`,
  linkIndexCol: (orgId: string, eventId: string) =>
    `organizations/${orgId}/events/${eventId}/link_ids`,
  linkIndex: (orgId: string, eventId: string, linkId: string) =>
    `organizations/${orgId}/events/${eventId}/link_ids/${linkId}`,
};
