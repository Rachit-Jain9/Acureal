// GettingStarted — REDIP's first-run panel.
//
// Rendered on the Dashboard while a workspace still has zero deals (see
// DashboardPage). It stands in for the grid of empty widgets with a calm,
// role-aware set of first moves. Every destination is a real, shipped
// page, so the panel never implies a workflow that isn't there. It is
// dismissible, and disappears on its own the moment the first deal exists.

import { Link } from 'react-router-dom';
import {
  Briefcase, LineChart, Building2, Settings2, Sparkles, ArrowRight,
} from 'lucide-react';
import { Card, Button } from '../../design-system';
import { roleSatisfies } from '../../utils/roles';

// Role-aware first moves. `editor` and above can create deals; `viewer`
// gets a read-first framing. `admin`/`owner` also get a workspace-setup step.
function buildSteps(role) {
  const canCreate = roleSatisfies(role, ['editor']);
  const isAdmin = roleSatisfies(role, ['admin']);

  const steps = [
    canCreate
      ? {
          icon: Briefcase,
          title: 'Create your first deal',
          body: 'Start with whatever you have — even a rough label like "Whitefield opportunity". REDIP is built for messy, early-stage sourcing data.',
          // ?new=1 deep-links into the Deals page and auto-opens the
          // create-deal modal (the same trigger the Cmd-K palette uses)
          // so the first click on the welcome panel lands the user on
          // the form they're about to fill out, not the empty deals list.
          to: '/dashboard/deals?new=1',
          cta: 'New deal',
        }
      : {
          icon: Briefcase,
          title: 'Explore the deal pipeline',
          body: 'See how live deals move from sourcing through diligence to an IC decision.',
          to: '/dashboard/deals',
          cta: 'Open deals',
        },
    {
      icon: LineChart,
      title: 'Scan Market Intelligence',
      body: 'City-level benchmarks and market trends — Bengaluru first, India second.',
      to: '/dashboard/intelligence',
      cta: 'Open',
    },
    {
      icon: Building2,
      title: 'Review the comps database',
      body: 'Verified transaction comparables — every record carries its source and last-verified date.',
      to: '/dashboard/comps',
      cta: 'Open',
    },
  ];

  if (isAdmin) {
    steps.push({
      icon: Settings2,
      title: 'Set up your workspace',
      body: 'Your profile, security, and workspace preferences.',
      to: '/dashboard/settings',
      cta: 'Open',
    });
  }

  return steps;
}

export default function GettingStarted({ userName, role, onDismiss }) {
  const steps = buildSteps(role);
  const firstName = String(userName || '').trim().split(/\s+/)[0];
  const greeting = `Welcome to REDIP${firstName ? `, ${firstName}` : ''}.`;

  return (
    <Card elevated className="p-6 sm:p-7">
      <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-accent">
        <Sparkles size={13} aria-hidden="true" />
        Getting started
      </div>
      <h2 className="mt-2 text-xl font-semibold text-content-primary">{greeting}</h2>
      <p className="mt-1.5 max-w-xl text-sm text-content-secondary">
        Your workspace is ready. Here are a few good first moves — the dashboard
        fills itself in with live pipeline, risk, and IRR data as you work.
      </p>

      <ol className="mt-6 space-y-3">
        {steps.map((step, i) => (
          <li
            key={step.to}
            className="flex items-start gap-3 rounded-lg border border-hairline-soft bg-bg-secondary p-4 sm:gap-4"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hairline-soft bg-bg-elevated text-accent">
              <step.icon size={17} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-content-primary">{step.title}</p>
              <p className="mt-0.5 text-sm text-content-secondary">{step.body}</p>
            </div>
            <Button
              as={Link}
              to={step.to}
              variant={i === 0 ? 'primary' : 'secondary'}
              size="sm"
              rightIcon={<ArrowRight size={13} />}
              className="mt-0.5 shrink-0"
            >
              {step.cta}
            </Button>
          </li>
        ))}
      </ol>

      <div className="mt-5">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded text-xs font-medium text-content-muted transition-colors duration-150 ease-out hover:text-content-secondary active:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Skip for now — go straight to the dashboard
        </button>
      </div>
    </Card>
  );
}
