import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { organizationAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// Team / Members / Domains data for the workspace settings → Team page. Org
// scoping travels in the X-Organization-Id header (api.js interceptor), so the
// query keys are org-implicit; switching workspaces invalidates everything.

const MEMBERS_KEY = ['organization-members'];
const JOIN_REQUESTS_KEY = ['organization-join-requests'];
const DOMAINS_KEY = ['organization-domains'];

const errMessage = (err, fallback) => err?.response?.data?.message || fallback;

// ── Members ──────────────────────────────────────────────────────────────────
// The roster read is open to ANY workspace member (roster transparency — see
// organization.routes.js); only writes are admin-gated. `enabled` lets
// surfaces defer the fetch until they actually need the roster (e.g. a form
// opening), and `staleTime` lets them tolerate a slightly stale roster rather
// than refetch on every mount. This hook is the ONLY owner of the
// ['organization-members'] cache key — a second writer with a different
// queryFn shape once coexisted in ActivityTab and made the cached value
// shape-dependent on visit order.
export function useOrganizationMembers(enabled = true, { staleTime } = {}) {
  return useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: () => organizationAPI.listMembers().then((r) => r.data.data.members),
    enabled,
    ...(staleTime != null ? { staleTime } : {}),
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }) => organizationAPI.invite(email, role).then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: MEMBERS_KEY });
      // Existing REDIP users are added to the workspace immediately; new emails
      // get an invitation link consumed when they sign up.
      toast.success(data?.kind === 'added' ? 'Teammate added to the workspace' : 'Invitation sent');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not send the invitation')),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }) =>
      organizationAPI.updateMemberRole(userId, role).then((r) => r.data.data.member),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MEMBERS_KEY });
      toast.success('Role updated');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not update the role')),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId) => organizationAPI.removeMember(userId).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MEMBERS_KEY });
      toast.success('Member removed');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not remove the member')),
  });
}

// ── Pending join requests ────────────────────────────────────────────────────
export function useJoinRequests(enabled = true) {
  return useQuery({
    queryKey: JOIN_REQUESTS_KEY,
    queryFn: () => organizationAPI.listJoinRequests().then((r) => r.data.data.requests),
    enabled,
  });
}

export function useApproveJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId) => organizationAPI.approveJoinRequest(userId).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JOIN_REQUESTS_KEY });
      qc.invalidateQueries({ queryKey: MEMBERS_KEY });
      toast.success('Request approved');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not approve the request')),
  });
}

export function useRejectJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId) => organizationAPI.rejectJoinRequest(userId).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JOIN_REQUESTS_KEY });
      toast.success('Request declined');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not decline the request')),
  });
}

// ── Domains ──────────────────────────────────────────────────────────────────
export function useOrganizationDomains() {
  return useQuery({
    queryKey: DOMAINS_KEY,
    queryFn: () => organizationAPI.listDomains().then((r) => r.data.data.domains),
  });
}

export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain) => organizationAPI.addDomain(domain).then((r) => r.data.data.domain),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOMAINS_KEY });
      toast.success('Domain added — add the DNS record, then verify');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not add the domain')),
  });
}

export function useVerifyDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domainId) => organizationAPI.verifyDomain(domainId).then((r) => r.data.data.domain),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOMAINS_KEY });
      toast.success('Domain verified — teammates can now auto-join');
    },
    // The "not propagated yet" 422 is an expected state, not a hard failure;
    // surface the backend's guidance verbatim.
    onError: (err) => toast.error(errMessage(err, 'Could not verify the domain yet')),
  });
}

export function useSetDomainPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domainId, policy }) =>
      organizationAPI.setDomainPolicy(domainId, policy).then((r) => r.data.data.domain),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOMAINS_KEY });
      toast.success('Join policy updated');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not update the policy')),
  });
}

export function useRemoveDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domainId) => organizationAPI.removeDomain(domainId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOMAINS_KEY });
      toast.success('Domain removed');
    },
    onError: (err) => toast.error(errMessage(err, 'Could not remove the domain')),
  });
}
