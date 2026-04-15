import { useNavigate } from 'react-router-dom';
import {
  Brain,
  FileText,
  TrendingUp,
  CheckSquare,
  Shield,
  BarChart3,
  MapPin,
  Zap,
  ArrowRight,
  Upload,
  Cpu,
  LineChart,
  Download,
  Building2,
  IndianRupee,
  ChevronRight,
} from 'lucide-react';

// ─── Nav ─────────────────────────────────────────────────────────────────────

function Navbar() {
  const navigate = useNavigate();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-gray-950/80 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <span className="text-xl font-extrabold text-primary-600 tracking-tight">REDIP</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/login')}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/login')}
            className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            Get Access
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

const workflowSteps = [
  { icon: Upload, label: 'Upload Documents' },
  { icon: Cpu, label: 'Extract & Classify' },
  { icon: MapPin, label: 'Evaluate Parcel' },
  { icon: LineChart, label: 'Underwrite' },
  { icon: Download, label: 'Investor-Grade Outputs' },
];

function Hero() {
  const navigate = useNavigate();
  return (
    <section className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-[#0d1b4b] flex flex-col justify-center pt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 md:py-32">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-primary-600/10 border border-primary-600/30 text-primary-400 text-xs font-semibold tracking-widest uppercase px-4 py-1.5 rounded-full mb-8">
          AI-Native · India First · Bengaluru/GBA Priority
        </div>

        {/* H1 */}
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-white leading-tight tracking-tight max-w-4xl mb-6">
          Deal Intelligence
          <span className="block text-primary-500">&amp; Underwriting</span>
        </h1>

        {/* Subheading */}
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mb-10 leading-relaxed">
          AI-powered due diligence, zoning evaluation, financial modelling, and investor reporting
          for India's land and real estate market.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap gap-4 mb-20">
          <button
            onClick={() => navigate('/login')}
            className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-primary-900/40"
          >
            Start a Deal <ArrowRight size={16} />
          </button>
          <button
            onClick={() => {
              document.getElementById('what-it-solves')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex items-center gap-2 px-6 py-3 border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Learn More <ChevronRight size={16} />
          </button>
        </div>

        {/* Workflow strip */}
        <div className="flex flex-wrap items-center gap-0">
          {workflowSteps.map((step, idx) => (
            <div key={step.label} className="flex items-center">
              <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-2.5">
                <step.icon size={15} className="text-primary-400 flex-shrink-0" />
                <span className="text-xs font-medium text-gray-300 whitespace-nowrap">
                  {step.label}
                </span>
              </div>
              {idx < workflowSteps.length - 1 && (
                <ArrowRight size={14} className="text-gray-600 mx-1 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── What It Solves ───────────────────────────────────────────────────────────

const problems = [
  {
    problem: 'Fragmented evidence',
    solution: 'All documents, DD items, and approvals organised inside each deal',
    icon: FileText,
  },
  {
    problem: 'Manual underwriting',
    solution: 'Structured financial engine across 10 asset classes and all deal structures',
    icon: LineChart,
  },
  {
    problem: 'Opaque next steps',
    solution: 'Deterministic deal readiness scoring with actionable next steps',
    icon: CheckSquare,
  },
  {
    problem: 'Unreliable comps',
    solution: 'Confidence-weighted market intelligence from verified sources',
    icon: BarChart3,
  },
  {
    problem: 'Slow due diligence',
    solution: 'AI-powered extraction from title deeds, EC, RTC, and JDA documents — including Kannada-language records',
    icon: Zap,
  },
  {
    problem: 'Investor-Grade prep delays',
    solution: 'One-click investor-grade reports, PDFs, and Excel models',
    icon: Download,
  },
];

function WhatItSolves() {
  return (
    <section id="what-it-solves" className="bg-white py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            Built for Real Deal Work
          </h2>
          <p className="text-gray-500 text-lg">
            Each feature maps to a friction point that slows India-market deal teams.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {problems.map(({ problem, solution, icon: Icon }) => (
            <div
              key={problem}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                  <Icon size={18} className="text-primary-600" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-1">
                    {problem}
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{solution}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Product Workflow ─────────────────────────────────────────────────────────

const workflowPhases = [
  {
    number: '01',
    title: 'Ingest Deal & Site',
    description:
      'Upload property details, parcel data, and linked documents in minutes. Unknown parcel names and partial addresses are supported from day one.',
  },
  {
    number: '02',
    title: 'Extract & Evaluate',
    description:
      'AI classifies, extracts, and structures evidence from Indian land documents including Kannada-language records, EC transactions, and RTC fields.',
  },
  {
    number: '03',
    title: 'Underwrite',
    description:
      'Deterministic financial engine models land, residential, commercial, plotted, JDA, JV, and hybrid structures with 15-year quarterly horizons.',
  },
  {
    number: '04',
    title: 'Generate Outputs',
    description:
      'Investor-grade memos, financial models, DD summaries, risk reports, and export packages — ready for investor review without manual reformatting.',
  },
];

function ProductWorkflow() {
  return (
    <section className="bg-gray-50 py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            From Source to Investor-Grade Decisions in One Platform
          </h2>
          <p className="text-gray-500 text-lg">
            A single deal workspace replaces fragmented spreadsheets, shared drives, and email
            threads.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {workflowPhases.map((phase, idx) => (
            <div key={phase.number} className="relative">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full">
                <div className="text-4xl font-black text-primary-100 mb-3 leading-none">
                  {phase.number}
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-2">{phase.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{phase.description}</p>
              </div>
              {idx < workflowPhases.length - 1 && (
                <div className="hidden lg:flex absolute top-1/2 -right-3 -translate-y-1/2 z-10 w-6 h-6 items-center justify-center bg-gray-100 rounded-full border border-gray-200">
                  <ArrowRight size={12} className="text-gray-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── AI Capabilities ──────────────────────────────────────────────────────────

const documentIntelligenceItems = [
  'Document classification and categorisation',
  'PDF and image content extraction',
  'Kannada to English translation',
  'EC transaction parsing',
  'RTC/Pahani field extraction',
  'JDA/JV clause extraction',
];

const dealReasoningItems = [
  'DD synthesis and missing-item detection',
  'Risk narrative generation',
  'Next-step recommendations',
  'Investor-grade memo drafting',
  'Market and comps synthesis',
  'Financing structure guidance',
];

function AICapabilities() {
  return (
    <section className="bg-white py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            AI Routed by Task, Not by Guesswork
          </h2>
          <p className="text-gray-500 text-lg">
            Each AI capability is applied only where it materially improves accuracy. No AI is used
            for deterministic math, rule-engine decisions, or financial calculations.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Document Intelligence */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Cpu size={18} className="text-emerald-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                  Document AI
                </div>
                <div className="text-base font-bold text-gray-900">Document Intelligence</div>
              </div>
            </div>
            <ul className="space-y-2.5">
              {documentIntelligenceItems.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <span className="mt-1 w-4 h-4 rounded-full bg-emerald-100 flex-shrink-0 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Deal Reasoning */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <Brain size={18} className="text-primary-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-primary-600 uppercase tracking-wider">
                  Reasoning AI
                </div>
                <div className="text-base font-bold text-gray-900">Deal Reasoning</div>
              </div>
            </div>
            <ul className="space-y-2.5">
              {dealReasoningItems.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <span className="mt-1 w-4 h-4 rounded-full bg-primary-100 flex-shrink-0 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Financial Engine ─────────────────────────────────────────────────────────

const engineStats = [
  {
    stat: '10+ Asset Classes',
    description: 'Residential, plotted, commercial, industrial, hospitality, mixed-use, and more',
    icon: Building2,
  },
  {
    stat: '8 Deal Structures',
    description:
      'Outright, JV, JDA, revenue share, area share, ground lease, profit share, hybrid',
    icon: IndianRupee,
  },
  {
    stat: '15-Year Horizon',
    description:
      'Quarterly and annual views with phased development and use-transition support',
    icon: TrendingUp,
  },
];

const engineOutputs = [
  'IRR (levered + unlevered)',
  'NPV',
  'MOIC',
  'DSCR',
  'Yield on Cost',
  'Sources & Uses',
  'Quarterly Cash Flows',
  'Waterfall distributions',
];

function FinancialEngine() {
  return (
    <section className="bg-gray-900 py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Institutional-Grade Underwriting Engine
          </h2>
          <p className="text-gray-400 text-lg">
            All calculations are deterministic — no LLM math, no ambiguous assumptions.
          </p>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {engineStats.map(({ stat, description, icon: Icon }) => (
            <div
              key={stat}
              className="bg-gray-800 rounded-xl border border-gray-700 p-6"
            >
              <div className="w-10 h-10 rounded-lg bg-primary-600/20 flex items-center justify-center mb-4">
                <Icon size={18} className="text-primary-400" />
              </div>
              <div className="text-xl font-bold text-white mb-1">{stat}</div>
              <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>

        {/* Key outputs */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Key Outputs
          </div>
          <div className="flex flex-wrap gap-2">
            {engineOutputs.map((output) => (
              <span
                key={output}
                className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-full text-xs font-medium text-gray-300"
              >
                {output}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Due Diligence Engine ─────────────────────────────────────────────────────

const ddLayers = [
  'Title & Ownership',
  'Land Classification & Regulatory Status',
  'Seller / Transaction Validity',
  'Statutory / Development Approvals',
  'Financial / Commercial DD',
  'Project-Specific DD',
  'Physical / Technical DD',
];

function DueDiligenceEngine() {
  return (
    <section className="bg-white py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            Structured DD, Not a Checklist
          </h2>
          <p className="text-gray-500 text-lg">
            Seven layers of due diligence — each item classified by deal impact.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {ddLayers.map((layer) => (
            <div
              key={layer}
              className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 shadow-sm p-5"
            >
              <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                <Shield size={15} className="text-primary-600" />
              </div>
              <span className="text-sm font-medium text-gray-800">{layer}</span>
            </div>
          ))}
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-200 px-6 py-4">
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">Item severity classification: </span>
            Each item is classified as{' '}
            <span className="font-semibold text-red-600">Deal Breaker</span>,{' '}
            <span className="font-semibold text-orange-600">Buildability Blocker</span>,{' '}
            <span className="font-semibold text-yellow-600">Commercial Blocker</span>, or{' '}
            <span className="font-semibold text-gray-600">Secondary</span>.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Asset Classes ────────────────────────────────────────────────────────────

const assetClasses = [
  'Raw Land',
  'Plotted Development',
  'Residential Apartments',
  'Villas',
  'Commercial Office',
  'Retail',
  'Industrial / Warehousing',
  'Hospitality',
  'Mixed-Use',
  'Redevelopment / Distressed',
];

function AssetClasses() {
  return (
    <section className="bg-gray-50 py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            All Indian Asset Classes
          </h2>
          <p className="text-gray-500 text-lg">
            One platform covers every asset type common in India's land and real estate market.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {assetClasses.map((cls) => (
            <span
              key={cls}
              className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm font-medium text-gray-700 shadow-sm hover:border-primary-300 hover:text-primary-700 transition-colors"
            >
              {cls}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function CTASection() {
  const navigate = useNavigate();
  return (
    <section className="bg-primary-600 py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
          Start Your First Deal
        </h2>
        <p className="text-primary-100 text-lg mb-10 max-w-xl mx-auto">
          Set up a deal workspace, link a parcel, and run end-to-end diligence — no
          spreadsheet migrations required.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-3 bg-white hover:bg-gray-50 text-primary-700 rounded-lg text-sm font-semibold transition-colors shadow-md"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-3 border border-primary-400 hover:border-white text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Register
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-gray-950 border-t border-gray-800 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
          <div>
            <div className="text-lg font-extrabold text-primary-500 tracking-tight mb-1">
              REDIP
            </div>
            <div className="text-sm text-gray-500">AI-powered Deal Intelligence for India</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-medium text-gray-500 leading-relaxed">
              India First · Bengaluru Priority
              <br />
              No mock data · No fabricated facts
            </div>
          </div>
          <div className="md:text-right">
            <div className="text-xs text-gray-600">
              &copy; {new Date().getFullYear()} REDIP. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <WhatItSolves />
      <ProductWorkflow />
      <AICapabilities />
      <FinancialEngine />
      <DueDiligenceEngine />
      <AssetClasses />
      <CTASection />
      <Footer />
    </div>
  );
}
